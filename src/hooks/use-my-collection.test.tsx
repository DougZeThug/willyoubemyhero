// Reconciling a member's collection against the server.
//
// The local store is the thing this hook exists to distrust — it was inflated to
// the whole roster by the old collect-on-sight write and nothing ever cleaned it.
// So what is pinned here is when that store is allowed to reach a screen, and
// what happens to a card revealed before the server has heard about it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "@/test/query";
import type { CollectedCard } from "@/lib/card-collection";

const getMyCardStats = vi.fn();
const loadCollection = vi.fn();
const forgetCards = vi.fn();
const loadUnrecorded = vi.fn();
const useMemberSession = vi.fn();

vi.mock("@/lib/card-pulls.functions", () => ({
  getMyCardStats: (...args: unknown[]) => getMyCardStats(...args),
}));
vi.mock("@/lib/card-collection", () => ({
  loadCollection: () => loadCollection(),
  forgetCards: (...args: unknown[]) => forgetCards(...args),
  loadUnrecorded: () => loadUnrecorded(),
  PACK_STATE_CHANGED: "wwbh:pack-state-changed",
}));
vi.mock("@/lib/member-token", () => ({
  useMemberSession: () => useMemberSession(),
}));
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

const EVENT = "00000000-0000-4000-8000-0000000000ff";
const ME = { participantId: "p-me", expiresAt: Date.now() + 1000, token: "t", name: "Me" };
const ROSTER = Array.from({ length: 18 }, (_, i) => `ep-${i}`);

/** A device that browsed the whole vault before collect-on-sight was removed. */
const inflatedLocal = (): Record<string, CollectedCard> =>
  Object.fromEntries(
    ROSTER.map((id) => [id, { eventParticipantId: id, pulledAt: 1, count: 1, tier: "base" }]),
  );

const serverHas = (ids: string[], pullCount = 1) => ({
  packsOpened: 1,
  firstPackOn: "2026-07-31",
  lastPackOn: "2026-07-31",
  cards: ids.map((id) => ({
    eventParticipantId: id,
    pullCount,
    firstPulledAt: "2026-07-31T18:16:03.777Z",
  })),
});

async function mount(eventId: string | null = EVENT, eventFailed = false) {
  const { useMyCollection } = await import("./use-my-collection");
  const { wrapper, client } = createQueryWrapper();
  return {
    ...renderHook(() => useMyCollection(eventId, ROSTER, eventFailed), { wrapper }),
    client,
  };
}

beforeEach(() => {
  vi.resetModules();
  getMyCardStats.mockReset();
  forgetCards.mockReset().mockResolvedValue(undefined);
  loadCollection.mockReset().mockResolvedValue(inflatedLocal());
  // No unrecorded row is the ordinary case: every pack this device ever tore
  // reached the server.
  loadUnrecorded.mockReset().mockResolvedValue(null);
  useMemberSession.mockReset().mockReturnValue(ME);
});

describe("useMyCollection, for a member", () => {
  it("shows nothing at all until the server has answered", async () => {
    // The bug with a shorter fuse: handing out the local store here puts the old
    // ticks on the vault and "Collected" on a card slab for as long as the query
    // takes. `ready` gates the counters; the collection has to gate itself.
    let resolve!: (v: unknown) => void;
    getMyCardStats.mockReturnValue(new Promise((r) => (resolve = r)));

    const { result } = await mount();
    await waitFor(() => expect(getMyCardStats).toHaveBeenCalled());
    expect(result.current.ready).toBe(false);
    expect(result.current.collection).toEqual({});
    expect(result.current.collectedCount).toBe(0);

    await act(async () => resolve(serverHas(["ep-0", "ep-1", "ep-2"])));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(Object.keys(result.current.collection).sort()).toEqual(["ep-0", "ep-1", "ep-2"]);
  });

  it("takes eighteen browsed cards down to the three that were pulled", async () => {
    getMyCardStats.mockResolvedValue(serverHas(["ep-0", "ep-1", "ep-2"]));
    const { result } = await mount();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.collectedCount).toBe(3);
    await waitFor(() => expect(forgetCards).toHaveBeenCalled());
    expect(forgetCards.mock.calls[0][0]).toHaveLength(15);
  });

  it("keeps the local collection, and deletes none of it, when the query fails", async () => {
    // A token that just expired or a dropped connection is not evidence that
    // somebody's cards are not theirs.
    getMyCardStats.mockRejectedValue(new Error("Claim your player first"));
    const { result } = await mount();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(Object.keys(result.current.collection)).toHaveLength(18);
    expect(forgetCards).not.toHaveBeenCalled();
  });
});

describe("useMyCollection, revealing a card", () => {
  it("keeps a revealed card visible while the server still knows nothing about it", async () => {
    getMyCardStats.mockResolvedValue(serverHas(["ep-0"]));
    const { result } = await mount();
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.markCollected("ep-5", "champion", "standard", 1));
    expect(result.current.collection["ep-5"]).toMatchObject({ count: 1, tier: "champion" });

    // Nothing is deleted *after* the reveal. The stale row this device already
    // had for ep-5 was pruned before it, which is correct — that one was a
    // collect-on-sight artefact, and the pack screen's own `collectCard` writes
    // the genuine pull back.
    const deletedAfter = forgetCards.mock.calls.length;
    act(() => result.current.markCollected("ep-6", "base", "standard", 1));
    expect(forgetCards.mock.calls.length).toBe(deletedAfter);
  });

  it("does not count a revealed card twice once the server confirms it", async () => {
    // The floor is "at least one pull", not "one more pull" — so when the server
    // comes back also saying one, the answer is one.
    getMyCardStats.mockResolvedValue(serverHas(["ep-0"]));
    const { result, client } = await mount();
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.markCollected("ep-5", "base", "standard", 1));
    expect(result.current.collection["ep-5"].count).toBe(1);

    // The tear told the server about this card before it was turned over, so the
    // next answer contains it. A delta would have added itself on top.
    getMyCardStats.mockResolvedValue(serverHas(["ep-0", "ep-5"]));
    await act(async () => {
      await client.invalidateQueries();
    });
    await waitFor(() => expect(result.current.collection["ep-5"].count).toBe(1));
  });

  it("raises the floor above a card already owned rather than restarting at one", async () => {
    getMyCardStats.mockResolvedValue(serverHas(["ep-0"], 2));
    const { result } = await mount();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.collection["ep-0"].count).toBe(2);

    // Three because the pack was dealt against a collection holding two, not
    // because the caller asked for "one more than whatever you have now".
    act(() => result.current.markCollected("ep-0", "base", "standard", 3));
    expect(result.current.collection["ep-0"].count).toBe(3);
  });

  it("does not add a pull the server has already counted", async () => {
    // The tear records the pack before any of it is turned over, so on a fast
    // connection the reconciled number can already include this very pull by the
    // time the card is tapped. The floor is computed from the snapshot the pack
    // was dealt against — two — so it lands under the server's three and leaves
    // it alone. Derived from the *current* number instead, this read four.
    getMyCardStats.mockResolvedValue(serverHas(["ep-0"], 3));
    const { result } = await mount();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.collection["ep-0"].count).toBe(3);

    act(() => result.current.markCollected("ep-0", "base", "standard", 3));
    expect(result.current.collection["ep-0"].count).toBe(3);
  });

  it("holds a floor once, however many times the same card is marked", async () => {
    getMyCardStats.mockResolvedValue(serverHas(["ep-0"]));
    const { result } = await mount();
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.markCollected("ep-5", "base", "standard", 1));
    act(() => result.current.markCollected("ep-5", "base", "standard", 1));
    expect(result.current.collection["ep-5"].count).toBe(1);
  });

  it("shows the finish a card was revealed in", async () => {
    getMyCardStats.mockResolvedValue(serverHas(["ep-0"]));
    const { result } = await mount();
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.markCollected("ep-5", "base", "platinum", 1));
    expect(result.current.collection["ep-5"].edition).toBe("platinum");
  });

  it("keeps the better finish when one card is marked twice", async () => {
    // Unlike `tier` beside it, which keeps the first. Two reveals of one card in
    // a session should leave the better copy showing.
    getMyCardStats.mockResolvedValue(serverHas(["ep-0"]));
    const { result } = await mount();
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.markCollected("ep-5", "base", "bronze", 1));
    act(() => result.current.markCollected("ep-5", "base", "gold", 1));
    expect(result.current.collection["ep-5"].edition).toBe("gold");

    act(() => result.current.markCollected("ep-5", "base", "standard", 1));
    expect(result.current.collection["ep-5"].edition).toBe("gold");
  });

  it("does not let a reveal downgrade what the server already vouches for", async () => {
    getMyCardStats.mockResolvedValue({
      ...serverHas(["ep-0"]),
      cards: [
        {
          eventParticipantId: "ep-0",
          pullCount: 1,
          edition: "platinum",
          firstPulledAt: "2026-07-31T18:16:03.777Z",
        },
      ],
    });
    const { result } = await mount();
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.markCollected("ep-0", "base", "standard", 2));
    expect(result.current.collection["ep-0"].edition).toBe("platinum");
  });
});

describe("useMyCollection, holding a pull the server has not been told about", () => {
  // The loss path this exists for. `recordCardPulls` is fire-and-forget, so one
  // dead spot at tear time meant the cards were collected, shown, and then
  // deleted the next time the server answered without them. The in-memory floor
  // covered the session that pulled them and nothing after it.
  const unrecorded = (ids: string[]) => ({ dayKey: "2026-07-31", identity: "m:p-me", ids });

  it("keeps them through a server answer that does not list them", async () => {
    loadUnrecorded.mockResolvedValue(unrecorded(["ep-5", "ep-6", "ep-7"]));
    getMyCardStats.mockResolvedValue(serverHas(["ep-0"]));

    const { result } = await mount();
    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(result.current.collection["ep-5"]).toBeDefined());
    expect(Object.keys(result.current.collection).sort()).toEqual(["ep-0", "ep-5", "ep-6", "ep-7"]);
  });

  it("never hands them to forgetCards, whatever else is pruned", async () => {
    loadUnrecorded.mockResolvedValue(unrecorded(["ep-5"]));
    getMyCardStats.mockResolvedValue(serverHas(["ep-0"]));

    const { result } = await mount();
    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(forgetCards).toHaveBeenCalled());
    // Sixteen of the eighteen browsed rows still go: the server's own ep-0, and
    // the protected ep-5, are the two that stay.
    const deleted = forgetCards.mock.calls.flatMap((c) => c[0] as string[]);
    expect(deleted).not.toContain("ep-5");
    expect(deleted).toHaveLength(16);
  });

  it("waits for the row before reconciling, however fast the server is", async () => {
    // Two separate IndexedDB reads back this hook, and settling on the first
    // means merging with an empty protection set — which deletes the very cards
    // the row was written to save. The server answering instantly is the
    // ordinary case on a warm cache, not a contrived one.
    let land!: (v: unknown) => void;
    loadUnrecorded.mockReturnValue(new Promise((r) => (land = r)));
    getMyCardStats.mockResolvedValue(serverHas(["ep-0"]));

    const { result } = await mount();
    await waitFor(() => expect(getMyCardStats).toHaveBeenCalled());
    expect(result.current.ready).toBe(false);
    expect(forgetCards).not.toHaveBeenCalled();

    await act(async () => land(unrecorded(["ep-5"])));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(forgetCards.mock.calls.flatMap((c) => c[0] as string[])).not.toContain("ep-5");
  });

  it("does not hold the previous member's cards back for the next one", async () => {
    // A handset changes hands in this league. Whoever picks it up next does not
    // own the cards the last person never managed to report, and showing them
    // would be this hook's one unforgivable direction: a card unlocking that
    // nobody pulled. Their collected rows are disowned here either way.
    loadUnrecorded.mockResolvedValue({
      dayKey: "2026-07-31",
      identity: "m:p-someone-else",
      ids: ["ep-5"],
    });
    getMyCardStats.mockResolvedValue(serverHas(["ep-0"]));

    const { result } = await mount();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.collection["ep-5"]).toBeUndefined();
    await waitFor(() =>
      expect(forgetCards.mock.calls.flatMap((c) => c[0] as string[])).toContain("ep-5"),
    );
  });

  it("takes the server's row for one the server does list", async () => {
    // The record landed after all, or another phone pulled it. Protection buys a
    // card the benefit of the doubt, never a better number than the league's.
    loadUnrecorded.mockResolvedValue(unrecorded(["ep-5"]));
    getMyCardStats.mockResolvedValue(serverHas(["ep-5"], 4));

    const { result } = await mount();
    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(result.current.collection["ep-5"]?.count).toBe(4));
  });

  it("disowns them once the record lands and the row is cleared", async () => {
    // `clearUnrecorded` fires the same event `savePackState` does, and the hook
    // re-reads on it — otherwise a vault left open on another tab would go on
    // protecting ids the league has since adjudicated.
    loadUnrecorded.mockResolvedValue(unrecorded(["ep-5"]));
    getMyCardStats.mockResolvedValue(serverHas(["ep-0"]));

    const { result } = await mount();
    await waitFor(() => expect(result.current.collection["ep-5"]).toBeDefined());

    loadUnrecorded.mockResolvedValue(null);
    await act(async () => {
      window.dispatchEvent(new Event("wwbh:pack-state-changed"));
    });

    await waitFor(() => expect(result.current.collection["ep-5"]).toBeUndefined());
    expect(forgetCards.mock.calls.flatMap((c) => c[0] as string[])).toContain("ep-5");
  });
});

describe("useMyCollection, when the league cannot be reached", () => {
  // With no event id the stats query never runs, so it never succeeds and never
  // errors — `settled` used to stay false forever and every screen read that as
  // "still reconciling" and locked the whole vault face-down without a word.
  it("settles a member on the local collection, and prunes none of it", async () => {
    const { result } = await mount(null, true);
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(Object.keys(result.current.collection)).toHaveLength(18);
    expect(getMyCardStats).not.toHaveBeenCalled();
    expect(forgetCards).not.toHaveBeenCalled();
  });

  it("hangs, as before, while the read is merely slow", async () => {
    // The distinction the flag exists for: a query still in flight is not a
    // failed one, and flashing the unreconciled local store is the bug this hook
    // was written to fix.
    const { result } = await mount(null, false);
    await waitFor(() => expect(result.current.collection).toEqual({}));
    expect(result.current.ready).toBe(false);
  });

  it("changes nothing for a guest, who was never blocked", async () => {
    useMemberSession.mockReturnValue(null);
    const { result } = await mount(null, true);
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.isMember).toBe(false);
    expect(Object.keys(result.current.collection)).toHaveLength(18);
    expect(forgetCards).not.toHaveBeenCalled();
  });
});
