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
 * @param local     everything in this device's `collected` store.
 * @param server    your own `card_pulls` rows, or null when nobody is claimed here.
 * @param rosterIds the cards of the event on screen.
 *
 * `rosterIds` scopes the prune, not the result: a card from another event is
 * outside the server query and so is never something this can disown.
 */
export function mergeCollection(
  local: Record<string, CollectedCard>,
  server: readonly MyCard[] | null,
  rosterIds: ReadonlySet<string>,
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
    };
  }

  // Anything local that the server does not vouch for. Restricted to this event's
  // roster: a key belonging to another event is not ours to judge, let alone delete.
  const stale = Object.keys(local).filter((id) => rosterIds.has(id) && !collection[id]);

  // Cards from another event pass through untouched — they are outside both the
  // server query (which is scoped to this event) and the prune.
  for (const [id, card] of Object.entries(local)) {
    if (!rosterIds.has(id) && !collection[id]) collection[id] = card;
  }

  return { collection, stale };
}
