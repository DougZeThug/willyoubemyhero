import { loadCollection } from "./card-collection";
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
  if (ids.length === 0) return 0;
  const res = await adoptCollection({ data: { eventParticipantIds: ids } });
  return res.adopted;
}

/**
 * Exactly the ids the call above sends, ceiling and all.
 *
 * Split out because the claim has to know afterwards WHICH cards adoption
 * accounted for. A pack torn but only half turned is the case: `collectCard`
 * runs inside the reveal, so a card still face-down is in no snapshot, adoption
 * never hears about it, and the pack's record is the only thing that will ever
 * file it. See `carryPackToIdentity`, which skips re-recording these and only
 * these.
 */
export function adoptableIds(snapshot: Awaited<ReturnType<typeof loadCollection>>): string[] {
  return Object.values(snapshot)
    .slice(0, 64)
    .map((c) => c.eventParticipantId);
}

/** Read this device's collection before anything can prune it. */
export const snapshotLocalCollection = loadCollection;
