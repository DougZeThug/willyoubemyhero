// How the shared result card divides its fixed canvas.
//
// Same situation as share-pack-layout.ts: the canvas is exactly 1080x1350 and the
// root clips, so this is a budget rather than a preference. The split grid used
// to be a fixed two-column block of 72px rows, which on a thirteen-station
// course ran to ~560px against ~320px of room and clipped the splits and then
// the footer off the image.
//
// Every height below is a style on the card, not an estimate: result-card.tsx
// sets an explicit lineHeight on each text block so "normal" (which varies by
// font and by fallback) is never what the budget depends on.

export const RESULT_W = 1080;
export const RESULT_H = 1350;

/** Card padding (each side) and the flex gap between the stacked blocks. */
export const RESULT_PAD = 72;
export const RESULT_GAP = 40;

/**
 * Header: the rank badge is 130px and taller than the title block beside it
 * (22 x 1.2 + 56 x 1 = 82.4). Budgeted for the badge, so an unranked card only
 * has spare room.
 */
export const HEADER_H = 130;
/** The photo is 220px; the name is clamped to two lines (2 x 84) beside a one-line team (32 x 1.2) and 8px gap = 214.4. */
export const HERO_H = 220;
/**
 * Time block: 40px padding and 1px border either side (82), the 22px label at
 * line-height 1.2 (26.4) and the 200px time at line-height 1 (200).
 */
export const TIME_H = 308.4;
/** The penalty line: 8px margin plus 24px at line-height 1.2. */
export const PENALTY_H = 36.8;
/** "Station Splits": 22px at line-height 1.2 plus a 16px margin. */
export const SPLITS_LABEL_H = 42.4;
/** The footer credit: 20px at line-height 1.2, kept to one line. */
export const FOOTER_H = 24;

/** The space between grid cells, both ways. */
export const GRID_GAP = 12;
/** The row height a short course keeps, and the shortest a crowded one may be squeezed to. */
export const ROW_H = 72;
export const MIN_ROW_H = 44;

export type ShareResultLayout = {
  cols: 2 | 3;
  /** Height of every cell, set explicitly on the card. */
  rowH: number;
  labelPx: number;
  timePx: number;
  /** Splits drawn as cells. */
  shown: number;
  /** Splits left off; when above 0 the last cell reads "…and N more". */
  hidden: number;
};

/** Room for the split grid itself, under the "Station Splits" label. */
export function splitGridBudget(hasPenalty: boolean): number {
  const fixed =
    RESULT_PAD * 2 +
    HEADER_H +
    HERO_H +
    (TIME_H + (hasPenalty ? PENALTY_H : 0)) +
    SPLITS_LABEL_H +
    FOOTER_H +
    RESULT_GAP * 4;
  return Math.floor(RESULT_H - fixed);
}

const gridHeight = (rows: number, rowH: number) => rows * rowH + GRID_GAP * (rows - 1);

/**
 * Cell fonts follow the row height so the text always sits inside its cell. Three
 * columns are narrower (~304px against ~462px), so their ceiling is lower too.
 */
function fonts(cols: 2 | 3, rowH: number) {
  const labelMax = cols === 2 ? 28 : 24;
  const timeMax = cols === 2 ? 32 : 28;
  return {
    labelPx: Math.min(labelMax, Math.round(rowH * 0.39)),
    timePx: Math.min(timeMax, Math.round(rowH * 0.44)),
  };
}

/**
 * How the splits sit on the card for a course with `n` of them.
 *
 * Every split is drawn at full size in two columns while that fits. Past that it
 * goes to three, shortening the rows as far as MIN_ROW_H. Only a course too long
 * even for that shows what fits plus a closing "...and N more" cell, because the
 * footer is not allowed to be what gives way.
 */
export function shareResultLayout(n: number, hasPenalty: boolean): ShareResultLayout {
  const avail = splitGridBudget(hasPenalty);
  const count = Math.max(0, Math.floor(n));

  if (gridHeight(Math.ceil(count / 2), ROW_H) <= avail || count === 0) {
    return { cols: 2, rowH: ROW_H, ...fonts(2, ROW_H), shown: count, hidden: 0 };
  }

  const rowsFit = Math.floor((avail + GRID_GAP) / (MIN_ROW_H + GRID_GAP));
  const rows = Math.min(Math.ceil(count / 3), rowsFit);
  const rowH = Math.min(ROW_H, Math.floor((avail - GRID_GAP * (rows - 1)) / rows));
  const slots = rows * 3;
  // The closing cell takes a slot of its own, so one more split than it holds is
  // left off with it.
  const shown = count <= slots ? count : slots - 1;
  return { cols: 3, rowH, ...fonts(3, rowH), shown, hidden: count - shown };
}
