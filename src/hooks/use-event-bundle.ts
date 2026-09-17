import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { subscribeToEventChannel, type ChannelHealth } from "@/lib/event-channel";
import { getEventBundle } from "@/lib/event.functions";
import { useActiveEvent } from "./use-active-event";

export function useEventBundle() {
  const bundleFn = useServerFn(getEventBundle);
  const qc = useQueryClient();
  const [health, setHealth] = useState<ChannelHealth>("connecting");

  // The same query the shell reads for the dust switch — shared rather than
  // duplicated, so the two can never answer differently.
  const event = useActiveEvent();
  const eventId = event.data?.id ?? null;

  // "connecting" is the state before the socket has answered at all. Counting
  // it as degraded would flash an offline banner on every page load.
  const realtimeDegraded = health === "degraded";

  const bundle = useQuery({
    queryKey: ["event-bundle", eventId],
    queryFn: () => bundleFn({ data: { eventId: eventId! } }),
    enabled: !!eventId,
    staleTime: 3_000,
    refetchOnWindowFocus: true,
    // No refetchInterval: the poll that backs realtime up lives in the channel
    // registry, one timer per event rather than one per mounted hook.
  });

  useEffect(() => {
    if (!eventId) {
      setHealth("connecting");
      return;
    }
    return subscribeToEventChannel(eventId, {
      change: () => {
        qc.invalidateQueries({ queryKey: ["event-bundle", eventId] });
        // The event row rides the same channel, so a commissioner's dust switch
        // or nav rows reach other phones here rather than on their next focus.
        // Deliberately not everywhere: /claim and /auth do not mount this hook,
        // so those two screens still wait for a focus refetch — neither shows
        // the bar or the shop, so there is nothing there to go stale.
        qc.invalidateQueries({ queryKey: ["active-event"] });
      },
      eventRow: () => {
        // The universal card back is three more columns on that same row, and
        // these two are the queries that render it. They need the nudge more
        // than the rest: uploadEventCardBack writes the new art to a fresh
        // Date.now() path and then HARD-DELETES the old objects, so a phone
        // holding the previous signed URL is pointed at storage that is gone.
        // Neither query refetches on focus, so without this the only way back
        // is their own timer — 45 minutes for the back, three hours for the
        // card urls.
        //
        // Here rather than in `change` above, which fires for every table on
        // the channel AND on the 15s backstop poll, on a timer. Invalidating
        // there re-signed every participant's image set every fifteen seconds
        // on every phone — getEventCardUrls walks the whole roster — which is
        // both a lot of signing and a nonsense of the three-hour refresh those
        // queries are tuned for.
        //
        // An events-row write is rare and always a commissioner doing
        // something, so an extra re-sign after a dust switch is the price of
        // the upload reaching other phones at all. With realtime down there is
        // no write to ride and they wait for their own timer — which is what
        // they did before this existed, so nothing is lost.
        qc.invalidateQueries({ queryKey: ["event-card-back", eventId] });
        qc.invalidateQueries({ queryKey: ["card-urls", eventId] });
      },
      health: setHealth,
    });
  }, [eventId, qc]);

  const refetchEvent = event.refetch;
  const refetchBundle = bundle.refetch;
  const refetch = useCallback(async () => {
    await Promise.all([refetchEvent(), refetchBundle()]);
  }, [refetchEvent, refetchBundle]);

  return {
    event: event.data,
    bundle: bundle.data,
    loading: event.isLoading || bundle.isLoading,
    error: event.error ?? bundle.error ?? null,
    /**
     * Tables getEventBundle could not read. The bundle coalesces a failed read
     * to an empty array, so without this a broken roster looks like an empty
     * one — which is how /live ended up congratulating nobody on being done.
     */
    failedTables: bundle.data?.failed ?? [],
    realtimeDegraded,
    refetch,
  };
}
