import { useEffect } from "react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getActiveEvent, getEventBundle } from "@/lib/event.functions";

export const activeEventQuery = () =>
  queryOptions({
    queryKey: ["active-event"],
    queryFn: () => getActiveEvent(),
    staleTime: 60_000,
  });

export const eventBundleQuery = (eventId: string | null | undefined) =>
  queryOptions({
    queryKey: ["event-bundle", eventId],
    queryFn: () => getEventBundle({ data: { eventId: eventId! } }),
    enabled: !!eventId,
    staleTime: 5_000,
  });

export function useEventBundle() {
  const activeFn = useServerFn(getActiveEvent);
  const bundleFn = useServerFn(getEventBundle);
  const qc = useQueryClient();

  const event = useQuery({
    queryKey: ["active-event"],
    queryFn: () => activeFn(),
    staleTime: 60_000,
  });
  const eventId = event.data?.id ?? null;

  const bundle = useQuery({
    queryKey: ["event-bundle", eventId],
    queryFn: () => bundleFn({ data: { eventId: eventId! } }),
    enabled: !!eventId,
    staleTime: 3_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!eventId) return;
    const invalidate = () => {
      qc.invalidateQueries({ queryKey: ["event-bundle", eventId] });
    };
    const channelName = `event:${eventId}:${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "runs", filter: `event_id=eq.${eventId}` }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "event_participants", filter: `event_id=eq.${eventId}` }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "draft_selections", filter: `event_id=eq.${eventId}` }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "splits" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "penalties" }, invalidate)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, qc]);

  return { event: event.data, bundle: bundle.data, loading: event.isLoading || bundle.isLoading };
}