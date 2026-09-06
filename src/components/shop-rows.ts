/**
 * The shop's one list treatment, shared so the five row lists cannot drift.
 *
 * The screen used to be seven identical bordered boxes, one per section, which
 * made the box the loudest thing on it and said nothing about what was inside.
 * The rule now is that a SURFACE MEANS A LIST OF THINGS YOU CAN ACT ON: headings
 * and their prose sit on the page ground, and only the rows get a panel. The
 * market shelf is already a grid of cards and the bonus pull is a single button,
 * so neither of those is boxed at all — and that variation is what gives the page
 * a shape instead of a rhythm of seven equal beats.
 *
 * `min-h-11` on the row rather than on the button: the row is the touch target
 * when the whole line is tappable, and a 44px button inside a 36px row is a lie
 * about where the finger can land.
 */
export const ROW_LIST = "surface-panel divide-y divide-white/5 overflow-hidden rounded-xl border";

export const ROW = "flex min-h-11 items-center justify-between gap-3 px-3 py-2";
