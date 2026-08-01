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
const useMemberSession = vi.fn();

vi.mock("@/lib/card-pulls.functions", () => ({
  getMyCardStats: (...args: unknown[]) => getMyCardStats(...args),
}));
vi.mock("@/lib/card-collection", () => ({
  loadCollection: () => loadCollection(),
  forgetCards: (...args: unknown[]) => forgetCards(...args),
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

async function mount() {
  const { useMyCollection } = await import("./use-my-collection");
  const { wrapper, client } = createQueryWrapper();
  return { ...renderHook(() => useMyCollection(EVENT, ROSTER), { wrapper }), client };
}

beforeEach(() => {
  vi.resetModules();
  getMyCardStats.mockReset();
  forgetCards.mockReset().mockResolvedValue(undefined);
  loadCollection.mockReset().mockResolvedValue(inflatedLocal());
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

    act(() => result.current.markCollected("ep-5", "champion", 1));
    expect(result.current.collection["ep-5"]).toMatchObject({ count: 1, tier: "champion" });

    // Nothing is deleted *after* the reveal. The stale row this device already
    // had for ep-5 was pruned before it, which is correct — that one was a
    // collect-on-sight artefact, and the pack screen's own `collectCard` writes
    // the genuine pull back.
    const deletedAfter = forgetCards.mock.calls.length;
    act(() => result.current.markCollected("ep-6", "base", 1));
    expect(forgetCards.mock.calls.length).toBe(deletedAfter);
  });

  it("does not count a revealed card twice once the server confirms it", async () => {
    // The floor is "at least one pull", not "one more pull" — so when the server
    // comes back also saying one, the answer is one.
    getMyCardStats.mockResolvedValue(serverHas(["ep-0"]));
    const { result, client } = await mount();
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.markCollected("ep-5", "base", 1));
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
    act(() => result.current.markCollected("ep-0", "base", 3));
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

    act(() => result.current.markCollected("ep-0", "base", 3));
    expect(result.current.collection["ep-0"].count).toBe(3);
  });

  it("holds a floor once, however many times the same card is marked", async () => {
    getMyCardStats.mockResolvedValue(serverHas(["ep-0"]));
    const { result } = await mount();
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.markCollected("ep-5", "base", 1));
    act(() => result.current.markCollected("ep-5", "base", 1));
    expect(result.current.collection["ep-5"].count).toBe(1);
  });
});
