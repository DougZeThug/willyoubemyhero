import { useMemberQuery } from "./use-member-query";
import { marketListingsKey, myStallKey } from "@/lib/query-keys";
import { useServerFn } from "@tanstack/react-start";
import { getMarketListings, getMyStall } from "@/lib/market.functions";
import type { MarketBrowse, MyStall } from "@/lib/market";

/**
 * Everybody else's active listings.
 *
 * NO REALTIME, for the reason use-trades.ts gives about offers: every published
 * table has to be anon-readable for the browser client to subscribe, and
 * `market_listings` names cards people hold. A sale you are party to arrives
 * through the broadcast nudge instead — see useTradeNudge, which invalidates this
 * key. A listing somebody else PUTS UP reaches you on focus, which for thirteen
 * people standing in a garden is soon enough.
 *
 * `retry: false` for the reason use-dust.ts gives: a member token that expired
 * mid-party should surface the claim prompt, not three retries behind a spinner.
 */
export function useMarketListings(participantId: string | null | undefined) {
  const fn = useServerFn(getMarketListings);
  return useMemberQuery({
    queryKey: marketListingsKey(participantId),
    queryFn: () => fn() as Promise<MarketBrowse>,
    enabled: !!participantId,
    staleTime: 15_000,
  });
}

/**
 * Your own stall — what is up, and what settled.
 *
 * The settled half is the only place a sale is ever visible: a completed sale
 * writes no row into `trades` and reaches no public feed, so without this a seller
 * would learn about it as "huh, I have more dust".
 */
export function useMyStall(participantId: string | null | undefined) {
  const fn = useServerFn(getMyStall);
  return useMemberQuery({
    queryKey: myStallKey(participantId),
    queryFn: () => fn() as Promise<MyStall>,
    enabled: !!participantId,
    staleTime: 15_000,
  });
}
