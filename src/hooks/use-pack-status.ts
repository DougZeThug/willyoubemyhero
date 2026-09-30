import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPackStatus } from "@/lib/pack.functions";
import type { PackStatus } from "@/lib/pack";

/**
 * Keyed on whoever is asking, never on the event.
 *
 * The same argument mySecretsKey makes next door: a pack is a daily thing but
 * the secrets it counts are a permanent league collection, and an event id in
 * the key would evict somebody's answer every year. It is only a cache key — the
 * server takes the identity from the verified token and never from anything the
 * client passes.
 */
export const packStatusKey = (actorId: string | null | undefined) =>
  ["pack-status", actorId] as const;

/**
 * Has today's pack been opened?
 *
 * No realtime subscription: pack_opens is deliberately absent from the realtime
 * publication, because a broadcast would tell every connected phone that
 * somebody just opened something. Window focus is refresh enough for a
 * once-a-day pack.
 */
export function usePackStatus(actorId: string | null | undefined) {
  const fn = useServerFn(getPackStatus);
  return useQuery({
    queryKey: packStatusKey(actorId),
    queryFn: () => fn() as Promise<PackStatus>,
    // Gated on the actor, so signing in as somebody else in a garden never
    // paints the previous person's state out of the cache.
    enabled: !!actorId,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}
