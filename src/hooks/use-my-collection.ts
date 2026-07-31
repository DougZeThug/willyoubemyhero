import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyCardStats } from "@/lib/card-pulls.functions";
import { dupeCount, type MyCardStats } from "@/lib/card-pulls";
import { forgetCards, loadCollection, type CollectedCard } from "@/lib/card-collection";
import { mergeCollection } from "@/lib/collection-merge";
import { useMemberSession } from "@/lib/member-token";

export const myCardStatsKey = (eventId: string | null | undefined, participantId?: string | null) =>
  ["my-card-stats", eventId, participantId ?? null] as const;

export type MyCollection = {
  /** `event_participants.id` → the card, reconciled against the server. */
  collection: Record<string, CollectedCard>;
  /** Cards of this event's roster that you hold. */
  collectedCount: number;
  packsOpened: number;
  /** Pulls beyond the first of each card. */
  dupes: number;
  firstPackOn: string | null;
  /**
   * False until the real number is known.
   *
   * The whole point of this hook is that the local store lies, so a caller must
   * render a placeholder rather than a count while this is false. Flashing the
   * old inflated number for a frame before it snaps down is the bug, briefly.
   */
  ready: boolean;
  /** True once a claimed member has been resolved on this device. */
  isMember: boolean;
  /** Optimistically add a card the pack screen has just revealed. */
  markCollected: (eventParticipantId: string, tier: string) => void;
};

/**
 * Your card collection, with the server as the source of truth.
 *
 * Replaces the `loadCollection()` effect that each of the three card screens used
 * to run for itself. Those read a store that had been inflated by the old
 * collect-on-sight behaviour and never corrected; this reconciles against
 * `card_pulls` and deletes what it disowns. See `collection-merge.ts` for why the
 * server replaces rather than merges.
 *
 * @param rosterIds the event's `event_participants.id`s. Cards outside it are left
 *   alone — another event's collection is not this event's business.
 */
export function useMyCollection(
  eventId: string | null | undefined,
  rosterIds: readonly string[],
): MyCollection {
  const member = useMemberSession();
  const participantId = member?.participantId ?? null;

  const [local, setLocal] = useState<Record<string, CollectedCard>>({});
  const [localLoaded, setLocalLoaded] = useState(false);
  // Cards revealed on this screen, just now, as pulls to *add* rather than as
  // finished rows. Held apart from `local` because the server has not been told
  // about them yet, and a card the server has not vouched for is exactly what the
  // merge is built to delete — without this a card would light up as you flipped
  // it and then vanish. A delta rather than a replacement so a card you already
  // owned still reads "Pulled ×3" and not "×1".
  const [bumps, setBumps] = useState<Record<string, { n: number; tier: string; at: number }>>({});

  useEffect(() => {
    let cancelled = false;
    void loadCollection().then((c) => {
      if (cancelled) return;
      setLocal(c);
      setLocalLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const fn = useServerFn(getMyCardStats);
  const stats = useQuery({
    queryKey: myCardStatsKey(eventId, participantId),
    queryFn: () => fn({ data: { eventId: eventId! } }) as Promise<MyCardStats>,
    enabled: !!eventId && !!participantId,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    // A member whose token has just expired should see their local collection, not
    // a retry storm against a handler that will keep refusing them.
    retry: false,
  });

  // `useMemberSession` starts null and hydrates in an effect, so "no member" and
  // "not looked yet" are the same value on the first render. `localLoaded` settles
  // asynchronously and therefore strictly after that effect has run, which makes it
  // the signal that the member session is now trustworthy.
  const settled = localLoaded && (!participantId || stats.isSuccess || stats.isError);

  const roster = useMemo(() => new Set(rosterIds), [rosterIds]);

  const merged = useMemo(() => {
    if (!settled) return { collection: local, stale: [] as string[] };
    // A failed query falls back to the guest path rather than wiping anything:
    // without an answer from the server there is nothing to disown a row with.
    return mergeCollection(local, stats.data?.cards ?? null, roster);
  }, [settled, local, stats.data, roster]);

  // The tear reports the whole pack to the server and invalidates this query, so a
  // fresh answer already contains everything the bumps were standing in for.
  // Keeping them past that point would count each of today's cards twice.
  useEffect(() => {
    if (!stats.data) return;
    setBumps((prev) => (Object.keys(prev).length === 0 ? prev : {}));
  }, [stats.data]);

  const collection = useMemo(() => {
    const out = { ...merged.collection };
    for (const [id, bump] of Object.entries(bumps)) {
      const existing = out[id];
      out[id] = existing
        ? { ...existing, count: existing.count + bump.n }
        : { eventParticipantId: id, pulledAt: bump.at, count: bump.n, tier: bump.tier };
    }
    return out;
  }, [merged.collection, bumps]);

  const staleKey = merged.stale.filter((id) => !bumps[id]).join(",");
  useEffect(() => {
    if (!staleKey) return;
    void forgetCards(staleKey.split(","));
  }, [staleKey]);

  const markCollected = useCallback((eventParticipantId: string, tier: string) => {
    setBumps((prev) => {
      const existing = prev[eventParticipantId];
      return {
        ...prev,
        [eventParticipantId]: existing
          ? { ...existing, n: existing.n + 1 }
          : { n: 1, tier, at: Date.now() },
      };
    });
  }, []);

  const collectedCount = useMemo(
    () => rosterIds.filter((id) => collection[id]).length,
    [rosterIds, collection],
  );

  return {
    collection,
    collectedCount,
    packsOpened: stats.data?.packsOpened ?? 0,
    dupes: dupeCount(stats.data?.cards ?? []),
    firstPackOn: stats.data?.firstPackOn ?? null,
    ready: settled,
    isMember: !!participantId,
    markCollected,
  };
}
