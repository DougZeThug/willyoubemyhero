import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getCollectionTrophies } from "@/lib/secret-cards.functions";
import type { CollectionTrophy } from "@/lib/collection-trophies";
import { useMemberSession } from "@/lib/member-token";
import { usePackIdentity } from "@/lib/device-id";
import {
  markTrophiesCelebrated,
  setTrophySeen,
  trophyKey,
  uncelebratedTrophies,
  useTrophySeen,
} from "@/lib/trophy-seen";

export const collectionTrophiesKey = () => ["collection-trophies"] as const;

/**
 * Every finished set in the league.
 *
 * Not keyed on an actor, unlike every other collection hook here: this is public
 * data, thirteen people's worth of rows at the very most, and four surfaces read
 * it — your own shelf, the badge on a card back, somebody else's player page, and
 * the ceremony watcher below. One cache entry rather than four keeps them
 * consistent with each other.
 *
 * A PURE QUERY. The realtime subscription lives in useCollectionTrophyWatcher
 * instead, because the channel name carries a random suffix and so does not
 * dedupe: with the subscribe in here, a page that mounts the watcher AND the
 * shelf would open two channels for one table.
 */
export function useCollectionTrophies() {
  const fn = useServerFn(getCollectionTrophies);
  return useQuery({
    queryKey: collectionTrophiesKey(),
    queryFn: () => fn() as Promise<{ trophies: CollectionTrophy[] }>,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Sets that have quietly become yours since the last time this device looked.
 *
 * The delivery half of the feature. The pack and trade screens fire their own
 * ceremony straight off the response, with the timing the moment deserves — after
 * the card has been turned over. Nothing else can: an admin grant runs on the
 * commissioner's phone, and the far side of a two-way trade is not the person who
 * pressed accept. For both of those, the row appearing IS the notification.
 *
 * Diff-based rather than payload-based, which is what makes it survive a missed
 * event: any refetch that reveals a trophy this device has not celebrated fires
 * it, so a grant that landed overnight is waiting when the app is next opened. It
 * is also what keeps the "INVALIDATE, NEVER MERGE" rule use-trade-nudge states —
 * the realtime event is only ever a nudge to refetch, never a source of data.
 *
 * Returns a QUEUE, because a single accepted trade can finish two sets at once
 * and showing one of them would be worse than showing neither.
 */
export function useCollectionTrophyWatcher() {
  const qc = useQueryClient();
  const me = useMemberSession();
  const participantId = me?.participantId ?? null;
  // `m:<participantId>` for a member, `d:<deviceId>` for a guest, null until
  // the browser has answered. It is the "we know who this device is" signal the
  // priming pass below needs, which a participant id alone cannot give.
  const identity = usePackIdentity();
  const trophies = useCollectionTrophies();
  const seen = useTrophySeen();
  const [queue, setQueue] = useState<CollectionTrophy[]>([]);
  // Whether this render has already been through the seeding pass. A ref rather
  // than state: flipping it must not itself cause a render, and it must survive
  // the one the seed write fans out.
  const primedRef = useRef(false);

  useEffect(() => {
    const channel = supabase
      // The random suffix is what lets two tabs hold their own channel, same as
      // useTradeFeed.
      .channel(`collection-trophies:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "collection_trophies" },
        () => {
          // INSERT only: a trophy is written once and never updated. The payload
          // is deliberately ignored — it carries no label, and the effect below
          // reads the refreshed query instead.
          qc.invalidateQueries({ queryKey: collectionTrophiesKey() });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  const rows = trophies.data?.trophies;

  const fresh = useMemo(
    () => uncelebratedTrophies(rows ?? [], participantId, seen),
    [rows, participantId, seen],
  );

  useEffect(() => {
    // Not "nothing is mine" — "we do not know yet". useMemberSession reports null
    // on the SSR and hydration renders even for a claimed member, and the trophy
    // query has no `enabled` gate, so the list routinely settles first. Priming in
    // that window would either bank somebody else's shelf or, worse, leave this
    // device unprimed and fire for every trophy the instant the token lands.
    //
    // The GATE is the pack identity, which is `d:<deviceId>` for a guest — so a
    // device primes while it is still a guest, when it owns no trophies and the
    // pass is a silent no-op. Waiting for a participant id meant a guest never
    // primed at all, and the claim that banks their finished set through
    // claim_guest_secrets WAS the priming pass that swallowed it: the set was
    // complete and nothing marked it, on the one path where it is most earned.
    if (!identity || !rows) return;

    if (!seen.primed && !primedRef.current) {
      // First run on this device: absorb what is already there and say nothing.
      // The same "do not celebrate history" pass useFinishWatcher makes, kept in
      // storage rather than a ref so it survives a reload.
      primedRef.current = true;
      setTrophySeen({
        primed: true,
        ids: participantId
          ? [...seen.ids, ...fresh.map((t) => trophyKey(participantId, t.collection))]
          : [...seen.ids],
      });
      return;
    }

    if (!participantId || fresh.length === 0) return;
    // Marked before it is shown, not after. The host can be unmounted by a
    // navigation mid-ceremony, and a trophy that fires forever because nobody
    // dismissed it is worse than one somebody scrolled past.
    markTrophiesCelebrated(fresh.map((t) => trophyKey(participantId, t.collection)));
    setQueue((q) => [...q, ...fresh]);
  }, [identity, participantId, rows, fresh, seen]);

  return {
    queue,
    /** Drop the one on screen and move to the next. */
    shift: () => setQueue((q) => q.slice(1)),
  };
}
