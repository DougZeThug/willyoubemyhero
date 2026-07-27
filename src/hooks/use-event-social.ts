import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getEventSocial, getAwards } from "@/lib/social.functions";

export type ReactionRow = {
  id: string;
  event_participant_id: string;
  participant_id: string;
  emoji: string;
  created_at: string;
};

export type CommentRow = {
  id: string;
  event_participant_id: string;
  participant_id: string;
  body: string;
  created_at: string;
};

/**
 * Reactions and comments for the whole event, kept live.
 *
 * Mirrors the realtime pattern in use-event-bundle: subscribe to the tables and
 * invalidate, rather than trying to merge individual payloads into cache. With
 * 13 people the refetch is cheap and it can't drift out of sync.
 */
export function useEventSocial(eventId: string | null | undefined) {
  const fn = useServerFn(getEventSocial);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["event-social", eventId],
    queryFn: () => fn({ data: { eventId: eventId! } }),
    enabled: !!eventId,
    staleTime: 5_000,
  });

  useEffect(() => {
    if (!eventId) return;
    const invalidate = () => qc.invalidateQueries({ queryKey: ["event-social", eventId] });
    const channel = supabase
      .channel(`social:${eventId}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "card_reactions" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "card_comments" }, invalidate)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, qc]);

  return query;
}

/** Published award winners, grouped by the player who won them. */
export function useEventAwards(eventId: string | null | undefined) {
  const fn = useServerFn(getAwards);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["event-awards", eventId],
    queryFn: () => fn({ data: { eventId: eventId! } }),
    enabled: !!eventId,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!eventId) return;
    const channel = supabase
      .channel(`awards:${eventId}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "awards" }, () =>
        qc.invalidateQueries({ queryKey: ["event-awards", eventId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, qc]);

  const byParticipant = useMemo(() => {
    const map = new Map<string, { award_name: string; award_type: string | null }[]>();
    for (const a of query.data ?? []) {
      if (!a.participant_id) continue;
      const list = map.get(a.participant_id) ?? [];
      list.push({ award_name: a.award_name, award_type: a.award_type });
      map.set(a.participant_id, list);
    }
    return map;
  }, [query.data]);

  return { ...query, byParticipant };
}
