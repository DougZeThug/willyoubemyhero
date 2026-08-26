// The receiving half of nudge.server.ts: join your own topic, and refetch when the
// server pokes it.
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { subscribeToNudges } from "@/lib/nudge-channel";
import { tradeOffersKey } from "./use-trades";
import { marketListingsKey, myStallKey } from "./use-market";
import { dustBalanceKey } from "./use-dust";

/**
 * Subscribe this device to its own trade nudges.
 *
 * FETCH-THEN-SUBSCRIBE, forced rather than chosen: the topic only exists once
 * getMyTradeOffers has answered. That leaves a real gap — a trade settled between
 * the handler reading the database and this channel joining was broadcast to a
 * listener that did not exist, so neither the response nor the subscription
 * carries it, and on a window that stays focused nothing would ever go back for
 * it. nudge-channel.ts closes that by fanning out once on SUBSCRIBED, which is
 * why joining costs a refetch.
 *
 * Subscribing first would not have avoided it, only moved it: an event would then
 * arrive for state the in-flight fetch overwrites with a staler read.
 *
 * INVALIDATE, NEVER MERGE — the doctrine event-channel.ts and useTradeFeed follow.
 * There is no payload to merge even if we wanted one, which is the privacy
 * guarantee; the event means "something moved, go and ask properly", and asking
 * properly means the member-guarded handler.
 *
 * Takes primitives, not the query object. `data` gets a fresh reference on every
 * refetch, and a `data`-shaped dependency here would tear the channel down and
 * rebuild it every thirty seconds.
 */
export function useTradeNudge(topic: string | null, participantId: string | null) {
  const qc = useQueryClient();

  useEffect(() => {
    // Null until the first getMyTradeOffers or getMarketListings lands, and null
    // for a guest or after a sign-out. Focus refetch covers those.
    if (!topic || !participantId) return;
    return subscribeToNudges(topic, () => {
      // ONE TOPIC, FOUR KEYS. The marketplace pokes this same per-participant
      // topic when somebody buys your card, rather than minting a second one:
      // the topic is an HMAC per member and the event carries nothing, so a
      // second reason to send it widens the surface by exactly nothing. The
      // payload being empty is precisely what makes that true — it means
      // "something of yours moved, go and ask properly", and asking properly is
      // these four member-guarded handlers.
      //
      // Invalidating all four on either kind of nudge is deliberate: there is no
      // payload to tell them apart, and for thirteen people the extra refetch is
      // cheaper than a second topic to keep in step.
      qc.invalidateQueries({ queryKey: tradeOffersKey(participantId) });
      qc.invalidateQueries({ queryKey: marketListingsKey(participantId) });
      qc.invalidateQueries({ queryKey: myStallKey(participantId) });
      // A sale moved it, and the seller was not the one who tapped anything.
      qc.invalidateQueries({ queryKey: dustBalanceKey(participantId) });
    });
  }, [topic, participantId, qc]);
}
