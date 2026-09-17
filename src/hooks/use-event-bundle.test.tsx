// The hook every screen reads the combine through. Its job here is to stop
// lying: a failed fetch has to look different from an empty one, and a dead
// socket has to be visible rather than a page that quietly stops updating.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
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

  /** Seed both card-back queries so there is something to invalidate. */
  async function withCardUrls() {
    const view = await mount();
    await waitFor(() => expect(view.result.current.bundle).toEqual(BUNDLE));
    view.client.setQueryData(["event-card-back", EVENT.id], { url: "old-back" });
    view.client.setQueryData(["card-urls", EVENT.id], { "ep-1": { front: "old-front" } });
    return view;
  }

  /** Fire one channel signal, and let the invalidations it queues settle. */
  async function fireSignal(signal: "change" | "eventRow") {
    await act(async () => {
      for (const s of subscribers) {
        if (signal === "change") s.sub.change();
        else s.sub.eventRow?.();
      }
      await Promise.resolve();
    });
  }

  const cardUrlsInvalidated = (client: QueryClient) => [
    client.getQueryState(["event-card-back", EVENT.id])?.isInvalidated,
    client.getQueryState(["card-urls", EVENT.id])?.isInvalidated,
  ];

  it("refreshes the card back other phones are still showing", async () => {
    // The universal back lives on the events row, so the upload that replaces it
    // rides this channel like the dust switch does. It was the one change the
    // handler dropped — and the costly one: the upload hard-deletes the objects
    // the old signed URLs point at, and neither query refetches on focus.
    const { client } = await withCardUrls();

    await fireSignal("eventRow");

    expect(cardUrlsInvalidated(client)).toEqual([true, true]);
  });

  it("does not re-sign every card url on the backstop poll", async () => {
    // `change` is not a change. Every table on the channel fans out to it, and
    // so does the 15s poll, on a timer, whether or not anything happened — so
    // invalidating the card urls there walked the whole roster and re-signed
    // every participant's images four times a minute, on every phone, and made
    // a nonsense of the three-hour refresh the query is tuned for.
    const { client } = await withCardUrls();

    await fireSignal("change");

    expect(cardUrlsInvalidated(client)).toEqual([false, false]);
  });

  it("still refetches the bundle on that same poll", async () => {
    // The guard above must not cost the backstop the one thing it is for.
    const { result } = await mount();
    await waitFor(() => expect(result.current.bundle).toEqual(BUNDLE));
    const before = getEventBundle.mock.calls.length;

    await fireSignal("change");

    await waitFor(() => expect(getEventBundle.mock.calls.length).toBeGreaterThan(before));
  });

  it("leaves another event's card back alone", async () => {
    // The keys carry an event id for a reason: a league rolling over to next
    // year's combine must not have this year's channel wiping its urls.
    const { result, client } = await mount();
    await waitFor(() => expect(result.current.bundle).toEqual(BUNDLE));
    client.setQueryData(["event-card-back", "other-event"], { url: "old-back" });

    await fireSignal("eventRow");

    expect(client.getQueryState(["event-card-back", "other-event"])?.isInvalidated).toBe(false);
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
