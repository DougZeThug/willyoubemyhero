import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyCardStats } from "@/lib/card-pulls.functions";
import { dupeCount, type MyCardStats } from "@/lib/card-pulls";
import {
  forgetCards,
  loadCollection,
  loadUnrecorded,
  PACK_STATE_CHANGED,
  type CollectedCard,
  type UnrecordedPulls,
} from "@/lib/card-collection";
import { bestEdition, type Edition } from "@/lib/card-edition";
import { mergeCollection } from "@/lib/collection-merge";
import { useMemberSession } from "@/lib/member-token";

export const myCardStatsKey = (eventId: string | null | undefined, participantId?: string | null) =>
  ["my-card-stats", eventId, participantId ?? null] as const;

const EMPTY_IDS: ReadonlySet<string> = new Set();

/**
 * Whether a re-read found the same row as the last one.
 *
 * `savePackState` announces itself on every card turned over, so this is read
 * several times a pack. Handing back a fresh object each time is a new `merged`,
 * a new `collection` and a re-render of every card on the vault for an answer
 * that did not change.
 */
function sameRow(a: UnrecordedPulls | null, b: UnrecordedPulls | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.identity === b.identity &&
    a.ids.length === b.ids.length &&
    a.ids.every((id, i) => b.ids[i] === id)
  );
}

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
 * @param eventFailed the active-event read failed, as opposed to not having
 *   answered yet. See `settled` below for what hung without it.
 */
export function useMyCollection(
  eventId: string | null | undefined,
  rosterIds: readonly string[],
  eventFailed = false,
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

  // Pulls this device made that the server has not been told about, straight off
  // IndexedDB. Read here rather than handed in: every screen that shows a card
  // has to honour them, and the pack screen — the only thing that writes them —
  // is not mounted on any of the others.
  const [unrecorded, setUnrecorded] = useState<UnrecordedPulls | null>(null);
  const [unrecordedLoaded, setUnrecordedLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const read = () =>
      void loadUnrecorded().then((u) => {
        if (cancelled) return;
        setUnrecorded((prev) => (sameRow(prev, u) ? prev : u));
        setUnrecordedLoaded(true);
      });
    read();
    window.addEventListener(PACK_STATE_CHANGED, read);
    return () => {
      cancelled = true;
      window.removeEventListener(PACK_STATE_CHANGED, read);
    };
  }, []);

  const protectedIds = useMemo(() => {
    if (!unrecorded || unrecorded.ids.length === 0) return EMPTY_IDS;
    // A row belongs to whoever pulled it, and a handset changes hands in this
    // league. Holding the previous member's unreported cards back from the prune
    // would show them in this one's vault as cards they own — and the merge
    // disowns that person's collected rows here regardless, recorded or not.
    // Derived rather than filtered at read time so claiming a player re-decides
    // it without a remount.
    if (participantId && unrecorded.identity && unrecorded.identity !== `m:${participantId}`) {
      return EMPTY_IDS;
    }
    return new Set(unrecorded.ids);
  }, [unrecorded, participantId]);

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
  //
  // A member with no event id is the case that used to hang here forever: the
  // stats query is gated on one, so with the active-event read down it never
  // runs, never succeeds and never errors. The screens read that as "still
  // reconciling" and lock every card face-down without saying why. `eventFailed`
  // is the caller distinguishing a read that failed from one that is merely slow;
  // the merge then runs against no server answer at all, which by its first rule
  // hands the local store back untouched and prunes nothing.
  //
  // `unrecordedLoaded` is the second half of `localLoaded`, and it is here for
  // the same reason: these are two separate IndexedDB reads, and reconciling
  // after the first has landed but not the second means merging with an empty
  // protection set — which deletes the very cards the row was written to save.
  const settled =
    localLoaded &&
    unrecordedLoaded &&
    (!participantId || stats.isSuccess || stats.isError || (eventFailed && !eventId));

  const roster = useMemo(() => new Set(rosterIds), [rosterIds]);

  const merged = useMemo(() => {
    // Empty rather than `local` until the server has answered. The local store is
    // the thing this hook exists to distrust — handing it out here would put the
    // old inflated ticks on the vault and "Collected" on a card slab for as long
    // as the query takes, which is the bug with a shorter fuse rather than a fix.
    // `ready` gates the counters; this gates everything else that reads a card.
    if (!settled) return { collection: {}, stale: [] as string[] };
    // A failed query leaves the local store exactly as it is: with no answer from
    // the server there is nothing to disown a row with, so nothing is disowned.
    return mergeCollection(local, stats.data?.cards ?? null, roster, protectedIds);
  }, [settled, local, stats.data, roster, protectedIds]);

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
    // `protectedIds` is already held out of `stale` by the merge. Repeated at the
    // one site that actually deletes, because that is where the rule has to hold:
    // this is the only irreversible step in the hook, and it should not depend on
    // a caller three modules away having passed the right fourth argument.
    const fresh = merged.stale.filter(
      (id) => !forgottenRef.current.has(id) && !bumps[id] && !protectedIds.has(id),
    );
    if (fresh.length === 0) return;
    for (const id of fresh) forgottenRef.current.add(id);
    void forgetCards(fresh);
  }, [merged.stale, bumps, protectedIds]);

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
