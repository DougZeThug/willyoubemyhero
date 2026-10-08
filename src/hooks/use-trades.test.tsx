// What a trade landing refreshes.
//
// The `trades` insert is the only live signal that two collections moved, and
// the handler is a list of keys to invalidate. What is pinned is that the list
// names BOTH caches of getTradeSpares: the Trading Post's and the shop's. The
// shop's was missing, and a card traded away from the phone sat on the burn and
// sell counters until the cache happened to age out.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createQueryWrapper } from "@/test/query";

const fns = vi.hoisted(() => ({ feed: vi.fn() }));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("@/lib/trades.functions", () => ({
  getMyTradeOffers: vi.fn(),
  getTradeFeed: fns.feed,
  getTradeSpares: vi.fn(),
}));

const realtime = vi.hoisted(() => ({ handler: null as null | (() => void) }));
vi.mock("@/integrations/supabase/client", () => {
  const channel = {
    on: (_type: string, _filter: unknown, cb: () => void) => {
      realtime.handler = cb;
      return channel;
    },
    subscribe: () => channel,
  };
  return { supabase: { channel: () => channel, removeChannel: vi.fn() } };
});

import { marketListingsKey } from "./use-market";
import { cardPullCountsKey } from "./use-card-pulls";
import { mySecretsKey } from "./use-daily-secret";
import { myCardStatsKey } from "./use-my-collection";
import {
  dustSparesKey,
  invalidateTradeCaches,
  tradeFeedKey,
  tradeOffersKey,
  tradeSparesKey,
  useTradeFeed,
} from "./use-trades";

const ME = "me-1";
const EVENT = "ev-1";

beforeEach(() => {
  realtime.handler = null;
  fns.feed.mockReset().mockResolvedValue([]);
});

describe("useTradeFeed", () => {
  it("refreshes both spares lists when a trade lands", () => {
    const { wrapper, client } = createQueryWrapper();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    renderHook(() => useTradeFeed(EVENT, ME), { wrapper });

    const onTrade = realtime.handler;
    if (!onTrade) throw new Error("useTradeFeed never subscribed to trades");
    act(() => onTrade());

    const keys = invalidate.mock.calls.map(([f]) => JSON.stringify(f?.queryKey));
    expect(keys).toContain(JSON.stringify(tradeSparesKey(ME)));
    expect(keys).toContain(JSON.stringify(dustSparesKey(ME)));
  });

  it("refreshes the shop's shelf, because accepting a trade voids listings that staked the copies", () => {
    const { wrapper, client } = createQueryWrapper();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    renderHook(() => useTradeFeed(EVENT, ME), { wrapper });

    const onTrade = realtime.handler;
    if (!onTrade) throw new Error("useTradeFeed never subscribed to trades");
    act(() => onTrade());

    const keys = invalidate.mock.calls.map(([f]) => JSON.stringify(f?.queryKey));
    expect(keys).toContain(JSON.stringify(marketListingsKey(ME)));
  });
});

describe("invalidateTradeCaches", () => {
  // Shared by the realtime handler and the trade screen's own refresh after
  // accept, which cannot lean on realtime. Pinned as a whole so the two paths
  // cannot drift apart again.
  it("names every cache a completed trade can move", async () => {
    const { client } = createQueryWrapper();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await invalidateTradeCaches(client, EVENT, ME);

    const keys = invalidate.mock.calls.map(([f]) => JSON.stringify(f?.queryKey));
    expect(keys.sort()).toEqual(
      [
        tradeFeedKey(EVENT),
        tradeOffersKey(ME),
        tradeSparesKey(ME),
        dustSparesKey(ME),
        marketListingsKey(ME),
        cardPullCountsKey(EVENT),
        myCardStatsKey(EVENT, ME),
        mySecretsKey(`m:${ME}`),
      ]
        .map((k) => JSON.stringify(k))
        .sort(),
    );
  });

  it("keys the secrets cache on nobody for a signed-out viewer", async () => {
    const { client } = createQueryWrapper();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await invalidateTradeCaches(client, EVENT, null);
    const keys = invalidate.mock.calls.map(([f]) => JSON.stringify(f?.queryKey));
    expect(keys).toContain(JSON.stringify(mySecretsKey(null)));
  });
});
