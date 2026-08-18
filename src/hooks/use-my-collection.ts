import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { adoptCollection, getMyCardStats } from "@/lib/card-pulls.functions";
import { dupeCount, type MyCardStats } from "@/lib/card-pulls";
import { forgetCards, loadCollection, type CollectedCard } from "@/lib/card-collection";
import { bestEdition, EDITION_IDS, type Edition } from "@/lib/card-edition";
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
  /**
   * Optimistically add a card the pack screen has just revealed.
   *
   * `count` is the absolute floor to hold — "this card has at least this many
   * pulls" — and the caller owns it, because only the caller knows what the
   * number was *before* the pack it is revealing was dealt. Deriving it here
   * from the reconciled collection double-counted: the tear tells the server
   * about the pack, and if that round trip lands before the card is turned over
   * then the number this hook holds already includes the very pull being marked.
   */
  markCollected: (
    eventParticipantId: string,
    tier: string,
    edition: Edition,
    count: number,
  ) => void;
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
  // Cards revealed on this screen, just now. Held apart from `local` because the
  // server has not been told about them yet, and a card the server has not
  // vouched for is exactly what the merge is built to delete — without this a
  // card would light up as you flipped it and then vanish.
  //
  // A floor ("this card has at least N pulls"), not a delta. A delta has to be
  // retracted at exactly the right moment: too early and the card blinks out,
  // too late and it is counted twice on top of the server's own row. A floor is
  // monotonic, so it can be held until the server's number catches up to it and
  // dropped then, and neither mistake is possible in between.
  const [bumps, setBumps] = useState<
    Record<string, { count: number; tier: string; edition: Edition; at: number }>
  >({});

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

  // ---- ADOPTION ----
  // Cards this phone holds that the league has no record of. For a guest that is
  // every card they have ever packed: a guest's tear writes no card rows at all,
  // so the collection exists only here. The moment they claim, the merge below
  // would disown exactly those rows and forgetCards would delete them — which is
  // how a real player lost his base cards on redeeming his code.
  //
  // So before anything is pruned, they are filed against the name that just
  // claimed. The server keeps one copy per card and ignores cards already held,
  // so running this on every claim is safe and doing it twice changes nothing.
  const adoptFn = useServerFn(adoptCollection);
  const [adopting, setAdopting] = useState(false);
  // Keyed by participant, so signing in as somebody else on a shared handset
  // gets its own single attempt rather than inheriting the previous one's. State
  // rather than a ref because the merge below reads it: latching has to re-run it.
  const [adoptedFor, setAdoptedFor] = useState<string | null>(null);
  // The ids just uploaded. The refetch that would confirm them is in flight, so
  // these are held out of the prune until an answer arrives that includes them —
  // otherwise the merge disowns the very rows adoption just rescued.
  const [adoptedIds, setAdoptedIds] = useState<readonly string[]>([]);

  useEffect(() => {
    if (!participantId || !localLoaded || !stats.isSuccess) return;
    if (adoptedFor === participantId) return;

    const served = new Set((stats.data?.cards ?? []).map((c) => c.eventParticipantId));
    const orphans = Object.values(local).filter(
      (c) => roster.has(c.eventParticipantId) && !served.has(c.eventParticipantId),
    );
    // Nothing to rescue is still an answer: latch it so the pruning gate opens.
    if (orphans.length === 0) {
      setAdoptedFor(participantId);
      return;
    }

    setAdopting(true);
    void (async () => {
      const ids = orphans.map((c) => c.eventParticipantId).slice(0, 64);
      try {
        await adoptFn({
          data: {
            eventParticipantIds: ids,
            editions: orphans
              .slice(0, 64)
              .map((c) =>
                (EDITION_IDS as readonly string[]).includes(c.edition ?? "")
                  ? (c.edition as Edition)
                  : "standard",
              ),
          },
        });
        // The server now vouches for them. The refetch is deliberately not
        // awaited — a query that never settles must not hold the collection
        // hostage — so `adoptedIds` carries them until it lands.
        setAdoptedIds(ids);
        void stats.refetch();
      } catch {
        // A failed adoption must not cost anybody a card: the gate below keeps
        // the local rows exactly where they are, and the next load tries again.
        setAdoptedIds(ids);
      } finally {
        setAdoptedFor(participantId);
        setAdopting(false);
      }
    })();
  }, [
    participantId,
    localLoaded,
    adoptedFor,
    stats.isSuccess,
    stats.data,
    local,
    roster,
    adoptFn,
    stats,
  ]);

  const merged = useMemo(() => {
    // Empty rather than `local` until the server has answered. The local store is
    // the thing this hook exists to distrust — handing it out here would put the
    // old inflated ticks on the vault and "Collected" on a card slab for as long
    // as the query takes, which is the bug with a shorter fuse rather than a fix.
    // `ready` gates the counters; this gates everything else that reads a card.
    if (!settled) return { collection: {}, stale: [] as string[] };
    // An adoption in flight — or one not attempted yet for this member — means
    // the server's answer is knowably incomplete, so nothing is adjudicated
    // against it. The local rows stand until the upload has had its go.
    if (participantId && (adopting || adoptedFor !== participantId)) {
      return { collection: local, stale: [] as string[] };
    }
    // Adopted-but-unconfirmed cards are held out of the roster the prune is
    // scoped to, which leaves their local rows standing instead of deleting them.
    const served = new Set((stats.data?.cards ?? []).map((c) => c.eventParticipantId));
    const scope = adoptedIds.some((id) => !served.has(id))
      ? new Set([...roster].filter((id) => served.has(id) || !adoptedIds.includes(id)))
      : roster;
    // A failed query leaves the local store exactly as it is: with no answer from
    // the server there is nothing to disown a row with, so nothing is disowned.
    return mergeCollection(local, stats.data?.cards ?? null, scope);
  }, [settled, local, stats.data, roster, participantId, adopting, adoptedFor, adoptedIds]);

  // Drop a floor once the server's own row has reached it. Not on "a response
  // arrived" — a refetch already in flight when the card was revealed knows
  // nothing about it, and clearing against that one blinks the card off the
  // screen. Comparing the numbers instead means a stale response, a failed one,
  // or none at all simply leaves the floor standing.
  useEffect(() => {
    setBumps((prev) => {
      const kept = Object.entries(prev).filter(
        ([id, b]) => (merged.collection[id]?.count ?? 0) < b.count,
      );
      if (kept.length === Object.keys(prev).length) return prev;
      return Object.fromEntries(kept);
    });
  }, [merged.collection]);

  const collection = useMemo(() => {
    const out = { ...merged.collection };
    for (const [id, bump] of Object.entries(bumps)) {
      const existing = out[id];
      out[id] = existing
        ? {
            ...existing,
            count: Math.max(existing.count, bump.count),
            // Same floor logic the count uses: the finish only rises, so a reveal
            // cannot show a worse copy than the server already vouches for.
            edition: bestEdition(existing.edition, bump.edition),
          }
        : {
            eventParticipantId: id,
            pulledAt: bump.at,
            count: bump.count,
            tier: bump.tier,
            edition: bump.edition,
          };
    }
    return out;
  }, [merged.collection, bumps]);

  // Delete each disowned row once and remember that we did. Keyed off a set
  // rather than off the stale list itself because that list is rebuilt on every
  // reconciliation *and* every reveal — turning a card over removes it from the
  // list, which used to re-fire the whole delete for everything still on it.
  const forgottenRef = useRef(new Set<string>());
  useEffect(() => {
    // Never delete a local row while an adoption is in flight, or before one has
    // been attempted for this member. This is the guard that turns "the server
    // has not been told yet" into "wait", rather than "forget it".
    if (adopting || (participantId && adoptedForRef.current !== participantId)) return;
    const fresh = merged.stale.filter((id) => !forgottenRef.current.has(id) && !bumps[id]);
    if (fresh.length === 0) return;
    for (const id of fresh) forgottenRef.current.add(id);
    void forgetCards(fresh);
  }, [merged.stale, bumps, adopting, participantId]);

  const markCollected = useCallback(
    (eventParticipantId: string, tier: string, edition: Edition, count: number) => {
      setBumps((prev) => {
        // Never lowered, so marking the same card twice is a no-op rather than a
        // card that blinks backwards.
        const floor = Math.max(prev[eventParticipantId]?.count ?? 0, count);
        return {
          ...prev,
          [eventParticipantId]: {
            count: floor,
            tier: prev[eventParticipantId]?.tier ?? tier,
            // Best rather than first, unlike `tier` beside it: two reveals of one
            // card in a session should leave the better finish showing.
            edition: bestEdition(prev[eventParticipantId]?.edition, edition),
            at: prev[eventParticipantId]?.at ?? Date.now(),
          },
        };
      });
    },
    [],
  );

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
