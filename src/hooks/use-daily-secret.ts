import { mySecretsKey } from "@/lib/query-keys";
import { guestIdentity, memberIdentity } from "@/lib/identity";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMySecrets } from "@/lib/secret-cards.functions";
import type { OwnedSecret } from "@/lib/secret-cards";
import { useMemberSession } from "@/lib/member-token";
import { useGuestSession } from "@/lib/guest-token";

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
  if (member) return memberIdentity(member.participantId);
  return guest ? guestIdentity(guest.guestId) : null;
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
