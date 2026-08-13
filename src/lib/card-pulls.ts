// How many people have packed each card.
//
// Client-safe. The counts are a league-wide aggregate and deliberately carry no
// denominator: "Packed by 7", never "7 of 13". A denominator over the roster
// would be a promise the numerator cannot keep — only claimed members can be
// counted, so every card would look rarer than it is — and a denominator over
// claimed members quietly announces how many of the group have signed in. It also
// means no response anywhere in this app carries a total, which is what keeps the
// secret set's size protected by construction rather than by care.

/** `event_participants.id` → how many distinct people have packed it. */
export type CardPullCounts = Record<string, number>;

/**
 * The line under a card. Null when nobody has packed it yet — a card nobody has
 * found is not a card with a score of nought, and the vault is full of cards
 * nobody has got to.
 */
export function packedByLabel(count: number | undefined): string | null {
  if (!count || count <= 0) return null;
  // A lone pull reads too much like a stuck counter when the whole vault shows
  // it — "so far" makes it obviously early-days data instead.
  if (count === 1) return "Packed by 1 so far";
  return `Packed by ${count}`;
}

/** One of your own card_pulls rows. `tier` is not stored server-side. */
export type MyCard = {
  eventParticipantId: string;
  /** How many times you have pulled it. 2+ means duplicates. */
  pullCount: number;
  /**
   * Best finish you have ever pulled of this card. Unlike `tier` above, this one
   * IS stored server-side — a tier is derived from the combine and can be
   * recomputed from the bundle any time, while a finish is a fact about one pull
   * that exists nowhere else once the device forgets it.
   */
  edition: string;
  /** ISO timestamp of your first pull. */
  firstPulledAt: string;
};

/**
 * Your own pack history — the only per-member view of `card_pulls` there is.
 *
 * No total, for the reason in the header above: the "of 18" a screen shows comes
 * from the roster it already has, never from here. That keeps this response
 * incapable of leaking a set size even if it is ever widened to secrets.
 */
export type MyCardStats = {
  packsOpened: number;
  /** League day of the first and most recent pack, `YYYY-MM-DD`, or null. */
  firstPackOn: string | null;
  lastPackOn: string | null;
  cards: MyCard[];
};

/** How many packs you have opened. Null below one so a new member sees nothing. */
export function packsOpenedLabel(count: number | undefined): string | null {
  if (!count || count <= 0) return null;
  return count === 1 ? "1 pack opened" : `${count} packs opened`;
}

/**
 * Duplicates across everything you have ever pulled.
 *
 * `pullCount` is per card, so the dupes are the pulls beyond the first of each —
 * which is also why a pack of three cards you already own adds three here and
 * nothing to the collection.
 */
export function dupeCount(cards: readonly MyCard[]): number {
  return cards.reduce((n, c) => n + Math.max(0, c.pullCount - 1), 0);
}
