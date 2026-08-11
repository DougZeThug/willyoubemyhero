// The handoff arithmetic.
//
// Worth pinning precisely because it is invisible when it is right and reads as a
// jump when it is wrong — there is no in-between, and a jump on this frame undoes
// the whole point of the ceremony gathering onto the stand's mark.
import { describe, expect, it } from "vitest";
import {
  canFly,
  entryTransform,
  restingDeckOffset,
  standDeckOffset,
  STAND_DECK_MAX,
  type SlotRect,
} from "./pack-handoff";

/** A stand slot 280px wide, sitting in the middle of a phone. */
const SLOT: SlotRect = { left: 40, top: 200, width: 280, height: 392 };
const centreOf = (s: SlotRect) => ({ cx: s.left + s.width / 2, cy: s.top + s.height / 2 });

describe("entryTransform", () => {
  /**
   * The single assertion this module exists for: applying the transform to the
   * slot has to land the card exactly on its source. Anything else is a jump on
   * the first frame of the flight.
   */
  it("puts the card exactly where the ceremony left it", () => {
    const from = { cx: 160, cy: 420, w: 187, rotate: 0 };
    const entry = entryTransform(from, SLOT);

    const landedCx = SLOT.left + SLOT.width / 2 + entry.x;
    const landedCy = SLOT.top + SLOT.height / 2 + entry.y;
    expect(landedCx).toBeCloseTo(from.cx);
    expect(landedCy).toBeCloseTo(from.cy);
    expect(SLOT.width * entry.scale).toBeCloseTo(187);
  });

  it("asks for no movement at all when the two already coincide", () => {
    const entry = entryTransform({ ...centreOf(SLOT), w: SLOT.width, rotate: 0 }, SLOT);
    expect(entry).toEqual({ x: 0, y: 0, scale: 1, rotate: 0 });
  });

  /**
   * Each card keeps its own size and angle across the seam.
   *
   * The deck the ceremony hands over is a stack — every card behind the front one
   * is fractionally smaller and a degree or two off square. Starting them all at
   * the front card's size and upright made every trailing card resize and snap
   * straight on the first frame of the supposedly seamless flight.
   */
  it("starts each card at its own size and angle, not the front card's", () => {
    const back = entryTransform({ cx: 168, cy: 432, w: 176, rotate: 2.2 }, SLOT);
    const front = entryTransform({ cx: 160, cy: 420, w: 187, rotate: 0 }, SLOT);
    expect(back.scale).toBeLessThan(front.scale);
    expect(back.rotate).toBe(2.2);
    expect(front.rotate).toBe(0);
  });

  // The ceremony's card is ~187px against a stand slot of up to 320, so the card
  // grows as it comes toward the viewer. That is the beat; a scale above 1 here
  // would mean it shrank, which reads as being put away rather than handed over.
  it("grows the card on its way to the stand", () => {
    expect(entryTransform({ cx: 160, cy: 420, w: 187, rotate: 0 }, SLOT).scale).toBeLessThan(1);
  });

  it("survives a slot that has not been laid out yet", () => {
    // The caller is meant to skip the entrance entirely in this case. If it does
    // not, a card at scale Infinity fills the screen — so this answers 1 instead.
    const entry = entryTransform({ cx: 10, cy: 10, w: 187, rotate: 0 }, { ...SLOT, width: 0 });
    expect(Number.isFinite(entry.scale)).toBe(true);
    expect(entry.scale).toBe(1);
  });
});

describe("standDeckOffset", () => {
  it("leaves the card in front exactly on the mark", () => {
    expect(standDeckOffset(0, 280)).toEqual({ x: 0, y: 0, scale: 1, rotate: 0 });
  });

  it("lands the whole stack square, whatever angle it arrived at", () => {
    // The cards straighten as they land. That is the stack being tidied onto the
    // mark, and it reads as motion rather than as a jump because they travel it.
    for (let i = 0; i < 4; i++) expect(standDeckOffset(i, 280).rotate).toBe(0);
  });

  it("steps each card further back than the last", () => {
    const cards = Array.from({ length: 4 }, (_, i) => standDeckOffset(i, 280));
    for (let i = 1; i < cards.length; i++) {
      expect(cards[i].x).toBeGreaterThan(cards[i - 1].x);
      expect(cards[i].y).toBeGreaterThan(cards[i - 1].y);
      expect(cards[i].scale).toBeLessThan(cards[i - 1].scale);
    }
  });

  it("scales the stack with the card, so it reads the same on a short phone", () => {
    // Fixed pixel offsets would make the deck behind a 200px card look like a
    // much deeper stack than the one behind a 320px card.
    const wide = standDeckOffset(2, 320);
    const narrow = standDeckOffset(2, 200);
    expect(wide.x / 320).toBeCloseTo(narrow.x / 200);
  });

  /**
   * The off-by-one, which is the single easiest thing to get wrong here.
   *
   * The entrance flies card `i` to `standDeckOffset(i)`. The resting deck never
   * draws the hero, so its card `i` sits at `standDeckOffset(i + 1)`. Get that
   * wrong and the stack visibly jumps one slot at the moment the flight lands —
   * which looks like the deck settling, so it is easy to ship.
   */
  it("lines the resting deck up with where the flight put it", () => {
    // The flight carries the hero as card 0 and the trailers behind it. The
    // resting deck does not draw the hero at all — by then it is a real HoloCard
    // the stand owns — so the resting deck's first card must land exactly where
    // the flight's *second* card did.
    for (let i = 0; i < STAND_DECK_MAX; i++) {
      expect(restingDeckOffset(i, 280)).toEqual(standDeckOffset(i + 1, 280));
    }
  });

  it("never draws the resting deck on the hero's own mark", () => {
    // If it did, a card back would be sitting exactly behind the real card,
    // showing as a hairline of wrong art around its edge.
    expect(restingDeckOffset(0, 280).x).toBeGreaterThan(0);
  });
});

describe("canFly", () => {
  const from = { w: 187, cards: [{ cx: 160, cy: 420, w: 187, rotate: 0 }] };

  it("agrees to fly when both ends have been measured", () => {
    expect(canFly(from, SLOT)).toBe(true);
  });

  // jsdom measures everything as zero, a skipped ceremony hands over nothing, and
  // reduced motion never renders a card to measure. All three mean "the stand
  // mounts the way it always did".
  it("refuses when there is nothing to fly from", () => {
    expect(canFly(null, SLOT)).toBe(false);
    expect(canFly(undefined, SLOT)).toBe(false);
    expect(canFly({ w: 0, cards: [] }, SLOT)).toBe(false);
    expect(canFly({ ...from, w: 0 }, SLOT)).toBe(false);
  });

  it("refuses when there is nothing to fly to", () => {
    expect(canFly(from, null)).toBe(false);
    expect(canFly(from, { ...SLOT, width: 0 })).toBe(false);
  });
});
