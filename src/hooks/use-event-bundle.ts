import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { subscribeToEventChannel, type ChannelHealth } from "@/lib/event-channel";
import { getActiveEvent, getEventBundle } from "@/lib/event.functions";

export function useEventBundle() {
  const activeFn = useServerFn(getActiveEvent);
  const bundleFn = useServerFn(getEventBundle);
  const qc = useQueryClient();
  const [health, setHealth] = useState<ChannelHealth>("connecting");

  const event = useQuery({
    queryKey: ["active-event"],
    queryFn: () => activeFn(),
    staleTime: 60_000,
  });
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
