// The refcounted half of a shared realtime channel: one resource per key,
// shared by every subscriber, closed only after a grace period with none.
//
// What each channel puts on the wire (bindings, health, polling) stays with its
// owner; this is the lifecycle that has to be identical for all of them. The
// grace timer exists because a route change or a StrictMode remount unsubscribes
// then resubscribes within a tick, and closing a socket there costs a reconnect
// and a window where changes land unseen.
//
// `close` is awaited, and a resource opened on the same key meanwhile waits for
// it (`whenReady`). @supabase/realtime-js's `channel(topic)` hands back the
// still-leaving channel while a removal is in flight, and `subscribe()` is a
// silent no-op on a channel that is not closed, so a rejoin racing the removal
// ends with no subscription and nothing raised.

export type SharedChannelHandle<S> = {
  subscribers: Set<S>;
  /** False once this resource was closed or replaced; async work should stop. */
  isCurrent: () => boolean;
  /**
   * Run `fn` once any previous resource on this key has finished closing --
   * straight away when none is closing. Not run at all if superseded meanwhile.
   */
  whenReady: (fn: () => void) => void;
};

type Entry<S, R> = {
  state: R;
  subscribers: Set<S>;
  teardown: ReturnType<typeof setTimeout> | null;
};

export function createSharedChannels<S, R>(options: {
  graceMs: number;
  /** Build the resource. Runs once per key while it has subscribers. */
  open: (key: string, handle: SharedChannelHandle<S>) => R;
  /** Release the resource; a returned promise holds back a reopen of the key. */
  close: (state: R) => Promise<unknown> | void;
  /** Runs for every join, including the one that opened the resource. */
  onJoin?: (state: R, subscriber: S) => void;
}): (key: string, subscriber: S) => () => void {
  const entries = new Map<string, Entry<S, R>>();
  const closing = new Map<string, Promise<unknown>>();

  function openEntry(key: string): Entry<S, R> {
    const subscribers = new Set<S>();
    const entry = { subscribers, teardown: null } as Entry<S, R>;
    entries.set(key, entry);
    const isCurrent = () => entries.get(key) === entry;
    const whenReady = (fn: () => void) => {
      const previous = closing.get(key);
      if (!previous) return fn();
      void previous.then(() => {
        // Superseded while we waited -- somebody else owns this key now.
        if (isCurrent()) fn();
      });
    };
    entry.state = options.open(key, { subscribers, isCurrent, whenReady });
    return entry;
  }

  return (key, subscriber) => {
    let entry = entries.get(key);
    if (!entry) {
      entry = openEntry(key);
    } else if (entry.teardown) {
      clearTimeout(entry.teardown);
      entry.teardown = null;
    }
    const joined = entry;
    joined.subscribers.add(subscriber);
    options.onJoin?.(joined.state, subscriber);

    return () => {
      joined.subscribers.delete(subscriber);
      if (joined.subscribers.size > 0 || joined.teardown) return;
      // Somebody already replaced this entry -- leave theirs alone.
      if (entries.get(key) !== joined) return;
      joined.teardown = setTimeout(() => {
        if (entries.get(key) !== joined || joined.subscribers.size > 0) return;
        entries.delete(key);
        // Published BEFORE it can resolve, so a resubscribe on the next tick
        // finds it and waits rather than racing the removal.
        const removal = Promise.resolve(options.close(joined.state)).catch(() => {});
        closing.set(key, removal);
        void removal.then(() => {
          if (closing.get(key) === removal) closing.delete(key);
        });
      }, options.graceMs);
    };
  };
}
