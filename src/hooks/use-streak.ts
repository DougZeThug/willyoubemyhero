import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getStreakStatus, type StreakStatus } from "@/lib/streaks.functions";

/**
 * Keyed on whoever is asking, never on the event.
 *
 * Same reasoning as secretStatusKey next door: a streak is a permanent record of
 * showing up, so an event id in the key would throw it away every year. It is
 * only a cache key — the server takes the identity from the verified token on the
 * request and never from anything the client passes.
 */
export const streakStatusKey = (actorId: string | null | undefined) =>
  ["pack-streak", actorId] as const;

/**
 * How long the run is, and what it has already paid.
 *
 * No realtime subscription. Both tables behind this — `pack_opens` and
 * `streak_milestone_claims` — are deliberately absent from the realtime
 * publication, because a broadcast would tell every connected phone who just
 * opened a pack and what they collected for it. The streak changes at most once a
 * day per person, so window focus and the invalidation after a pack open are
 * refresh enough.
 */
export function useStreakStatus(actorId: string | null | undefined) {
  const fn = useServerFn(getStreakStatus);
  return useQuery({
    queryKey: streakStatusKey(actorId),
    queryFn: () => fn() as Promise<StreakStatus>,
    // Gated on the actor, so a phone changing hands in a garden never paints the
    // previous person's streak out of the cache.
    enabled: !!actorId,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    // A token that expired mid-party should show a blank pill and let the claim
    // prompt do its job, not retry three times behind a spinner.
    retry: false,
  });
}
