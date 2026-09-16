// Reactions, comments and published award winners.
//
// Both hooks here used to open a bare Supabase channel of their own — no status
// callback, so a dead socket went unnoticed, and no poll, so nothing ever caught
// up on what the socket missed. That cost the awards reveal its answer:
// `close_award_voting` writes the winners and flips `awards_locked` in one
// transaction, the lock rides the event row that IS polled, and the winners rode
// a channel that had gone quiet. The page locked itself over an empty list and
// said "No votes cast." about a vote that had them.
//
// So what these tests pin is not the render — it is which channel the hooks are
// on, because that is the whole fix.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "@/test/query";
import type { EventChannelSubscriber } from "@/lib/event-channel";

const getEventSocial = vi.fn();
const getAwards = vi.fn();

vi.mock("@/lib/social.functions", () => ({
  getEventSocial: (...args: unknown[]) => getEventSocial(...args),
  getAwards: (...args: unknown[]) => getAwards(...args),
}));

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

const subscribers: { eventId: string; sub: EventChannelSubscriber }[] = [];
const unsubscribe = vi.fn();

vi.mock("@/lib/event-channel", () => ({
  subscribeToEventChannel: (eventId: string, sub: EventChannelSubscriber) => {
    subscribers.push({ eventId, sub });
    return () => unsubscribe(eventId);
  },
}));

const EVENT_ID = "00000000-0000-4000-8000-0000000000ff";
const AWARD = {
  participant_id: "p-1",
  award_name: "Most Improved",
  award_type: "mvp",
};

/** The change a fan-out from the shared channel delivers. */
function fanOut() {
  act(() => {
    for (const s of subscribers) s.sub.change();
  });
}

beforeEach(() => {
  subscribers.length = 0;
  unsubscribe.mockReset();
  getEventSocial.mockReset().mockResolvedValue({ reactions: [], comments: [] });
  getAwards.mockReset().mockResolvedValue([AWARD]);
});

describe("useEventAwards", () => {
  async function mount(eventId: string | null = EVENT_ID) {
    const { useEventAwards } = await import("./use-event-social");
    const { wrapper, client } = createQueryWrapper();
    return { ...renderHook(() => useEventAwards(eventId), { wrapper }), client };
  }

  it("rides the shared event channel, which is the one with a poll behind it", async () => {
    await mount();
    await waitFor(() => expect(subscribers).toHaveLength(1));
    expect(subscribers[0].eventId).toBe(EVENT_ID);
  });

  it("asks again for the winners when the channel reports a change", async () => {
    const { client } = await mount();
    await waitFor(() => expect(getAwards).toHaveBeenCalled());
    const invalidate = vi.spyOn(client, "invalidateQueries");

    fanOut();

    const keys = invalidate.mock.calls.map((c) => c[0]?.queryKey);
    // The winners AND the event row the lock rides on. Refreshing one without the
    // other is exactly how the locked page came to be looking at an empty list.
    expect(keys).toEqual(expect.arrayContaining([["event-awards", EVENT_ID], ["active-event"]]));
  });

  it("groups the winners it did read by the player who won them", async () => {
    const { result } = await mount();
    await waitFor(() => expect(result.current.byParticipant.get("p-1")).toHaveLength(1));
  });

  it("neither subscribes nor asks without an event", async () => {
    await mount(null);
    expect(subscribers).toHaveLength(0);
    expect(getAwards).not.toHaveBeenCalled();
  });

  it("leaves the channel when the screen goes", async () => {
    const { unmount } = await mount();
    await waitFor(() => expect(subscribers).toHaveLength(1));
    unmount();
    expect(unsubscribe).toHaveBeenCalledWith(EVENT_ID);
  });
});

describe("useEventSocial", () => {
  async function mount(eventId: string | null = EVENT_ID) {
    const { useEventSocial } = await import("./use-event-social");
    const { wrapper, client } = createQueryWrapper();
    return { ...renderHook(() => useEventSocial(eventId), { wrapper }), client };
  }

  it("rides the shared event channel too", async () => {
    await mount();
    await waitFor(() => expect(subscribers).toHaveLength(1));
    expect(subscribers[0].eventId).toBe(EVENT_ID);
  });

  it("asks again for the reactions and comments on a change", async () => {
    const { client } = await mount();
    await waitFor(() => expect(getEventSocial).toHaveBeenCalled());
    const invalidate = vi.spyOn(client, "invalidateQueries");

    fanOut();

    const keys = invalidate.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toEqual(expect.arrayContaining([["event-social", EVENT_ID]]));
  });
});
