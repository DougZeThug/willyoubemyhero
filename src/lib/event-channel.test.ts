// The shared realtime channel. What it has to get right: one socket per event
// however many components ask for it, a signal when that socket dies, and a
// refetch when it comes back — because everything that changed while it was
// down was never delivered.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Binding = { cfg: { table?: string }; cb: () => void };

const bindings: Binding[] = [];
const statusCallbacks: ((status: string) => void)[] = [];
const channelNames: string[] = [];
const removeChannel = vi.fn();

vi.mock("@/integrations/supabase/client", () => {
  const makeChannel = () => {
    const channel: Record<string, unknown> = {
      on: (_type: string, cfg: { table?: string }, cb: () => void) => {
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
      removeChannel: (ch: unknown) => removeChannel(ch),
    },
  };
});

const EVENT_ID = "event-1";

/** The module keeps its registry at module scope, so each test needs its own. */
async function freshModule() {
  vi.resetModules();
  bindings.length = 0;
  statusCallbacks.length = 0;
  channelNames.length = 0;
  removeChannel.mockReset();
  return import("./event-channel");
}

function fire(table: string) {
  for (const b of bindings.filter((x) => x.cfg.table === table)) b.cb();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("subscribeToEventChannel", () => {
  it("opens one channel however many subscribers join", async () => {
    const { subscribeToEventChannel } = await freshModule();
    const a = { change: vi.fn(), health: vi.fn() };
    const b = { change: vi.fn(), health: vi.fn() };
    const c = { change: vi.fn(), health: vi.fn() };
    subscribeToEventChannel(EVENT_ID, a);
    subscribeToEventChannel(EVENT_ID, b);
    subscribeToEventChannel(EVENT_ID, c);
    expect(channelNames).toHaveLength(1);
    expect(channelNames[0]).toMatch(/^event:event-1:/);
  });

  it("opens a separate channel per event", async () => {
    const { subscribeToEventChannel } = await freshModule();
    subscribeToEventChannel(EVENT_ID, { change: vi.fn(), health: vi.fn() });
    subscribeToEventChannel("event-2", { change: vi.fn(), health: vi.fn() });
    expect(channelNames).toHaveLength(2);
  });

  it("watches the tables a run touches, scoped to the event", async () => {
    const { subscribeToEventChannel } = await freshModule();
    subscribeToEventChannel(EVENT_ID, { change: vi.fn(), health: vi.fn() });
    const tables = bindings.map((b) => b.cfg.table);
    expect(tables).toEqual([
      "runs",
      "event_participants",
      "draft_selections",
      "splits",
      "penalties",
    ]);
    const runs = bindings[0].cfg as { filter?: string };
    expect(runs.filter).toBe(`event_id=eq.${EVENT_ID}`);
  });

  it("fans a change out to every subscriber", async () => {
    const { subscribeToEventChannel } = await freshModule();
    const a = { change: vi.fn(), health: vi.fn() };
    const b = { change: vi.fn(), health: vi.fn() };
    subscribeToEventChannel(EVENT_ID, a);
    subscribeToEventChannel(EVENT_ID, b);
    fire("runs");
    expect(a.change).toHaveBeenCalledTimes(1);
    expect(b.change).toHaveBeenCalledTimes(1);
  });

  it("stops calling a subscriber that has unsubscribed", async () => {
    const { subscribeToEventChannel } = await freshModule();
    const a = { change: vi.fn(), health: vi.fn() };
    const b = { change: vi.fn(), health: vi.fn() };
    subscribeToEventChannel(EVENT_ID, a);
    const off = subscribeToEventChannel(EVENT_ID, b);
    off();
    fire("splits");
    expect(a.change).toHaveBeenCalledTimes(1);
    expect(b.change).not.toHaveBeenCalled();
  });

  it("reports connecting until the socket answers", async () => {
    const { subscribeToEventChannel } = await freshModule();
    const sub = { change: vi.fn(), health: vi.fn() };
    subscribeToEventChannel(EVENT_ID, sub);
    expect(sub.health).toHaveBeenCalledWith("connecting");
  });

  it("reports live once subscribed and degraded on every failure status", async () => {
    for (const bad of ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]) {
      const { subscribeToEventChannel } = await freshModule();
      const sub = { change: vi.fn(), health: vi.fn() };
      subscribeToEventChannel(EVENT_ID, sub);
      statusCallbacks[0]("SUBSCRIBED");
      expect(sub.health).toHaveBeenLastCalledWith("live");
      statusCallbacks[0](bad);
      expect(sub.health).toHaveBeenLastCalledWith("degraded");
    }
  });

  it("refetches on recovery, because it missed everything while it was down", async () => {
    const { subscribeToEventChannel } = await freshModule();
    const sub = { change: vi.fn(), health: vi.fn() };
    subscribeToEventChannel(EVENT_ID, sub);
    statusCallbacks[0]("SUBSCRIBED");
    expect(sub.change).not.toHaveBeenCalled();
    statusCallbacks[0]("CHANNEL_ERROR");
    statusCallbacks[0]("SUBSCRIBED");
    expect(sub.change).toHaveBeenCalledTimes(1);
  });

  it("does not re-announce a status it is already in", async () => {
    const { subscribeToEventChannel } = await freshModule();
    const sub = { change: vi.fn(), health: vi.fn() };
    subscribeToEventChannel(EVENT_ID, sub);
    statusCallbacks[0]("SUBSCRIBED");
    statusCallbacks[0]("SUBSCRIBED");
    expect(sub.health.mock.calls.map((c) => c[0])).toEqual(["connecting", "live"]);
  });

  it("hands a late joiner the health it already knows", async () => {
    const { subscribeToEventChannel } = await freshModule();
    subscribeToEventChannel(EVENT_ID, { change: vi.fn(), health: vi.fn() });
    statusCallbacks[0]("CHANNEL_ERROR");
    const late = { change: vi.fn(), health: vi.fn() };
    subscribeToEventChannel(EVENT_ID, late);
    expect(late.health).toHaveBeenCalledWith("degraded");
  });

  it("polls slowly while the socket is healthy, and hard once it is not", async () => {
    // One timer for the event, not one per mounted hook: refetchInterval lives
    // on the observer, so /admin's eight subscribers would each have polled.
    const { subscribeToEventChannel, HEALTHY_POLL_MS, DEGRADED_POLL_MS } = await freshModule();
    const a = { change: vi.fn(), health: vi.fn() };
    const b = { change: vi.fn(), health: vi.fn() };
    subscribeToEventChannel(EVENT_ID, a);
    subscribeToEventChannel(EVENT_ID, b);
    statusCallbacks[0]("SUBSCRIBED");

    vi.advanceTimersByTime(DEGRADED_POLL_MS);
    expect(a.change).not.toHaveBeenCalled();
    vi.advanceTimersByTime(HEALTHY_POLL_MS);
    expect(a.change).toHaveBeenCalledTimes(1);
    expect(b.change).toHaveBeenCalledTimes(1);

    statusCallbacks[0]("CHANNEL_ERROR");
    // Losing the socket fires its own catch-up refetch; the poll is what comes
    // after it.
    a.change.mockClear();
    vi.advanceTimersByTime(DEGRADED_POLL_MS);
    expect(a.change).toHaveBeenCalledTimes(1);
  });

  it("does not poll a tab nobody is looking at", async () => {
    // refetchOnWindowFocus catches the tab up when it comes back, so polling a
    // phone in a pocket only costs battery.
    const { subscribeToEventChannel, HEALTHY_POLL_MS } = await freshModule();
    const sub = { change: vi.fn(), health: vi.fn() };
    subscribeToEventChannel(EVENT_ID, sub);
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden" as DocumentVisibilityState);
    vi.advanceTimersByTime(HEALTHY_POLL_MS * 2);
    expect(sub.change).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible" as DocumentVisibilityState);
    vi.advanceTimersByTime(HEALTHY_POLL_MS);
    expect(sub.change).toHaveBeenCalledTimes(1);
    visibility.mockRestore();
  });

  it("stops polling once the channel is gone", async () => {
    const { subscribeToEventChannel, TEARDOWN_GRACE_MS, HEALTHY_POLL_MS } = await freshModule();
    const sub = { change: vi.fn(), health: vi.fn() };
    const off = subscribeToEventChannel(EVENT_ID, sub);
    off();
    vi.advanceTimersByTime(TEARDOWN_GRACE_MS);
    sub.change.mockClear();
    vi.advanceTimersByTime(HEALTHY_POLL_MS * 3);
    expect(sub.change).not.toHaveBeenCalled();
  });

  it("holds the channel open across a route change", async () => {
    // The old page unmounts before the new one mounts, so the count dips to
    // zero for a tick. Closing there costs a reconnect and a blind window.
    const { subscribeToEventChannel, TEARDOWN_GRACE_MS } = await freshModule();
    const off = subscribeToEventChannel(EVENT_ID, { change: vi.fn(), health: vi.fn() });
    off();
    expect(removeChannel).not.toHaveBeenCalled();
    vi.advanceTimersByTime(TEARDOWN_GRACE_MS - 1);
    subscribeToEventChannel(EVENT_ID, { change: vi.fn(), health: vi.fn() });
    vi.advanceTimersByTime(TEARDOWN_GRACE_MS);
    expect(removeChannel).not.toHaveBeenCalled();
    expect(channelNames).toHaveLength(1);
  });

  it("closes the channel once nobody comes back for it", async () => {
    const { subscribeToEventChannel, TEARDOWN_GRACE_MS } = await freshModule();
    const off = subscribeToEventChannel(EVENT_ID, { change: vi.fn(), health: vi.fn() });
    off();
    vi.advanceTimersByTime(TEARDOWN_GRACE_MS);
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });

  it("opens a fresh channel after the old one has been closed", async () => {
    const { subscribeToEventChannel, TEARDOWN_GRACE_MS } = await freshModule();
    const off = subscribeToEventChannel(EVENT_ID, { change: vi.fn(), health: vi.fn() });
    off();
    vi.advanceTimersByTime(TEARDOWN_GRACE_MS);
    subscribeToEventChannel(EVENT_ID, { change: vi.fn(), health: vi.fn() });
    expect(channelNames).toHaveLength(2);
    // Distinct topics, so a channel opened while its predecessor is still
    // closing cannot collide with it.
    expect(channelNames[0]).not.toBe(channelNames[1]);
  });

  it("survives a subscriber that unsubscribes from its own callback", async () => {
    const { subscribeToEventChannel } = await freshModule();
    const other = { change: vi.fn(), health: vi.fn() };
    const selfCancelling = {
      change: vi.fn(() => off()),
      health: vi.fn(),
    };
    const off = subscribeToEventChannel(EVENT_ID, selfCancelling);
    subscribeToEventChannel(EVENT_ID, other);
    expect(() => fire("runs")).not.toThrow();
    expect(other.change).toHaveBeenCalledTimes(1);
  });
});
