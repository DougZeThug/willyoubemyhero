// The share graphic's height budget.
//
// The canvas is fixed and its root clips, so overflow is not a layout wobble —
// it is a shared image with the collection counter cut off the bottom, on
// exactly the packs somebody wanted to show off.
import { describe, expect, it } from "vitest";
import { sharePackHeight, sharePackLayout, SHARE_H, SHARE_W } from "./share-pack-layout";

describe("sharePackLayout", () => {
  it("fits the canvas for a plain three-card pack", () => {
    const layout = sharePackLayout(false);
    expect(sharePackHeight(layout, false)).toBeLessThanOrEqual(SHARE_H);
  });

  /**
   * The case that was broken. Two card rows have to share one height, so the
   * roster row must give up the room the secret takes — the old code sized the
   * roster as though it were alone and then added a secret 34% wider underneath.
   */
  it("fits the canvas for a pack with a secret in it", () => {
    const layout = sharePackLayout(true);
    expect(sharePackHeight(layout, true)).toBeLessThanOrEqual(SHARE_H);
  });

  it("gives the roster row less room when a secret has to share the page", () => {
    expect(sharePackLayout(true).roster).toBeLessThan(sharePackLayout(false).roster);
  });

  it("keeps the secret the biggest card in the image", () => {
    const layout = sharePackLayout(true);
    expect(layout.secret).toBeGreaterThan(layout.roster);
  });

  it("never lets three roster cards overflow the canvas sideways", () => {
    for (const hasSecret of [false, true]) {
      const { roster } = sharePackLayout(hasSecret);
      // Three cards plus two gutters plus the page padding.
      expect(roster * 3 + 28 * 2 + 64 * 2).toBeLessThanOrEqual(SHARE_W);
    }
  });

  it("keeps the secret inside the canvas sideways too", () => {
    expect(sharePackLayout(true).secret + 64 * 2).toBeLessThanOrEqual(SHARE_W);
  });

  it("does not shrink the cards to nothing", () => {
    // A guard on the arithmetic rather than on taste: a negative or tiny width
    // would mean the budget had been overspent somewhere above.
    expect(sharePackLayout(true).roster).toBeGreaterThan(150);
    expect(sharePackLayout(false).roster).toBeGreaterThan(150);
  });
});
