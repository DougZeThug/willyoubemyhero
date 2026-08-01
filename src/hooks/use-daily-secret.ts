import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMySecrets, getSecretStatus } from "@/lib/secret-cards.functions";
import type { OwnedSecret, SecretDayStatus } from "@/lib/secret-cards";
import { useMemberSession } from "@/lib/member-token";
import { useGuestSession } from "@/lib/guest-token";

/**
 * Keyed on whoever is asking, never on the event.
 *
 * The secret set is a permanent league collection, so an event id in the key
 * would evict somebody's whole collection every year — deliberately different
 * from ["event-social", eventId] next door.
 *
 * The key is an *actor* rather than a participant, because a guest holds secrets
 * too. It is only a cache key: the server takes the identity from the verified
 * token on the request and never from anything the client passes.
 */
export const secretStatusKey = (actorId: string | null | undefined) =>
  ["daily-secret", actorId] as const;
export const mySecretsKey = (actorId: string | null | undefined) =>
  ["my-secrets", actorId] as const;

/**
 * Who this device is pulling as: `m:<participantId>`, `g:<guestId>`, or null
 * before either has hydrated.
 *
 * A member always wins, matching `optionalActor()` on the server — a claimed
 * player on a phone that once held a guest token must not split their collection
 * across two cache entries when the server has merged them into one.
 *
 * `useMemberSession` is called first and in the same hook on purpose, exactly as
 * `usePackIdentity` does it: both settle from a mount effect, so React batches the
 * two updates and a member never sees a guest-keyed frame first.
 */
export function useSecretActor(): string | null {
  const member = useMemberSession();
  const guest = useGuestSession();
  if (member) return `m:${member.participantId}`;
  return guest ? `g:${guest.guestId}` : null;
}

/**
 * Is there a card waiting today?
 *
 * No realtime subscription: the tables behind this are deliberately absent from
 * the realtime publication, because a broadcast would tell every connected phone
 * that somebody just pulled something. Window focus is refresh enough for a
 * once-a-day drop.
 */
export function useSecretStatus(actorId: string | null | undefined) {
  const fn = useServerFn(getSecretStatus);
  return useQuery({
    queryKey: secretStatusKey(actorId),
    queryFn: () => fn() as Promise<SecretDayStatus>,
    // Gated on the actor, so signing in as somebody else in a garden never
    // paints the previous person's state out of the cache.
    enabled: !!actorId,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

/** Everything this person has pulled. Never anything they haven't. */
export function useMySecrets(actorId: string | null | undefined) {
  const fn = useServerFn(getMySecrets);
  return useQuery({
    queryKey: mySecretsKey(actorId),
    queryFn: () => fn() as Promise<{ cards: OwnedSecret[]; pulled: number }>,
    enabled: !!actorId,
    staleTime: 5 * 60_000,
  });
}
