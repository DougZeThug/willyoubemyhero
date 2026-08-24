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
const channelNames: string[] = [];
const removeChannel = vi.fn();

vi.mock("@/integrations/supabase/client", () => {
  const makeChannel = () => {
    const channel: Record<string, unknown> = {
      on: (_type: string, cfg: { event?: string }, cb: () => void) => {
        bindings.push({ cfg, cb });
        return channel;
      },
      subscribe: () => channel,
    };
    return channel;
  };
  return {
    supabase: {
      channel: (name: string) => {
        channelNames.push(name);
        return makeChannel();
      },
      removeChannel: (ch: unknown) => removeChannel(ch),
    },
  };
});

const TOPIC = "nudge:v1:AbC-123_xyzQWer";
const OTHER = "nudge:v1:ZZZZ999_zzzzZZZZ";

/** The module keeps its registry at module scope, so each test needs its own. */
async function freshModule() {
  vi.resetModules();
  bindings.length = 0;
  channelNames.length = 0;
  removeChannel.mockReset();
  return import("./nudge-channel");
}

const fire = () => {
  for (const b of bindings) b.cb();
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
    expect(channelNames).toEqual([TOPIC]);
  });

  it("binds the broadcast event the server sends under", async () => {
    const { subscribeToNudges } = await freshModule();
    const { TRADE_NUDGE_EVENT } = await import("./trades");
    subscribeToNudges(TOPIC, vi.fn());
    expect(bindings).toHaveLength(1);
    expect(bindings[0].cfg).toEqual({ event: TRADE_NUDGE_EVENT });
  });

  it("opens one channel however many subscribers join", async () => {
    const { subscribeToNudges } = await freshModule();
    subscribeToNudges(TOPIC, vi.fn());
    subscribeToNudges(TOPIC, vi.fn());
    expect(channelNames).toHaveLength(1);
  });

  it("tells every subscriber", async () => {
    const { subscribeToNudges } = await freshModule();
    const a = vi.fn();
    const b = vi.fn();
    subscribeToNudges(TOPIC, a);
    subscribeToNudges(TOPIC, b);
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
    leave();
    vi.advanceTimersByTime(NUDGE_TEARDOWN_GRACE_MS - 1);
    expect(removeChannel).not.toHaveBeenCalled();

    const notify = vi.fn();
    subscribeToNudges(TOPIC, notify);
    vi.advanceTimersByTime(NUDGE_TEARDOWN_GRACE_MS * 2);
    // Same channel, never removed, and still delivering.
    expect(channelNames).toHaveLength(1);
    expect(removeChannel).not.toHaveBeenCalled();
    fire();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("closes the channel once nobody comes back", async () => {
    const { subscribeToNudges, NUDGE_TEARDOWN_GRACE_MS } = await freshModule();
    const leave = subscribeToNudges(TOPIC, vi.fn());
    leave();
    vi.advanceTimersByTime(NUDGE_TEARDOWN_GRACE_MS);
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });

  it("reopens after a full teardown rather than reusing a dead entry", async () => {
    const { subscribeToNudges, NUDGE_TEARDOWN_GRACE_MS } = await freshModule();
    subscribeToNudges(TOPIC, vi.fn())();
    vi.advanceTimersByTime(NUDGE_TEARDOWN_GRACE_MS);
    subscribeToNudges(TOPIC, vi.fn());
    expect(channelNames).toEqual([TOPIC, TOPIC]);
  });

  it("keeps two topics apart", async () => {
    // Claiming a different player on the same phone swaps the topic.
    const { subscribeToNudges } = await freshModule();
    const mine = vi.fn();
    subscribeToNudges(TOPIC, mine);
    subscribeToNudges(OTHER, vi.fn());
    expect(channelNames).toEqual([TOPIC, OTHER]);
  });
});
