// One Supabase realtime channel per event, shared by everything on the page.
//
// Every mount of useEventBundle used to open its own channel under a randomized
// name, so /admin alone held eight websocket channels for one event and fired
// eight invalidations per database change. Worse, `.subscribe()` was called bare:
// when the socket died nothing noticed, and the screens froze with no signal.
import { supabase } from "@/integrations/supabase/client";

export type ChannelHealth = "connecting" | "live" | "degraded";

export type EventChannelSubscriber = {
  /** Something in this event changed — refetch. */
  change: () => void;
  health: (health: ChannelHealth) => void;
};

type EventChannel = ReturnType<typeof supabase.channel>;

type Entry = {
  channel: EventChannel;
  health: ChannelHealth;
  subscribers: Set<EventChannelSubscriber>;
  teardown: ReturnType<typeof setTimeout> | null;
  poll: ReturnType<typeof setInterval> | null;
};

/**
 * A route change unmounts the old page before mounting the new one, so the
 * subscriber count dips to zero for a tick. Closing the socket there costs a
 * reconnect and a window where changes land unseen.
 */
export const TEARDOWN_GRACE_MS = 5_000;

/** Realtime is carrying the updates; this is only a backstop. */
export const HEALTHY_POLL_MS = 15_000;
/** Realtime is down, so polling is the only thing keeping the screens honest. */
export const DEGRADED_POLL_MS = 4_000;

const entries = new Map<string, Entry>();

// Never reused, so a channel opened while its predecessor is still closing
// cannot collide with it on the topic name.
let channelSeq = 0;

function openChannel(eventId: string): Entry {
  const entry: Entry = {
    channel: undefined as unknown as EventChannel,
    health: "connecting",
    subscribers: new Set(),
    teardown: null,
    poll: null,
  };
  entries.set(eventId, entry);

  // Copied out before iterating: a subscriber that unsubscribes from its own
  // callback would otherwise mutate the set mid-loop.
  const fanOut = () => {
    for (const s of [...entry.subscribers]) s.change();
  };

  // One timer for the whole event, not one per mounted hook. refetchInterval
  // lives on the observer, so /admin's eight subscribers would each have run
  // their own — a bundle fetch every half second while degraded.
  const restartPoll = () => {
    if (entry.poll) clearInterval(entry.poll);
    entry.poll = setInterval(
      () => {
        // A phone in a pocket is not watching, and a background tab that wakes
        // up refetches on focus anyway.
        if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
        fanOut();
      },
      entry.health === "degraded" ? DEGRADED_POLL_MS : HEALTHY_POLL_MS,
    );
  };

  const setHealth = (next: ChannelHealth) => {
    if (entries.get(eventId) !== entry || entry.health === next) return;
    // Changes that happened while the socket was down were never delivered, so
    // recovery needs a refetch rather than just a resumed stream.
    const recovered = entry.health === "degraded" && next === "live";
    entry.health = next;
    for (const s of [...entry.subscribers]) s.health(next);
    restartPoll();
    if (recovered) fanOut();
  };

  entry.channel = supabase
    .channel(`event:${eventId}:${++channelSeq}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "runs", filter: `event_id=eq.${eventId}` },
      fanOut,
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "event_participants",
        filter: `event_id=eq.${eventId}`,
      },
      fanOut,
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "draft_selections",
        filter: `event_id=eq.${eventId}`,
      },
      fanOut,
    )
    // Unlike the three above, these two carry no event_id of their own — they
    // hang off a run — so there is nothing to filter on and every event's
    // splits fan out to every watcher. Invisible while one combine is active,
    // and a refetch of this event's bundle either way; the note is here so
    // the asymmetry reads as known rather than as an oversight.
    .on("postgres_changes", { event: "*", schema: "public", table: "splits" }, fanOut)
    .on("postgres_changes", { event: "*", schema: "public", table: "penalties" }, fanOut)
    // The event row itself, so a commissioner flipping dust or saving the nav
    // rows reaches every other phone rather than only their own. Filtered on the
    // primary key: this is the one table where an unfiltered listener would wake
    // every watcher of every other event for a change none of them can see.
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "events", filter: `id=eq.${eventId}` },
      fanOut,
    )
    .subscribe((status) => {
      // Anything that is not a live subscription means updates may be going
      // missing, which is all a caller needs to know to start polling harder.
      setHealth(status === "SUBSCRIBED" ? "live" : "degraded");
    });

  restartPoll();
  return entry;
}

/** Join this event's channel, and return the unsubscribe. */
export function subscribeToEventChannel(
  eventId: string,
  subscriber: EventChannelSubscriber,
): () => void {
  let entry = entries.get(eventId);
  if (!entry) {
    entry = openChannel(eventId);
  } else if (entry.teardown) {
    clearTimeout(entry.teardown);
    entry.teardown = null;
  }
  const joined = entry;
  joined.subscribers.add(subscriber);
  subscriber.health(joined.health);

  return () => {
    joined.subscribers.delete(subscriber);
    if (joined.subscribers.size > 0 || joined.teardown) return;
    if (entries.get(eventId) !== joined) return;
    joined.teardown = setTimeout(() => {
      if (entries.get(eventId) !== joined || joined.subscribers.size > 0) return;
      entries.delete(eventId);
      if (joined.poll) clearInterval(joined.poll);
      joined.poll = null;
      supabase.removeChannel(joined.channel);
    }, TEARDOWN_GRACE_MS);
  };
}
