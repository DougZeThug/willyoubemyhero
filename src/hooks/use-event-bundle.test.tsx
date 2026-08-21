// The hook every screen reads the combine through. Its job here is to stop
// lying: a failed fetch has to look different from an empty one, and a dead
// socket has to be visible rather than a page that quietly stops updating.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "@/test/query";
import { makeBundle } from "@/test/fixtures";
import type { ChannelHealth, EventChannelSubscriber } from "@/lib/event-channel";

const getActiveEvent = vi.fn();
const getEventBundle = vi.fn();

vi.mock("@/lib/event.functions", () => ({
  getActiveEvent: (...args: unknown[]) => getActiveEvent(...args),
  getEventBundle: (...args: unknown[]) => getEventBundle(...args),
}));

// useServerFn only exists to bind a server function to the router; in a test the
// function itself is already callable.
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

const subscribers: { eventId: string; sub: EventChannelSubscriber }[] = [];
const unsubscribe = vi.fn();

vi.mock("@/lib/event-channel", () => ({
  subscribeToEventChannel: (eventId: string, sub: EventChannelSubscriber) => {
    subscribers.push({ eventId, sub });
    sub.health("connecting");
    return () => unsubscribe(eventId);
  },
}));

const EVENT = { id: "00000000-0000-4000-8000-0000000000ff", name: "Draft Combine" };
const BUNDLE = makeBundle();

function setHealth(health: ChannelHealth) {
  act(() => {
    for (const s of subscribers) s.sub.health(health);
  });
}

beforeEach(() => {
  subscribers.length = 0;
  unsubscribe.mockReset();
  getActiveEvent.mockReset().mockResolvedValue(EVENT);
  getEventBundle.mockReset().mockResolvedValue(BUNDLE);
});

describe("useEventBundle", () => {
  async function mount() {
    const { useEventBundle } = await import("./use-event-bundle");
    const { wrapper, client } = createQueryWrapper();
    const view = renderHook(() => useEventBundle(), { wrapper });
    return { ...view, client };
  }

  it("loads the active event and its bundle", async () => {
    const { result } = await mount();
    await waitFor(() => expect(result.current.bundle).toEqual(BUNDLE));
    expect(result.current.event).toEqual(EVENT);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(getEventBundle).toHaveBeenCalledWith({ data: { eventId: EVENT.id } });
  });

  it("surfaces a fetch failure instead of reporting an empty combine", async () => {
    // Every consumer used to see `bundle === undefined` for both, and rendered
    // its "nothing here yet" copy over a fetch that had actually failed.
    getEventBundle.mockRejectedValue(new Error("offline"));
    const { result } = await mount();
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect((result.current.error as Error).message).toBe("offline");
    expect(result.current.bundle).toBeUndefined();
  });

  it("reports the tables the bundle could not read", async () => {
    getEventBundle.mockResolvedValue(makeBundle({ failed: ["event_participants"] }));
    const { result } = await mount();
    await waitFor(() => expect(result.current.failedTables).toEqual(["event_participants"]));
  });

  it("has no failed tables on a healthy fetch", async () => {
    const { result } = await mount();
    await waitFor(() => expect(result.current.bundle).toEqual(BUNDLE));
    expect(result.current.failedTables).toEqual([]);
  });

  it("subscribes to the event's channel once the event id is known", async () => {
    const { result } = await mount();
    await waitFor(() => expect(subscribers).toHaveLength(1));
    expect(subscribers[0].eventId).toBe(EVENT.id);
    expect(result.current.realtimeDegraded).toBe(false);
  });

  it("does not treat the initial connecting state as degraded", async () => {
    // Otherwise every page load flashes an offline banner before the socket
    // has had a chance to answer.
    const { result } = await mount();
    await waitFor(() => expect(subscribers).toHaveLength(1));
    expect(result.current.realtimeDegraded).toBe(false);
  });

  it("flags a dead socket and clears the flag when it recovers", async () => {
    const { result } = await mount();
    await waitFor(() => expect(subscribers).toHaveLength(1));
    setHealth("degraded");
    expect(result.current.realtimeDegraded).toBe(true);
    setHealth("live");
    expect(result.current.realtimeDegraded).toBe(false);
  });

  it("refetches the bundle when the channel reports a change", async () => {
    const { result } = await mount();
    await waitFor(() => expect(result.current.bundle).toEqual(BUNDLE));
    const before = getEventBundle.mock.calls.length;
    await act(async () => {
      for (const s of subscribers) s.sub.change();
    });
    await waitFor(() => expect(getEventBundle.mock.calls.length).toBeGreaterThan(before));
  });

  it("refetches both queries on demand", async () => {
    const { result } = await mount();
    await waitFor(() => expect(result.current.bundle).toEqual(BUNDLE));
    const events = getActiveEvent.mock.calls.length;
    const bundles = getEventBundle.mock.calls.length;
    await act(async () => {
      await result.current.refetch();
    });
    expect(getActiveEvent.mock.calls.length).toBeGreaterThan(events);
    expect(getEventBundle.mock.calls.length).toBeGreaterThan(bundles);
  });

  it("leaves the channel when the last consumer unmounts", async () => {
    const { unmount } = await mount();
    await waitFor(() => expect(subscribers).toHaveLength(1));
    unmount();
    expect(unsubscribe).toHaveBeenCalledWith(EVENT.id);
  });

  it("does not fetch a bundle before there is an event", async () => {
    getActiveEvent.mockResolvedValue(null);
    const { result } = await mount();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getEventBundle).not.toHaveBeenCalled();
    expect(subscribers).toHaveLength(0);
  });
});
