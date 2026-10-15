// The share graphic's height budget.
//
// The canvas is fixed and its root clips, so overflow is not a layout wobble —
// it is a shared image with the collection counter cut off the bottom, on
// exactly the packs somebody wanted to show off.
import { describe, expect, it } from "vitest";
import { sharePackLayout, SHARE_H, SHARE_W } from "./share-pack-layout";

// Every way a three-card pack can split: [roster cards, secrets].
const PACKS: [number, number][] = [
  [3, 0],
  [2, 1],
  [1, 2],
  [0, 3],
];

describe("sharePackLayout", () => {
  it("gives the roster row less room when a secret has to share the page", () => {
    expect(sharePackLayout(2, 1).roster).toBeLessThan(sharePackLayout(3, 0).roster);
  });

  it("keeps the secret the biggest card in the image", () => {
    for (const [roster, secrets] of [
      [2, 1],
      [1, 2],
    ]) {
      const layout = sharePackLayout(roster, secrets);
      expect(layout.secret).toBeGreaterThan(layout.roster);
    }
  });

  it("never lets three roster cards overflow the canvas sideways", () => {
    for (const [roster, secrets] of PACKS) {
      const { roster: width } = sharePackLayout(roster, secrets);
      // Three cards plus two gutters plus the page padding.
      expect(width * 3 + 28 * 2 + 64 * 2).toBeLessThanOrEqual(SHARE_W);
    }
  });

  it("keeps a whole row of secrets inside the canvas sideways", () => {
    for (const [roster, secrets] of PACKS.filter(([, s]) => s > 0)) {
      const { secret } = sharePackLayout(roster, secrets);
      expect(secret * secrets + 28 * (secrets - 1) + 64 * 2).toBeLessThanOrEqual(SHARE_W);
    }
  });

  it("keeps every pack shape inside the canvas vertically", () => {
    // The same budget the layout solves, spelled out so a constant changed over
    // there cannot quietly overspend it here.
    const HEADER = 94;
    const FOOTER = 66;
    for (const [rosterCount, secretCount] of PACKS) {
      const { roster, secret } = sharePackLayout(rosterCount, secretCount);
      const rows: number[] = [];
      if (rosterCount > 0) rows.push(roster * 1.4 + 63);
      if (secretCount > 0) rows.push(50 + secret * 1.4 + 72);
      const used = 64 * 2 + HEADER + FOOTER + 28 * (rows.length + 1) + rows.reduce((a, b) => a + b);
      expect(used).toBeLessThanOrEqual(SHARE_H);
    }
  });

  it("leaves the one-secret layout as it was", () => {
    expect(sharePackLayout(2, 1)).toEqual({ roster: 242, secret: 324 });
  });

  it("does not shrink the cards to nothing", () => {
    // A guard on the arithmetic rather than on taste: a negative or tiny width
    // would mean the budget had been overspent somewhere above.
    for (const [roster, secrets] of PACKS) {
      const layout = sharePackLayout(roster, secrets);
      expect(roster > 0 ? layout.roster : layout.secret).toBeGreaterThan(150);
      if (secrets > 0) expect(layout.secret).toBeGreaterThan(150);
    }
  });
});
