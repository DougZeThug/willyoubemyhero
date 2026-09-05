import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getRecentAcquisitions, type RecentAcquisitions } from "@/lib/acquisitions.functions";
import { useMemberSession } from "@/lib/member-token";

/**
 * What arrived since `since`, for the member holding this phone.
 *
 * Keyed on the member as well as the window, so a handset that changes hands
 * cannot serve the previous person's arrivals out of cache — the same reasoning
 * `mySecretsKey` and `myCardStatsKey` are keyed on an identity rather than on the
 * event alone.
 *
 * The vault and the player page both mount this with the same arguments, which is
 * deliberate: the key is identical, so the second one is served from cache rather
 * than issuing a second request for an answer that is already in hand.
 */
export const recentAcquisitionsKey = (
  eventId: string | null | undefined,
  participantId: string | null | undefined,
  since: string | null | undefined,
) => ["recent-acquisitions", eventId, participantId, since] as const;

export function useRecentAcquisitions(eventId: string | null, since: string | null) {
  const member = useMemberSession();
  const participantId = member?.participantId ?? null;
  const fn = useServerFn(getRecentAcquisitions);
  return useQuery({
    queryKey: recentAcquisitionsKey(eventId, participantId, since),
    queryFn: () =>
      fn({ data: { eventId: eventId!, since: since! } }) as Promise<RecentAcquisitions>,
    // `since` is null on a device that has never stored a last-visit instant, and
    // that is the silent first visit rather than a window of zero length.
    enabled: !!eventId && !!since && !!participantId,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    // A member whose token has just expired should see the vault they already
    // have, not a retry storm against a handler that will keep refusing them.
    retry: false,
  });
}
