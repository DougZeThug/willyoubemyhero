// Reconciling this device's card collection with the league's record of it.
//
// Two problems land here at once.
//
// The first is historical. The card page used to call `collectCard` on sight, so
// simply walking the vault — which arrow keys and the filmstrip make a few seconds'
// work — collected the entire roster. That write was removed, but the rows it had
// already made were not, and nothing has ever cleared them: `card-collection.ts`'s
// upgrade callback only adds missing stores, and `clearCollection` is called from
// tests only. A member who had opened one pack was still being told they held all
// eighteen cards.
//
// The second is structural. IndexedDB is per-device, so a collection did not follow
// anybody to a new phone, and no amount of care with the local store fixes that.
//
// `card_pulls` is the answer to both. Its primary key is (person, card), it is
// written only by a pack tear, and a live check against production found exactly
// three rows for the member who was seeing eighteen. It cannot inflate. So for a
// claimed member the server is not merged with the local store, it *replaces* it,
// and whatever the local store had left over is deleted.
//
// A guest is left completely alone. There was briefly a cutoff here that dropped
// anything a guest's device recorded before collect-on-sight was removed, but a
// browse and a pull wrote identical rows back then — the heuristic could not tell
// them apart, and unlike a member there is no server record to restore a genuine
// pull it guessed wrong about. Better an honestly unadjudicated number than a
// confidently deleted card.
//
// The one exception to the server replacing the local store is a pull the server
// has never been told about. `recordCardPulls` is fire-and-forget and can fail
// for a whole day in a garden dead spot, and the cards it never reported are
// already in the local store the moment they are turned over — so the rule above
// deleted exactly the pulls that most needed keeping. "Not vouched for" is only
// "not owned" once a record has succeeded at least once, so `protectedIds` holds
// those ids out of the prune until it has. See `card-collection.ts`'s unrecorded
// row, which is what outlives the page and answers this question.

import type { CollectedCard } from "./card-collection";
import type { MyCard } from "./card-pulls";

export type MergeResult = {
  /** What the screens should show. */
  collection: Record<string, CollectedCard>;
  /** Local keys to delete, so the wrong number cannot come back on the next load. */
  stale: string[];
};

/**
 * Reconcile the local collection against the server's, if there is one.
 *
 * @param local        everything in this device's `collected` store.
 * @param server       your own `card_pulls` rows, or null when nobody is claimed here.
 * @param rosterIds    the cards of the event on screen.
 * @param protectedIds pulls the server has not been told about yet.
 *
 * `rosterIds` scopes the prune, not the result: a card from another event is
 * outside the server query and so is never something this can disown.
 */
export function mergeCollection(
  local: Record<string, CollectedCard>,
  server: readonly MyCard[] | null,
  rosterIds: ReadonlySet<string>,
  protectedIds: ReadonlySet<string> = new Set(),
): MergeResult {
  // Nobody claimed on this device: nothing can adjudicate these rows, so nothing
  // touches them.
  if (server === null) return { collection: local, stale: [] };

  const collection: Record<string, CollectedCard> = {};
  for (const card of server) {
    const prior = local[card.eventParticipantId];
    collection[card.eventParticipantId] = {
      eventParticipantId: card.eventParticipantId,
      // The server holds the authoritative first pull; the local row is only
      // consulted for `tier`, which is a rendering detail Postgres has no column
      // for. A card pulled on another phone therefore arrives with tier "base"
      // until this device sees it, which is a colour, not a number.
      pulledAt: Date.parse(card.firstPulledAt) || prior?.pulledAt || Date.now(),
      count: card.pullCount,
      tier: prior?.tier ?? "base",
      // THE SERVER'S OUTRIGHT, and this used to take the better of the two.
      //
      // That was correct while a finish could only ever rise: `record_card_pulls`
      // applies best-wins, so the server's number could lag the device's but never
      // legitimately fall below it, and taking the better protected a genuine pull
      // the server had somehow missed.
      //
      // Trading broke that premise. `card_pulls.edition` is derived from the
      // copies you hold (`resync_card_pull`), so handing your only platinum to
      // somebody else lowers it — honestly. Taking the better would pin the
      // platinum on the giver's own device forever, showing them a card they no
      // longer own in a finish that is now somebody else's.
      //
      // The guest-era case the old rule protected is already covered without it:
      // a card the server does not vouch for is not demoted, it is pruned as
      // `stale` below.
      edition: card.edition,
    };
  }

  // Anything local that the server does not vouch for. Restricted to this event's
  // roster: a key belonging to another event is not ours to judge, let alone delete.
  // A protected id is not on trial at all — the server has not been asked about
  // it yet, so its silence says nothing. See the note at the top of this file.
  const stale = Object.keys(local).filter(
    (id) => rosterIds.has(id) && !collection[id] && !protectedIds.has(id),
  );

  // Cards the server did not list, passed through rather than dropped: another
  // event's, which is outside both the server query and the prune, and an
  // unreported pull, which is this device's own word for the card until the
  // league takes it. A card the server DID list is already above, on its terms.
  for (const [id, card] of Object.entries(local)) {
    if (collection[id]) continue;
    if (!rosterIds.has(id) || protectedIds.has(id)) collection[id] = card;
  }

  return { collection, stale };
}
