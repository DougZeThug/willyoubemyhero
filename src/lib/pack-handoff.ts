// The seam between the opening ceremony and the reveal stand, as arithmetic.
//
// The ceremony's cards and the stand's card are different components — they have
// to be, because the stand's is a HoloCard with a tilt controller, a foil stack
// and button semantics, and none of that belongs in a fan of four flying backs.
// So continuity here is *constructed*, never inherited, and the whole question is
// who computes the geometry.
//
// The answer is: nobody computes it. It is read. The ceremony's cards sit inside
// a clipped, flattened subtree, under a rotated pack, under two perspectives, at
// a scale taken off a measured pack width — and `getBoundingClientRect()` has
// already resolved every one of those. `clip-path` clips paint, not boxes, so the
// rect is exact even though the card is visually cut. Modelling that chain a
// second time, in a different component, could only ever be subtly wrong.

/** Where a card is on screen, as the middle of it. */
export type CardCentre = { cx: number; cy: number };

/**
 * What the opening ceremony hands the stand: where its deck was, and how big.
 *
 * Viewport pixels, because that is the only space the two ends agree on. The
 * ceremony sizes its cards as a percentage of a measured 320px pack; the stand
 * sizes its own with a `min()` against `100svh`. Neither number is derivable from
 * the other, and both have already been resolved by the time this is taken.
 */
export type PackHandoff = {
  /**
   * The width of the *front* card, used for every card in the deck.
   *
   * `getBoundingClientRect` answers with the axis-aligned box of a rotated
   * element, so the card at the back of the deck — which the gather leaves a few
   * degrees off square — measures several percent wider than it actually is.
   * Card 0 is the only one the deck lands exactly square, which is why it is the
   * only one worth measuring.
   */
  w: number;
  cards: CardCentre[];
};

/** A flying card's starting transform, relative to where it is going. */
export type CardEntry = { x: number; y: number; scale: number };

/**
 * The transform that puts a card the stand is about to hold exactly where the
 * ceremony left it.
 *
 * Centres rather than corners, because motion composes `translate` before `scale`
 * and scales about the element's own middle — so matching centres and widths *is*
 * the whole reconciliation. Corners would need the scale unwound by hand.
 *
 * Only the start is computed here. The end is always the card's resting
 * transform, which is identity for the card on the stand and `standDeckOffset`
 * for the ones behind it.
 */
export function entryTransform(from: CardCentre, fromW: number, slot: SlotRect): CardEntry {
  return {
    x: from.cx - (slot.left + slot.width / 2),
    y: from.cy - (slot.top + slot.height / 2),
    // A slot with no layout yet would divide by zero and put the card at
    // infinity. The caller is expected to have skipped the entrance entirely in
    // that case; this is the belt to that pair of braces.
    scale: slot.width > 0 ? fromW / slot.width : 1,
  };
}

/**
 * The part of a DOMRect this module needs.
 *
 * Structural so the tests can pass plain objects — a DOMRect cannot be built
 * without a browser, and the arithmetic here is the thing worth checking.
 */
export type SlotRect = { left: number; top: number; width: number; height: number };

/**
 * Where card `i` of the remaining pack rests behind the one on the stand.
 *
 * Against the slot's own width rather than in fixed pixels, so the stack reads
 * the same on a 320px card and on the 200px one a short phone gets.
 *
 * Shared by the landing and by the resting deck, which is the only reason the
 * swap between them is invisible. Note the off-by-one that falls out of that:
 * the entrance flies card `i` to `standDeckOffset(i)`, while the resting deck
 * renders its card `i` at `standDeckOffset(i + 1)` — because the resting deck
 * never draws the hero, which is the real card on the stand.
 */
export function standDeckOffset(i: number, width: number): CardEntry {
  const step = width * 0.016;
  return { x: i * step, y: i * step * 1.4, scale: 1 - i * 0.02 };
}

/**
 * Where card `i` of the *resting* deck sits — the stack left behind the stand
 * once the flight has landed.
 *
 * This exists so the off-by-one is written down once instead of at two call
 * sites. The flight carries the hero as its card 0; the resting deck does not
 * draw the hero at all, because by then the hero is a real HoloCard the stand
 * owns. So the resting deck's first card is the flight's second.
 *
 * Getting that wrong makes the whole stack jump one slot at the moment the
 * flight lands, which looks like the deck settling — so it is easy to ship and
 * hard to notice.
 */
export function restingDeckOffset(i: number, width: number): CardEntry {
  return standDeckOffset(i + 1, width);
}

/**
 * How many cards of depth are worth painting behind the stand.
 *
 * The pack is three cards most days and four on a day with a drop. Past three
 * the offsets are smaller than the shadow between them and it stops adding
 * anything but overdraw.
 */
export const STAND_DECK_MAX = 3;

/**
 * Whether there is anything to fly.
 *
 * jsdom measures every element as zero, a skipped ceremony has no cards to
 * measure, and reduced motion never renders them at all. All three mean the same
 * thing — the stand mounts the way it always did — so they get one answer.
 */
export function canFly(from: PackHandoff | null | undefined, slot: SlotRect | null): boolean {
  return !!from && from.w > 0 && from.cards.length > 0 && !!slot && slot.width > 0;
}
