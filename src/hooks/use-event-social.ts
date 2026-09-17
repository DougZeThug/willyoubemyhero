import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { subscribeToEventChannel } from "@/lib/event-channel";
import { getEventSocial, getAwards } from "@/lib/social.functions";
import { useMemberSession } from "@/lib/member-token";
import { useGuestSession } from "@/lib/guest-token";

export type ReactionRow = {
  id: string;
  event_participant_id: string;
  participant_id: string | null;
  guest_name?: string | null;
  /** Server-resolved: this row belongs to the identity that made the request. */
  mine?: boolean;
  emoji: string;
  created_at: string;
};

export type CommentRow = {
  id: string;
  event_participant_id: string;
  participant_id: string | null;
  guest_name?: string | null;
  /** Server-resolved: this row belongs to the identity that made the request. */
  mine?: boolean;
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
  // Whoever this device is signed as right now. Every row carries a `mine`
  // resolved server-side against the token on the request, so the answer these
  // rows give is only true for one identity — and the token travels in a header
  // the cache key cannot see. Without this, claiming a player or signing out
  // went on serving the previous identity's `mine`: their reaction chips lit,
  // the toggle sending the wrong direction, a trash icon offered on trash talk
  // that is not yours. The server still refuses that delete, so it is the UI
  // that lies rather than the database that yields. Same shape as the award
  // votes key in routes/awards.tsx.
  const me = useMemberSession();
  const guest = useGuestSession();
  const identity = me?.participantId ?? guest?.guestId ?? null;

  const query = useQuery({
    queryKey: ["event-social", eventId, identity],
    queryFn: () => fn({ data: { eventId: eventId! } }),
    enabled: !!eventId,
    staleTime: 5_000,
  });

  useEffect(() => {
    if (!eventId) return;
    // The shared channel rather than one of our own: it is the only subscription
    // here that notices a dead socket and polls harder while it is down. Health
    // is somebody else's to report — use-event-bundle already draws the banner,
    // and a second one over the same socket would say the same thing twice.
    return subscribeToEventChannel(eventId, {
      // Two elements on purpose: query-key filters match on prefix, so this
      // reaches whichever identity's entry is live without the effect having to
      // re-subscribe every time the identity changes.
      change: () => qc.invalidateQueries({ queryKey: ["event-social", eventId] }),
      health: () => {},
    });
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
    // On the shared channel, which is the half of this that was missing. A bare
    // subscription here had no status callback and no poll behind it, so a dead
    // socket went unnoticed — while `awards_locked` kept arriving on the event
    // row, which IS polled. The lock flipped, the winners never came, and the
    // reveal said "No votes cast." over a vote that had them.
    return subscribeToEventChannel(eventId, {
      change: () => {
        qc.invalidateQueries({ queryKey: ["event-awards", eventId] });
        // And the event itself, because `awards_locked` rides on it with a 60s
        // stale time and no subscription of its own. Winners arrived at once
        // while the ballot stayed open for up to a minute, and every tap on it
        // was refused — which reads as a bug to the voter, not as a closed vote.
        qc.invalidateQueries({ queryKey: ["active-event"] });
      },
      health: () => {},
    });
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
