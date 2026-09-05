// What the card viewer wanted when it sent somebody to the Trading Post.
//
// §6: "a card with spares should offer 'Offer this card' and a locked card should
// offer 'Ask for a trade'. Today trading starts from a blank form." This is how
// the one screen tells the other which card it meant.
//
// IN MEMORY, NEVER A URL. `/players/trade?give=<secretCardId>` would make a
// secret card addressable, and a URL is shareable — the one thing a secret card
// must not be (see the header of card-viewer.tsx). One code path for both halves
// of the collection is worth more here than a link somebody could bookmark.
//
// AND NEVER PERSISTED. A reload, or coming back to the Trading Post tomorrow, is
// a blank form: an intent is a thing you are in the middle of, not a preference.
// The module-level `let` follows account-sync-state.ts, minus its listener set —
// nothing renders this, it is read once by the route that consumes it.
//
// The intent names a CARD, not a copy. A staged trade item needs a `copyId` or a
// `pullId` off `getTradeSpares`, and the viewer has neither: it knows which card
// you tapped and nothing about which of your copies of it should travel. The
// trade screen resolves that when the spares land.

export type TradeIntent = {
  /**
   * `give` is "offer this card of mine", `want` is "ask them for theirs" — the
   * same two words the compose panel's own state uses.
   */
  side: "give" | "want";
} & (
  | { kind: "roster"; eventParticipantId: string }
  /**
   * A secret travels by NAME, and that is not a shortcut.
   *
   * `getTradeSpares` answers with `{ pullId, name, artUrl, tier, … }` and no card
   * id at all, so the name is the only handle the viewer and the Trading Post
   * actually share — and it is the handle a person uses too. A card id would need
   * widening that response, which is a change to make when something needs it
   * rather than in passing here.
   *
   * `want` is roster-only. A secret you have not pulled does not exist to you, so
   * there is nothing to ask for and no screen that could offer it.
   */
  | { kind: "secret"; name: string }
);

let pending: TradeIntent | null = null;

export function setTradeIntent(next: TradeIntent) {
  pending = next;
}

/**
 * Read once, and gone.
 *
 * Cleared on read rather than by the consumer, so an intent cannot outlive the
 * navigation that carried it — the failure that would leave a card staging
 * itself again every time somebody opened the Trading Post afterwards.
 */
export function takeTradeIntent(): TradeIntent | null {
  const intent = pending;
  pending = null;
  return intent;
}

/** For tests, and for a route that abandons an intent it cannot use. */
export function clearTradeIntent() {
  pending = null;
}
