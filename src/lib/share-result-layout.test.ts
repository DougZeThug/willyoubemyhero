// The result card's height budget.
//
// The canvas is fixed and its root clips, so overflow is not a layout wobble: it
// is a shared image with the splits, then the footer, cut off the bottom on
// exactly the long courses it was built for.
import { describe, expect, it } from "vitest";
import {
  FOOTER_H,
  GRID_GAP,
  HEADER_H,
  HERO_H,
  MIN_ROW_H,
  PENALTY_H,
  RESULT_GAP,
  RESULT_H,
  RESULT_PAD,
  ROW_H,
  SPLITS_LABEL_H,
  TIME_H,
  shareResultLayout,
} from "./share-result-layout";

const COUNTS = Array.from({ length: 19 }, (_, n) => n);

/** Where the last pixel of content lands, adding the card's blocks up the way it stacks them. */
function contentBottom(n: number, hasPenalty: boolean) {
  const layout = shareResultLayout(n, hasPenalty);
  const cells = layout.shown + (layout.hidden > 0 ? 1 : 0);
  const rows = Math.ceil(cells / layout.cols);
  const grid = rows * layout.rowH + GRID_GAP * Math.max(0, rows - 1);
  const splits = n > 0 ? RESULT_GAP + SPLITS_LABEL_H + grid : 0;
  return (
    RESULT_PAD +
    HEADER_H +
    RESULT_GAP +
    HERO_H +
    RESULT_GAP +
    TIME_H +
    (hasPenalty ? PENALTY_H : 0) +
    splits +
    RESULT_GAP +
    FOOTER_H
  );
}

describe("shareResultLayout", () => {
  it.each([false, true])("keeps the footer on the canvas for 0 to 18 splits (penalty: %s)", (p) => {
    for (const n of COUNTS) {
      expect(contentBottom(n, p), `n=${n}`).toBeLessThanOrEqual(RESULT_H - RESULT_PAD);
    }
  });

  it.each([false, true])(
    "draws all thirteen splits of a thirteen-station course (penalty: %s)",
    (p) => {
      const layout = shareResultLayout(13, p);
      expect(layout.shown).toBe(13);
      expect(layout.hidden).toBe(0);
      expect(layout.rowH).toBeGreaterThanOrEqual(MIN_ROW_H);
    },
  );

  it("keeps a short course in two full-size columns", () => {
    const layout = shareResultLayout(4, false);
    expect(layout).toMatchObject({ cols: 2, rowH: ROW_H, shown: 4, hidden: 0 });
  });

  it("goes to three columns, never taller than a full row, once two cannot fit", () => {
    const layout = shareResultLayout(9, false);
    expect(layout.cols).toBe(3);
    expect(layout.rowH).toBeLessThanOrEqual(ROW_H);
  });

  it("accounts for every split: shown plus hidden is the whole course", () => {
    for (const p of [false, true]) {
      for (const n of COUNTS) {
        const { shown, hidden } = shareResultLayout(n, p);
        expect(shown + hidden, `n=${n}`).toBe(n);
      }
    }
  });

  it("owns up to what it leaves off, and never squeezes rows below the minimum", () => {
    for (const p of [false, true]) {
      for (const n of COUNTS) {
        const layout = shareResultLayout(n, p);
        if (layout.hidden > 0) expect(layout.cols).toBe(3);
        if (n > 0) expect(layout.rowH, `n=${n}`).toBeGreaterThanOrEqual(MIN_ROW_H);
      }
    }
  });

  it("gives a penalty its room, leaving less for the grid", () => {
    expect(shareResultLayout(18, true).hidden).toBeGreaterThanOrEqual(
      shareResultLayout(18, false).hidden,
    );
  });

  it("copes with nothing at all", () => {
    expect(shareResultLayout(0, false)).toMatchObject({ shown: 0, hidden: 0 });
  });
});
