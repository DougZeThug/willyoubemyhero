import type { QueryClient } from "@tanstack/react-query";
import {
  addUnrecorded,
  loadCollection,
  loadUnrecorded,
  retireUnrecorded,
  todayKey,
} from "./card-collection";
import { adoptCollection } from "./card-pulls.functions";

/**
 * File the cards on this handset against the member it has just become.
 *
 * Base cards a guest packs are written to IndexedDB and nowhere else — the tear
 * has no participant to file `card_copies` against. So the moment a code is
 * redeemed or an account signs in, `mergeCollection` starts adjudicating that
 * store against a server record that has never heard of any of it, and
 * `forgetCards` deletes the lot. That is exactly how a player lost his base
 * cards on redeeming his code.
 *
 * Called at the identity transition and nowhere else, deliberately. Running it
 * from the collection hook would adopt whatever a device happens to hold on
 * every load — including the inflated rows the old collect-on-sight write left
 * behind, which is the very thing `mergeCollection` exists to clean up.
 *
 * SNAPSHOT FIRST, then hand the token over: the prune races this, and reading
 * the store before the app knows who it is means a delete cannot beat us to it.
 * The server keeps one copy of each card the person does not already hold, so a
 * second call adopts nothing and calling it on every claim is safe.
 *
 * Only the ids go up. The finish on a guest's card is the phone's word alone,
 * and the server files every adopted copy as standard — see
 * 20260902120000_harden_adopt_card_copies.sql for what trusting it cost.
 */
export async function adoptLocalCollection(
  snapshot: Awaited<ReturnType<typeof loadCollection>>,
): Promise<number> {
  const ids = adoptableIds(snapshot);
  let adopted = 0;
  // Sent in batches, sequentially. The handler takes a roster's worth at a
  // time, and one call used to be the whole of it — but this store spans every
  // event the handset has ever played and is never emptied, so a long-tenured
  // guest's active-roster cards could sit past the cut, go unfiled, and be
  // deleted by the reconcile that follows the very sign-in meant to save them.
  // Sequential because a burst of service-role writes from one phone at the
  // identity transition buys nothing; a chunk that throws leaves the earlier
  // ones filed, and filing is idempotent, so the retry simply re-sends all.
  for (let i = 0; i < ids.length; i += ADOPT_CHUNK) {
    const res = await adoptCollection({
      data: { eventParticipantIds: ids.slice(i, i + ADOPT_CHUNK) },
    });
    adopted += res.adopted;
  }
  return adopted;
}

/** What the handler accepts in one call; the batch size, not the total. */
const ADOPT_CHUNK = 64;

/**
 * Exactly the ids the call above sends — all of them.
 *
 * Split out because the claim has to know afterwards WHICH cards adoption
 * accounted for. A pack torn but only half turned is the case: `collectCard`
 * runs inside the reveal, so a card still face-down is in no snapshot, adoption
 * never hears about it, and the pack's record is the only thing that will ever
 * file it. See `carryPackToIdentity`, which skips re-recording these and only
 * these.
 */
export function adoptableIds(snapshot: Awaited<ReturnType<typeof loadCollection>>): string[] {
  return Object.values(snapshot).map((c) => c.eventParticipantId);
}

/** Read this device's collection before anything can prune it. */
export const snapshotLocalCollection = loadCollection;

/**
 * Hold the snapshot's cards out of the prune for the length of the adoption.
 *
 * Call it BEFORE the token lands. The moment it does, every mounted
 * `useMyCollection` — in this tab or any other on the profile — asks the server
 * what this member owns, and an adoption that has not committed yet answers
 * "nothing", which the merge reads as "delete the lot". The unrecorded row is the
 * one thing the merge already honours for exactly this ("the server has not
 * vouched for these yet"), so the guest's cards are filed under it for the member
 * they are about to become. Written first so a vault in another tab has it to
 * read by the time it hears about the token.
 */
export async function holdForAdoption(
  participantId: string,
  snapshot: Awaited<ReturnType<typeof loadCollection>>,
): Promise<void> {
  const ids = adoptableIds(snapshot);
  if (ids.length === 0) return;
  const identity = `m:${participantId}`;
  await addUnrecorded({ dayKey: todayKey(), identity, ids });
  // Read back, because `addUnrecorded` swallows a failed write by design — the
  // pack screen would rather deal a pack than stop on a blocked database. Here
  // that contract is the wrong one: a hold that was never written, reported as
  // written, lets the caller publish the member token with nothing protecting the
  // cards, which is the loss this whole step exists to prevent. Thrown, so the
  // handoff stops before the token; the code and the account still work next time.
  const row = await loadUnrecorded();
  const held = new Set(row?.identity === identity ? row.ids : []);
  if (!ids.every((id) => held.has(id))) {
    throw new Error("Could not protect your cards on this device");
  }
}

/**
 * Let go of the hold once nothing needs it.
 *
 * On success that means AFTER the stats refetch: the cached answer from before
 * the adoption is the empty one, and dropping the hold while it is still the
 * freshest word on the matter hands the prune the very cards it was holding. If
 * that refetch fails the hold stays — it costs nothing to keep and the card is
 * the one thing that cannot be had back, the same call the pack screen makes for
 * a carried card. On failure of the ADOPTION the token comes straight back off,
 * so there is no member to reconcile and the hold can go at once; `qc` is simply
 * left out.
 *
 * Deliberately announced to this tab only (see `retireUnrecorded`): another
 * tab's cached stats are not refreshed by this refetch, so it keeps holding.
 */
export async function releaseAdoptionHold(
  participantId: string,
  snapshot: Awaited<ReturnType<typeof loadCollection>>,
  qc?: QueryClient,
): Promise<void> {
  const ids = adoptableIds(snapshot);
  if (ids.length === 0) return;
  if (qc) {
    await qc.refetchQueries(
      { queryKey: ["my-card-stats"], type: "active" },
      { throwOnError: true },
    );
  }
  // Scoped to the identity the hold was filed under; see `retireUnrecorded`.
  await retireUnrecorded(ids, `m:${participantId}`);
}
