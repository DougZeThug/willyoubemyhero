import { beforeEach, describe, expect, it } from "vitest";
import { markRevealed, readRevealedAt, shouldCelebrate } from "./reveal-seen";

const PREFIX = "wwbh:reveal-seen:";
const ALICE = "ep-alice";
const BOB = "ep-bob";
const JULY = "2026-07-28T10:00:00.000Z";
const AUGUST = "2026-08-28T10:00:00.000Z";

beforeEach(() => {
  // The whole store. There is no module cache to reset — every read goes to
  // storage, which is the point of one key per card.
  window.localStorage.clear();
});

describe("shouldCelebrate", () => {
  it("celebrates a card this device has never celebrated and knows the arrival of", () => {
    expect(shouldCelebrate(null, JULY)).toBe(true);
  });

  it("has no opinion when it knows neither the arrival nor the card", () => {
    // A collection built before this shipped, or a card pulled last month. The
    // caller keeps its per-session guard for these — null is not false.
    expect(shouldCelebrate(null, null)).toBeNull();
  });

  it("stays quiet on a card it has celebrated, even with no timestamp in hand", () => {
    // THE ROW THAT MATTERS. Tapping the card in the vault's strip marks the strip
    // seen, so on the next load that card is outside the "new since" filter and
    // its timestamp is unknown again — but the store is not. Without this the
    // chime would come back once per session for exactly the cards somebody has
    // most recently looked at, which is the §6 bug wearing a different hat.
    expect(shouldCelebrate(JULY, null)).toBe(false);
  });

  it("stays quiet on the same arrival seen twice", () => {
    expect(shouldCelebrate(JULY, JULY)).toBe(false);
  });

  it("celebrates a newer copy of a card it already holds", () => {
    // Pull an Alice in July, trade for a second in August: the second arrival is
    // its own event, and a boolean store could not have told them apart.
    expect(shouldCelebrate(JULY, AUGUST)).toBe(true);
  });

  it("does not re-celebrate an older copy arriving late", () => {
    expect(shouldCelebrate(AUGUST, JULY)).toBe(false);
  });
});

describe("the store", () => {
  it("round-trips, and a later arrival replaces an earlier one", () => {
    markRevealed(ALICE, JULY);
    expect(readRevealedAt(ALICE)).toBe(JULY);
    markRevealed(ALICE, AUGUST);
    expect(readRevealedAt(ALICE)).toBe(AUGUST);
  });

  it("keeps one card's answer out of another's", () => {
    markRevealed(ALICE, JULY);
    expect(readRevealedAt(BOB)).toBeNull();
  });

  it("cannot lose one card's entry to another tab writing a different card", () => {
    // The reason this is a key per card rather than one JSON blob. A blob has to
    // be read, merged and written back, so two tabs celebrating two different
    // cards in the same instant would have the later write drop the earlier
    // entry — replaying exactly the cue this module exists to suppress. Storage
    // written directly here is what a second tab's write looks like from inside
    // this one.
    markRevealed(ALICE, JULY);
    window.localStorage.setItem(PREFIX + BOB, AUGUST);
    markRevealed("ep-carol", AUGUST);

    expect(readRevealedAt(ALICE)).toBe(JULY);
    expect(readRevealedAt(BOB)).toBe(AUGUST);
    expect(readRevealedAt("ep-carol")).toBe(AUGUST);
  });

  it("says never-celebrated when storage refuses to answer", () => {
    // Private mode. The cue fires once more, which is the harmless direction.
    const getItem = window.localStorage.getItem;
    window.localStorage.getItem = () => {
      throw new Error("blocked");
    };
    try {
      expect(readRevealedAt(ALICE)).toBeNull();
    } finally {
      window.localStorage.getItem = getItem;
    }
  });
});
