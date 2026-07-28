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
  return `Packed by ${count}`;
}
