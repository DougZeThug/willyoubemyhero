// The receiving half of nudge.server.ts: join your own topic, and refetch when the
// server pokes it.
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { subscribeToNudges } from "@/lib/nudge-channel";
import { tradeOffersKey } from "./use-trades";

/**
 * Subscribe this device to its own trade nudges.
 *
 * FETCH-THEN-SUBSCRIBE, and that ordering is right rather than a compromise. The
 * topic only exists once getMyTradeOffers has answered, so there is a window on
 * first mount where no channel is open — but everything that happened before that
 * response was assembled is IN that response. The nudge only has to cover what
 * comes after it, which is exactly what it covers. Subscribing first would be the
 * classic realtime race instead: an event arriving for state the in-flight fetch
 * then overwrites with a staler read.
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
    // Null until the first getMyTradeOffers lands, and null for a guest or after a
    // sign-out. Focus refetch covers those.
    if (!topic || !participantId) return;
    return subscribeToNudges(topic, () => {
      qc.invalidateQueries({ queryKey: tradeOffersKey(participantId) });
    });
  }, [topic, participantId, qc]);
}
