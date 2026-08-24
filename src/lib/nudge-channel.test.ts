// The nudge topic's shared channel.
//
// What this has to get right is narrower than event-channel.ts but sharper: the
// topic must reach supabase VERBATIM, and an unsubscribe followed immediately by a
// resubscribe — which is what React StrictMode does on every mount — must not tear
// the channel down. Getting either wrong fails silently, with delivery simply
// never happening and nothing anywhere raising.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Binding = { cfg: { event?: string }; cb: () => void };

const bindings: Binding[] = [];
const statusCallbacks: ((status: string) => void)[] = [];
const channelNames: string[] = [];
const removeChannel = vi.fn();

vi.mock("@/integrations/supabase/client", () => {
  const makeChannel = () => {
    const channel: Record<string, unknown> = {
      on: (_type: string, cfg: { event?: string }, cb: () => void) => {
        bindings.push({ cfg, cb });
        return channel;
      },
      subscribe: (cb: (status: string) => void) => {
        statusCallbacks.push(cb);
        return channel;
      },
    };
    return channel;
  };
  return {
    supabase: {
      channel: (name: string) => {
        channelNames.push(name);
        return makeChannel();
      },
      // The spy's own return value has to survive, so a test can hold a removal
      // open and exercise the window a rejoin races against. `?? resolved` is the
      // default: removeChannel always hands back a promise in real supabase-js.
      removeChannel: (ch: unknown) => removeChannel(ch) ?? Promise.resolve("ok"),
    },
  };
});

const TOPIC = "nudge:v1:AbC-123_xyzQWer";
const OTHER = "nudge:v1:ZZZZ999_zzzzZZZZ";

/** The module keeps its registry at module scope, so each test needs its own. */
async function freshModule() {
  vi.resetModules();
  bindings.length = 0;
  statusCallbacks.length = 0;
  channelNames.length = 0;
  removeChannel.mockReset();
  return import("./nudge-channel");
}

/**
 * A channel is opened behind a promise — it may have to wait for a previous one
 * on the same topic to finish leaving — so every assertion about one has to let
 * the microtask queue drain first.
 */
const settle = () => vi.advanceTimersByTimeAsync(0);

const fire = () => {
  for (const b of bindings) b.cb();
};

const join = () => {
  for (const cb of statusCallbacks) cb("SUBSCRIBED");
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("subscribeToNudges", () => {
  it("joins the topic exactly as given", async () => {
    // THE test in this file. Every other channel in the app appends a sequence
    // number or a random suffix to dodge collisions; doing that here would join a
    // topic the server never publishes to, and nothing would ever error.
    const { subscribeToNudges } = await freshModule();
    subscribeToNudges(TOPIC, vi.fn());
    await settle();
    expect(channelNames).toEqual([TOPIC]);
  });

  it("binds the broadcast event the server sends under", async () => {
    const { subscribeToNudges } = await freshModule();
    const { TRADE_NUDGE_EVENT } = await import("./trades");
    subscribeToNudges(TOPIC, vi.fn());
    await settle();
    expect(bindings).toHaveLength(1);
    expect(bindings[0].cfg).toEqual({ event: TRADE_NUDGE_EVENT });
  });

  it("opens one channel however many subscribers join", async () => {
    const { subscribeToNudges } = await freshModule();
    subscribeToNudges(TOPIC, vi.fn());
    subscribeToNudges(TOPIC, vi.fn());
    await settle();
    expect(channelNames).toHaveLength(1);
  });

  it("tells every subscriber", async () => {
    const { subscribeToNudges } = await freshModule();
    const a = vi.fn();
    const b = vi.fn();
    subscribeToNudges(TOPIC, a);
    subscribeToNudges(TOPIC, b);
    await settle();
    fire();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("stops telling one that left", async () => {
    const { subscribeToNudges } = await freshModule();
    const a = vi.fn();
    const b = vi.fn();
    const leave = subscribeToNudges(TOPIC, a);
    subscribeToNudges(TOPIC, b);
    await settle();
    leave();
    fire();
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("survives a subscriber that unsubscribes from its own callback", async () => {
    const { subscribeToNudges } = await freshModule();
    const other = vi.fn();
    let leave = () => {};
    leave = subscribeToNudges(TOPIC, () => leave());
    subscribeToNudges(TOPIC, other);
    await settle();
    expect(() => fire()).not.toThrow();
    expect(other).toHaveBeenCalledTimes(1);
  });

  it("holds the channel open through a remount", async () => {
    // The StrictMode case, and the reason this module exists at all. A synchronous
    // teardown would hand the remount a channel that is still leaving, whose
    // subscribe() is a silent no-op — leaving the app with no subscription and no
    // error to show for it.
    const { subscribeToNudges, NUDGE_TEARDOWN_GRACE_MS } = await freshModule();
    const leave = subscribeToNudges(TOPIC, vi.fn());
    await settle();
    leave();
    vi.advanceTimersByTime(NUDGE_TEARDOWN_GRACE_MS - 1);
    expect(removeChannel).not.toHaveBeenCalled();

    const notify = vi.fn();
    subscribeToNudges(TOPIC, notify);
    await vi.advanceTimersByTimeAsync(NUDGE_TEARDOWN_GRACE_MS * 2);
    // Same channel, never removed, and still delivering.
    expect(channelNames).toHaveLength(1);
    expect(removeChannel).not.toHaveBeenCalled();
    fire();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("closes the channel once nobody comes back", async () => {
    const { subscribeToNudges, NUDGE_TEARDOWN_GRACE_MS } = await freshModule();
    const leave = subscribeToNudges(TOPIC, vi.fn());
    await settle();
    leave();
    await vi.advanceTimersByTimeAsync(NUDGE_TEARDOWN_GRACE_MS);
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });

  it("reopens after a full teardown rather than reusing a dead entry", async () => {
    const { subscribeToNudges, NUDGE_TEARDOWN_GRACE_MS } = await freshModule();
    subscribeToNudges(TOPIC, vi.fn())();
    await settle();
    await vi.advanceTimersByTimeAsync(NUDGE_TEARDOWN_GRACE_MS);
    subscribeToNudges(TOPIC, vi.fn());
    await settle();
    expect(channelNames).toEqual([TOPIC, TOPIC]);
  });

  it("refetches on join, closing the gap the response could not cover", async () => {
    // A trade that settled between getMyTradeOffers reading the database and this
    // channel joining was broadcast to nobody. Without this the badge stays stale
    // until the next window focus, which on a desktop left open is a long time.
    const { subscribeToNudges } = await freshModule();
    const notify = vi.fn();
    subscribeToNudges(TOPIC, notify);
    await settle();
    expect(notify).not.toHaveBeenCalled();
    join();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("refetches again when the socket rejoins", async () => {
    // Everything that happened while it was away was delivered to nobody, so a
    // resumed stream is not enough on its own — the same reason event-channel.ts
    // fans out on its degraded-to-live recovery.
    const { subscribeToNudges } = await freshModule();
    const notify = vi.fn();
    subscribeToNudges(TOPIC, notify);
    await settle();
    join();
    join();
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("waits for the old channel to leave before opening a new one", async () => {
    // The window the grace timer does NOT cover. removeChannel resolves only once
    // the unsubscribe lands, and until then supabase-js still holds the topic:
    // opening now would be handed the dying channel, its subscribe() would no-op
    // because it is not closed, and the pending removal would tear it down under
    // the new entry — no nudges, and nothing raised anywhere.
    const { subscribeToNudges, NUDGE_TEARDOWN_GRACE_MS } = await freshModule();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    removeChannel.mockImplementationOnce(() => blocked);

    subscribeToNudges(TOPIC, vi.fn())();
    await settle();
    await vi.advanceTimersByTimeAsync(NUDGE_TEARDOWN_GRACE_MS);
    expect(removeChannel).toHaveBeenCalledTimes(1);

    // Rejoin while the removal is still in flight.
    const notify = vi.fn();
    subscribeToNudges(TOPIC, notify);
    await settle();
    expect(channelNames).toHaveLength(1);

    release();
    await settle();
    // Only now is a second, live channel built.
    expect(channelNames).toEqual([TOPIC, TOPIC]);
    join();
    expect(notify).toHaveBeenCalled();
  });

  it("builds nothing for a topic abandoned before its turn came round", async () => {
    const { subscribeToNudges, NUDGE_TEARDOWN_GRACE_MS } = await freshModule();
    let release!: () => void;
    removeChannel.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    subscribeToNudges(TOPIC, vi.fn())();
    await settle();
    await vi.advanceTimersByTimeAsync(NUDGE_TEARDOWN_GRACE_MS);

    // Joins and leaves again entirely inside the removal window.
    const leave = subscribeToNudges(TOPIC, vi.fn());
    leave();
    await vi.advanceTimersByTimeAsync(NUDGE_TEARDOWN_GRACE_MS);
    release();
    await settle();
    // The second entry never opened a channel, so there is none to leak.
    expect(channelNames).toHaveLength(1);
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });

  it("keeps two topics apart", async () => {
    // Claiming a different player on the same phone swaps the topic.
    const { subscribeToNudges } = await freshModule();
    const mine = vi.fn();
    subscribeToNudges(TOPIC, mine);
    subscribeToNudges(OTHER, vi.fn());
    await settle();
    expect(channelNames).toEqual([TOPIC, OTHER]);
  });
});
