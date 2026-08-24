// The unread dot on offers waiting for you.
//
// The interesting behaviour is not "does a set remember things". It is that the
// dot counts only what is pointed AT you, that reading the inbox clears it without
// the stored set growing for the life of the app, and that a browser refusing to
// store still clears it for the page load.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "@/test/query";
import type { TradeOfferView } from "@/lib/trades";

const serverFnMock = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => serverFnMock,
}));

const memberSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/member-token", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/member-token")>()),
  useMemberSession: () => memberSession(),
}));

import { markTradeOffersSeen, unreadOfferIds, useTradeBadge } from "./use-trade-badge";

const KEY = "wwbh:trade-seen";
const ME = "p-me";

const offer = (id: string): TradeOfferView => ({
  id,
  status: "pending",
  proposerId: "p-them",
  recipientId: ME,
  createdAt: "2026-08-24T10:00:00Z",
  resolvedAt: null,
  proposerGives: [],
  recipientGives: [],
});

const stored = () => JSON.parse(window.localStorage.getItem(KEY)!).ids as string[];

beforeEach(() => {
  serverFnMock.mockReset();
  memberSession.mockReturnValue({ participantId: ME });
  markTradeOffersSeen([]);
  window.localStorage.clear();
});

describe("unreadOfferIds", () => {
  it("counts everything when nothing has been seen", () => {
    expect(unreadOfferIds([offer("a"), offer("b")], [])).toEqual(["a", "b"]);
  });

  it("drops the ones already seen", () => {
    expect(unreadOfferIds([offer("a"), offer("b")], ["a"])).toEqual(["b"]);
  });

  it("cannot go negative on a seen id that has left the inbox", () => {
    // An accepted offer leaves the inbox but may still be in the stored set until
    // the next mark-seen. That must read as "nothing waiting", not as a shortfall.
    expect(unreadOfferIds([], ["a", "b"])).toEqual([]);
  });
});

describe("markTradeOffersSeen", () => {
  it("stores what is in the inbox now, and only that", () => {
    // The whole unbounded-growth answer. An id that has left the inbox has been
    // resolved, and trade_offers.status never moves back to pending, so it can
    // never come round again and need remembering.
    markTradeOffersSeen(["a", "b"]);
    expect(stored()).toEqual(["a", "b"]);
    markTradeOffersSeen(["c"]);
    expect(stored()).toEqual(["c"]);
  });

  it("does not write when nothing changed", () => {
    markTradeOffersSeen(["a"]);
    const spy = vi.spyOn(Storage.prototype, "setItem");
    markTradeOffersSeen(["a"]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("still clears the dot when the browser refuses to store", async () => {
    // Private-mode Safari. Degrading to "works for this page load" is the same
    // bargain vault-favourites.ts makes.
    serverFnMock.mockResolvedValue({
      inbox: [offer("a")],
      outbox: [],
      recent: [],
    });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useTradeBadge(), { wrapper });
    await waitFor(() => expect(result.current).toBe(1));

    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    act(() => markTradeOffersSeen(["a"]));
    await waitFor(() => expect(result.current).toBe(0));
    spy.mockRestore();
  });
});

describe("useTradeBadge", () => {
  it("asks nothing and shows nothing for a device with no claimed player", async () => {
    memberSession.mockReturnValue(null);
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useTradeBadge(), { wrapper });
    await waitFor(() => expect(result.current).toBe(0));
    expect(serverFnMock).not.toHaveBeenCalled();
  });

  it("counts offers pointed at you, not ones you sent", async () => {
    serverFnMock.mockResolvedValue({
      inbox: [offer("a"), offer("b")],
      outbox: [offer("mine")],
      recent: [offer("old")],
    });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useTradeBadge(), { wrapper });
    await waitFor(() => expect(result.current).toBe(2));
  });

  it("clears when the inbox is marked seen, and comes back for a new offer", async () => {
    serverFnMock.mockResolvedValue({
      inbox: [offer("a")],
      outbox: [],
      recent: [],
    });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useTradeBadge(), { wrapper });
    await waitFor(() => expect(result.current).toBe(1));

    act(() => markTradeOffersSeen(["a"]));
    await waitFor(() => expect(result.current).toBe(0));

    // A second offer arrives while "a" is still sitting there unresolved.
    act(() => markTradeOffersSeen(["a"]));
    expect(unreadOfferIds([offer("a"), offer("b")], stored())).toEqual(["b"]);
  });
});
