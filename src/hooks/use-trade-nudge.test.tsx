// What a payload-free trade or marketplace nudge refreshes.
//
// A sale writes no `trades` row, so useTradeFeed — which does invalidate the
// secrets cache for a trade — never hears about it, and this listener is the only
// thing on the seller's phone that learns a card of theirs left. A secret sold off
// the marketplace stayed in their vault and pack until the five-minute cache aged
// out.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "@/test/query";
import type { OwnedSecret } from "@/lib/secret-cards";

const getMySecrets = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => getMySecrets,
}));

const subscribeToNudges = vi.hoisted(() => vi.fn());
vi.mock("@/lib/nudge-channel", () => ({
  NUDGE_TEARDOWN_GRACE_MS: 5_000,
  subscribeToNudges: (topic: string, cb: () => void) => subscribeToNudges(topic, cb),
}));

import { dustBalanceKey } from "./use-dust";
import { mySecretsKey, useMySecrets } from "./use-daily-secret";
import { marketListingsKey, myStallKey } from "./use-market";
import { dustSparesKey, tradeOffersKey, tradeSparesKey } from "./use-trades";
import { useTradeNudge } from "./use-trade-nudge";

const ME = "p-me";
const TOPIC = "nudge:v1:AbC-123_xyzQWer";

const ONE_COPY = {
  id: "sc-1",
  name: "Platinum Orb",
  flavour: null,
  foil: "None",
  borderFx: "Standard",
  collection: null,
  artUrl: null,
  backUrl: null,
  tier: "platinum",
  firstPulledOn: "2026-01-01T00:00:00Z",
  count: 1,
  ownerCount: 1,
} as OwnedSecret;

/** The callback useTradeNudge handed the channel, i.e. what a nudge runs. */
function nudge() {
  const cb = subscribeToNudges.mock.calls.at(-1)?.[1] as (() => void) | undefined;
  if (!cb) throw new Error("useTradeNudge never subscribed");
  act(() => cb());
}

beforeEach(() => {
  getMySecrets.mockReset();
  subscribeToNudges.mockReset().mockReturnValue(() => {});
});

describe("useTradeNudge", () => {
  it("refreshes everything of yours a trade or a sale can move", () => {
    const { wrapper, client } = createQueryWrapper();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    renderHook(() => useTradeNudge(TOPIC, ME), { wrapper });
    nudge();

    const keys = invalidate.mock.calls.map(([f]) => JSON.stringify(f?.queryKey));
    for (const key of [
      tradeOffersKey(ME),
      marketListingsKey(ME),
      myStallKey(ME),
      dustBalanceKey(ME),
      tradeSparesKey(ME),
      dustSparesKey(ME),
      // Keyed on the actor, which for a claimed member is `m:<participantId>`.
      mySecretsKey(`m:${ME}`),
    ]) {
      expect(keys).toContain(JSON.stringify(key));
    }
  });

  it("takes a sold secret out of the seller's vault", async () => {
    // A sale moves the seller's only pull, so the NEXT getMySecrets is empty.
    getMySecrets
      .mockResolvedValueOnce({ cards: [ONE_COPY], pulled: 1 })
      .mockResolvedValue({ cards: [], pulled: 0 });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useMySecrets(`m:${ME}`), { wrapper });
    renderHook(() => useTradeNudge(TOPIC, ME), { wrapper });

    await waitFor(() => expect(result.current.data?.cards).toHaveLength(1));
    nudge();

    await waitFor(() => expect(result.current.data?.cards).toHaveLength(0));
    expect(getMySecrets).toHaveBeenCalledTimes(2);
  });

  it("opens no channel without a topic or a member", () => {
    const { wrapper } = createQueryWrapper();
    renderHook(() => useTradeNudge(null, ME), { wrapper });
    renderHook(() => useTradeNudge(TOPIC, null), { wrapper });
    expect(subscribeToNudges).not.toHaveBeenCalled();
  });
});
