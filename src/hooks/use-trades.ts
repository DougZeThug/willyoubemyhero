import { invalidateCardsMoved, tradeFeedKey, tradeOffersKey, tradeSparesKey } from "./query-keys";
import { memberIdentityOrNull } from "@/lib/identity";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { browserSupabase } from "@/lib/browser-supabase";
import { getMyTradeOffers, getTradeFeed, getTradeSpares } from "@/lib/trades.functions";
import type { TradeFeedEntry, TradeOfferView, TradeSpares } from "@/lib/trades";

export type MyTradeOffers = {
  inbox: TradeOfferView[];
  outbox: TradeOfferView[];
  recent: TradeOfferView[];
  /**
   * The broadcast topic this member listens on for trade nudges, minted by the
   * server because it is HMAC'd with SESSION_SECRET and a client cannot derive its
   * own. Nullable so a fixture can say "open no channel" — the e2e suite must never
   * reach Supabase, and useTradeNudge treats null as "there is nothing to join".
   */
  nudgeTopic: string | null;
};

/**
 * Offers waiting on you, offers you are waiting on, and what settled lately.
 *
 * NO REALTIME *TABLE*, and that is a decision rather than an omission. Every
 * published table has to be anon-readable for the browser client to subscribe to
 * it, so even a contentless "something traded" ticker would broadcast trade
 * activity to the whole league — and `trade_offers` itself is server-only precisely
 * because an offer names cards its two parties hold.
 *
 * What does arrive live is a BROADCAST, which is not a table and publishes nothing:
 * useTradeNudge joins the topic this query hands back and invalidates this key when
 * the server pokes it. Focus refetch stays underneath as the backstop, because a
 * dropped broadcast must degrade to exactly the behaviour that shipped before it —
 * and party phones lock and unlock constantly. A completed trade also arrives
 * through useTradeFeed below.
 */
export function useTradeOffers(participantId: string | null | undefined) {
  const fn = useServerFn(getMyTradeOffers);
  return useQuery({
    queryKey: tradeOffersKey(participantId),
    queryFn: () => fn() as Promise<MyTradeOffers>,
    enabled: !!participantId,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    // A member-guarded read: a token that expired mid-party should surface the
    // claim prompt, not retry three times on the way to it.
    retry: false,
  });
}

/**
 * What one member has spare — yours or a counterparty's.
 *
 * Keyed on the viewer AND the participant being asked about. The answer is not
 * the same whoever is looking: a counterparty's secrets you have never pulled
 * arrive with no name and no art, so a device that changes identity must not be
 * handed the last person's answer. Composing an offer flips between the two
 * panels constantly, and both stay cached — under this viewer.
 */
export function useTradeSpares(
  participantId: string | null | undefined,
  viewerId: string | null | undefined,
) {
  const fn = useServerFn(getTradeSpares);
  return useQuery({
    queryKey: tradeSparesKey(viewerId, participantId),
    queryFn: () => fn({ data: { participantId: participantId! } }) as Promise<TradeSpares>,
    enabled: !!participantId,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

/**
 * The public feed of completed trades, kept live.
 *
 * `trades` is the one trading table in the realtime publication, and an insert
 * into it is the app's only live signal that anything traded at all — so it does
 * double duty here. Invalidate rather than merge, mirroring use-event-social:
 * with thirteen people the refetch is cheap and it cannot drift.
 */
export function useTradeFeed(eventId: string | null | undefined, participantId?: string | null) {
  const fn = useServerFn(getTradeFeed);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: tradeFeedKey(eventId),
    queryFn: () => fn({ data: { eventId: eventId! } }) as Promise<TradeFeedEntry[]>,
    enabled: !!eventId,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!eventId) return;
    const supabase = browserSupabase();
    if (!supabase) return;
    const channel = supabase
      .channel(`trades:${eventId}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "trades" }, () => {
        // A trade landing is the moment two collections changed, so the feed is
        // not the only thing stale. Everything a swap can move gets invalidated
        // off the one event — including on the phones of people who were not in
        // it, whose "Packed by N" counts have genuinely moved.
        qc.invalidateQueries({ queryKey: tradeFeedKey(eventId) });
        qc.invalidateQueries({ queryKey: tradeOffersKey(participantId) });
        void invalidateCardsMoved(qc, {
          eventId,
          participantId,
          actor: memberIdentityOrNull(participantId),
        });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, participantId, qc]);

  return query;
}
