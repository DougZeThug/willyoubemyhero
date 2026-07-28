import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMySecrets, getSecretStatus } from "@/lib/secret-cards.functions";
import type { OwnedSecret, SecretDayStatus } from "@/lib/secret-cards";

/**
 * Keyed on the participant, never on the event.
 *
 * The secret set is a permanent league collection, so an event id in the key
 * would evict somebody's whole collection every year — deliberately different
 * from ["event-social", eventId] next door.
 */
export const secretStatusKey = (participantId: string | null | undefined) =>
  ["daily-secret", participantId] as const;
export const mySecretsKey = (participantId: string | null | undefined) =>
  ["my-secrets", participantId] as const;

/**
 * Is there a card waiting today?
 *
 * No realtime subscription: the tables behind this are deliberately absent from
 * the realtime publication, because a broadcast would tell every connected phone
 * that somebody just pulled something. Window focus is refresh enough for a
 * once-a-day drop.
 */
export function useSecretStatus(participantId: string | null | undefined) {
  const fn = useServerFn(getSecretStatus);
  return useQuery({
    queryKey: secretStatusKey(participantId),
    queryFn: () => fn() as Promise<SecretDayStatus>,
    // Gated on the member, so signing in as somebody else in a garden never
    // paints the previous member's state out of the cache.
    enabled: !!participantId,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

/** Everything this member has pulled. Never anything they haven't. */
export function useMySecrets(participantId: string | null | undefined) {
  const fn = useServerFn(getMySecrets);
  return useQuery({
    queryKey: mySecretsKey(participantId),
    queryFn: () => fn() as Promise<{ cards: OwnedSecret[]; pulled: number }>,
    enabled: !!participantId,
    staleTime: 5 * 60_000,
  });
}
