import { beforeEach, describe, expect, it } from "vitest";
import { markRevealed, readRevealSeen, shouldCelebrate, type RevealSeen } from "./reveal-seen";

const KEY = "wwbh:reveal-seen";
const ALICE = "ep-alice";
const JULY = "2026-07-28T10:00:00.000Z";
const AUGUST = "2026-08-28T10:00:00.000Z";

beforeEach(() => {
  window.localStorage.clear();
  // The module cache too: the writes trust their own value over a re-read.
  markRevealed("__reset__", String(Math.random()));
  window.localStorage.clear();
});

describe("shouldCelebrate", () => {
  const none: RevealSeen = {};

  it("celebrates a card this device has never celebrated and knows the arrival of", () => {
    expect(shouldCelebrate(none, ALICE, JULY)).toBe(true);
  });

  it("has no opinion when it knows neither the arrival nor the card", () => {
    // A collection built before this shipped, or a card pulled last month. The
    // caller keeps its per-session guard for these — null is not false.
    expect(shouldCelebrate(none, ALICE, null)).toBeNull();
  });

  it("stays quiet on a card it has celebrated, even with no timestamp in hand", () => {
    // THE ROW THAT MATTERS. Tapping the card in the vault's strip bumps
    // wwbh:vault-last-seen, so on the next load the acquisitions window is empty
    // and the timestamp is unknown again — but the store is not. Without this the
    // chime would come back once per session for exactly the cards somebody has
    // most recently looked at, which is the §6 bug wearing a different hat.
    expect(shouldCelebrate({ [ALICE]: JULY }, ALICE, null)).toBe(false);
  });

  it("stays quiet on the same arrival seen twice", () => {
    expect(shouldCelebrate({ [ALICE]: JULY }, ALICE, JULY)).toBe(false);
  });

  it("celebrates a newer copy of a card it already holds", () => {
    // Pull an Alice in July, trade for a second in August: the second arrival is
    // its own event, and a boolean store could not have told them apart.
    expect(shouldCelebrate({ [ALICE]: JULY }, ALICE, AUGUST)).toBe(true);
  });

  it("does not re-celebrate an older copy arriving late", () => {
    expect(shouldCelebrate({ [ALICE]: AUGUST }, ALICE, JULY)).toBe(false);
  });

  it("keeps one card's answer out of another's", () => {
    expect(shouldCelebrate({ [ALICE]: JULY }, "ep-bob", null)).toBeNull();
  });
});

describe("the store", () => {
  it("round-trips, and later arrivals overwrite earlier ones", () => {
    markRevealed(ALICE, JULY);
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toMatchObject({ [ALICE]: JULY });
    markRevealed(ALICE, AUGUST);
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toMatchObject({ [ALICE]: AUGUST });
  });

  it("reads junk under its key as an empty map", () => {
    // The harmless direction to fail: the cue fires once more, rather than never.
    window.localStorage.setItem(KEY, "[]");
    expect(readRevealSeen()).toEqual({});
  });

  it("keeps what another tab wrote while this one was open", () => {
    // The write merges onto storage rather than onto the module value, so a card
    // celebrated in a second tab does not get its cue re-armed here.
    markRevealed(ALICE, JULY);
    window.localStorage.setItem(KEY, JSON.stringify({ [ALICE]: JULY, "ep-bob": AUGUST }));
    markRevealed("ep-carol", AUGUST);
    expect(readRevealSeen()).toEqual({
      [ALICE]: JULY,
      "ep-bob": AUGUST,
      "ep-carol": AUGUST,
    });
  });
});
