// How the shared pack graphic divides its fixed canvas.
//
// The canvas is exactly 1080x1350 and the root clips, so this is a budget rather
// than a preference: content that does not fit is not scrolled or scaled, it is
// silently cut off — and flex shrinking mangles the card rows on the way there.
//
// The version this replaces sized the roster row for the three-card case and then
// added a secret slot 34% wider underneath it, which overflowed by roughly 170px
// on exactly the packs worth sharing.

/** The exported image, in pixels. Instagram-portrait, as the per-card export is. */
export const SHARE_W = 1080;
export const SHARE_H = 1350;

/** Page padding, and the gap between the graphic's four stacked sections. */
const PAD = 64;
const GAP = 28;

/** Standard 2.5 x 3.5, so the export shows the proportions the app does. */
const CARD_RATIO = 1.4;

/**
 * Everything under a card that is not the card.
 *
 * The gap to its caption plus two lines of it. Measured generously — a name that
 * wraps to two lines must not be what pushes the footer off the bottom.
 */
const ROSTER_CAPTION = 63;
const SECRET_CAPTION = 72;
/** The "One More Card" line above the secret, plus its gap. */
const SECRET_HEADING = 50;

/** The title block at the top and the collection footer at the bottom. */
const HEADER = 94;
const FOOTER = 66;

/** How much wider the secret is than a roster card. It is the point of the image. */
const SECRET_SCALE = 1.34;

export type SharePackLayout = { roster: number; secret: number };

/**
 * The card widths that fill the canvas without overflowing it.
 *
 * Solved rather than chosen. With a secret there are two card rows to fit into
 * one height, so the roster row has to give up the room the secret takes — which
 * is why this cannot be a constant, and why the three-card and four-card packs
 * do not share a number.
 */
export function sharePackLayout(hasSecret: boolean): SharePackLayout {
  // Three across, minus the page padding and the two gutters between them.
  const widest = Math.floor((SHARE_W - PAD * 2 - GAP * 2) / 3);
  // header + roster + footer, or header + roster + secret + footer.
  const sections = hasSecret ? 4 : 3;
  const spare = SHARE_H - PAD * 2 - HEADER - FOOTER - GAP * (sections - 1);

  if (!hasSecret) {
    const fits = Math.floor((spare - ROSTER_CAPTION) / CARD_RATIO);
    return { roster: Math.min(widest, fits), secret: 0 };
  }

  // spare = (r*RATIO + rosterCaption) + (secretHeading + r*SCALE*RATIO + secretCaption)
  const fixed = ROSTER_CAPTION + SECRET_HEADING + SECRET_CAPTION;
  const perWidth = CARD_RATIO * (1 + SECRET_SCALE);
  const fits = Math.floor((spare - fixed) / perWidth);
  const roster = Math.min(widest, fits);
  return { roster, secret: Math.floor(roster * SECRET_SCALE) };
}

/**
 * The height the graphic actually composes to, for a given layout.
 *
 * Exists so a test can assert the thing that matters — that it fits — rather than
 * re-deriving the arithmetic above and agreeing with itself.
 */
export function sharePackHeight(layout: SharePackLayout, hasSecret: boolean): number {
  const rows =
    layout.roster * CARD_RATIO +
    ROSTER_CAPTION +
    (hasSecret ? SECRET_HEADING + layout.secret * CARD_RATIO + SECRET_CAPTION : 0);
  const sections = hasSecret ? 4 : 3;
  return PAD * 2 + HEADER + FOOTER + GAP * (sections - 1) + rows;
}
