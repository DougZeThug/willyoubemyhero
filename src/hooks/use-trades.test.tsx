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

import { dustSparesKey, tradeSparesKey, useTradeFeed } from "./use-trades";

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

    expect(realtime.handler).not.toBeNull();
    act(() => realtime.handler!());

    const keys = invalidate.mock.calls.map(([f]) => JSON.stringify(f?.queryKey));
    expect(keys).toContain(JSON.stringify(tradeSparesKey(ME)));
    expect(keys).toContain(JSON.stringify(dustSparesKey(ME)));
  });
});
