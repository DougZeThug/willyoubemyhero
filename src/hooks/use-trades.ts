import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getMyTradeOffers, getTradeFeed, getTradeSpares } from "@/lib/trades.functions";
import type { TradeFeedEntry, TradeOfferView, TradeSpares } from "@/lib/trades";
import { mySecretsKey } from "./use-daily-secret";
import { myCardStatsKey } from "./use-my-collection";
import { cardPullCountsKey } from "./use-card-pulls";

export const tradeOffersKey = (participantId: string | null | undefined) =>
  ["trade-offers", participantId] as const;
export const tradeSparesKey = (participantId: string | null | undefined) =>
  ["trade-spares", participantId] as const;
export const tradeFeedKey = (eventId: string | null | undefined) =>
  ["trade-feed", eventId] as const;

export type MyTradeOffers = {
  inbox: TradeOfferView[];
  outbox: TradeOfferView[];
  recent: TradeOfferView[];
};

/**
 * Offers waiting on you, offers you are waiting on, and what settled lately.
 *
 * NO REALTIME, and that is a decision rather than an omission. Every published
 * table has to be anon-readable for the browser client to subscribe to it, so
 * even a contentless "something traded" ticker would broadcast trade activity to
 * the whole league — and `trade_offers` itself is server-only precisely because
 * an offer names cards its two parties hold. Focus refetch instead: party phones
 * lock and unlock constantly, so it is near-live in the only setting that
 * matters. A completed trade does arrive live, through useTradeFeed below.
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
 * Keyed on the participant being asked about rather than on the asker, because
 * the answer is the same whoever is looking, and composing an offer flips
 * between the two panels constantly.
 */
export function useTradeSpares(participantId: string | null | undefined) {
  const fn = useServerFn(getTradeSpares);
  return useQuery({
    queryKey: tradeSparesKey(participantId),
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
    const channel = supabase
      .channel(`trades:${eventId}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "trades" }, () => {
        // A trade landing is the moment two collections changed, so the feed is
        // not the only thing stale. Everything a swap can move gets invalidated
        // off the one event — including on the phones of people who were not in
        // it, whose "Packed by N" counts have genuinely moved.
        qc.invalidateQueries({ queryKey: tradeFeedKey(eventId) });
        qc.invalidateQueries({ queryKey: tradeOffersKey(participantId) });
        qc.invalidateQueries({ queryKey: tradeSparesKey(participantId) });
        qc.invalidateQueries({ queryKey: cardPullCountsKey(eventId) });
        qc.invalidateQueries({ queryKey: myCardStatsKey(eventId, participantId) });
        // The secrets cache is keyed on an actor, which for a claimed member is
        // `m:<participantId>` — see useSecretActor.
        qc.invalidateQueries({
          queryKey: mySecretsKey(participantId ? `m:${participantId}` : null),
        });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, participantId, qc]);

  return query;
}
