// How the shared pack graphic divides its fixed canvas.
//
// The canvas is exactly 1080x1350 and the root clips, so this is a budget rather
// than a preference: content that does not fit is not scrolled or scaled, it is
// silently cut off — and flex shrinking mangles the card rows on the way there.
//
// The version this replaces sized the roster row for the three-card case and then
// added a secret slot 34% wider underneath it, which overflowed by roughly 170px
// on exactly the packs worth sharing. It also assumed a single secret, so a pack
// that dealt two or three lost the extras from the image.

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
 * The gap to its caption, a name of two lines (the graphic clamps it there), the
 * 4px above the rarity label and the label itself, which is set at line-height 1.
 * Roster: 12 + 2 x 28 x 1.05 + 4 + 17 = 91.8. Secret: 12 + 2 x 34 x 1.05 + 4 + 20
 * = 107.4. Budgeted for two lines so a name that wraps is not what pushes the
 * footer off the bottom. Exported so the test reads the same numbers.
 */
export const ROSTER_CAPTION = 92;
export const SECRET_CAPTION = 108;
/** The "One More Card" line above the secret, plus its gap. */
const SECRET_HEADING = 50;

/**
 * The title block at the top and the collection footer at the bottom.
 *
 * The footer is the 22px of padding, the 2px rule and the 44px counter, which is
 * set at line-height 1: left to inherit 1.5 it was 66px tall and the budget was
 * short of it.
 */
const HEADER = 94;
export const FOOTER = 68;

/** How much wider the secret is than a roster card. It is the point of the image. */
const SECRET_SCALE = 1.34;

export type SharePackLayout = { roster: number; secret: number };

/**
 * The card widths that fill the canvas without overflowing it.
 *
 * Solved rather than chosen. A pack is dealt three cards from one pool, so it can
 * hold none, one, two or all three secrets, and the secrets sit in a row of their
 * own under the roster. With both rows there are two card rows to fit into one
 * height, so the roster row has to give up the room the secrets take — which is
 * why this cannot be a constant, and why a pack with secrets and one without do
 * not share a number.
 *
 * Takes counts rather than a flag because a row of two or three secrets is
 * narrower than a lone one, and a pack that is all secrets has no roster row to
 * pay for at all.
 */
export function sharePackLayout(rosterCount: number, secretCount: number): SharePackLayout {
  // Three across, minus the page padding and the two gutters between them.
  const widest = Math.floor((SHARE_W - PAD * 2 - GAP * 2) / 3);
  const hasRoster = rosterCount > 0 || secretCount === 0;
  const hasSecrets = secretCount > 0;
  // header and footer, plus a section for each row of cards that is present.
  const sections = 2 + (hasRoster ? 1 : 0) + (hasSecrets ? 1 : 0);
  const spare = SHARE_H - PAD * 2 - HEADER - FOOTER - GAP * (sections - 1);

  if (!hasSecrets) {
    const fits = Math.floor((spare - ROSTER_CAPTION) / CARD_RATIO);
    return { roster: Math.min(widest, fits), secret: 0 };
  }

  // The widest a secret can be with the whole row of them across the page.
  const rowCap = Math.floor((SHARE_W - PAD * 2 - GAP * (secretCount - 1)) / secretCount);

  if (!hasRoster) {
    // The secrets are the whole pack: no roster row, so nothing to be bigger than.
    const fits = Math.floor((spare - SECRET_HEADING - SECRET_CAPTION) / CARD_RATIO);
    return { roster: 0, secret: Math.min(rowCap, Math.floor(widest * SECRET_SCALE), fits) };
  }

  // spare = (r*RATIO + rosterCaption) + (secretHeading + r*SCALE*RATIO + secretCaption)
  const fixed = ROSTER_CAPTION + SECRET_HEADING + SECRET_CAPTION;
  const perWidth = CARD_RATIO * (1 + SECRET_SCALE);
  const fits = Math.floor((spare - fixed) / perWidth);
  const roster = Math.min(widest, fits);
  return { roster, secret: Math.min(rowCap, Math.floor(roster * SECRET_SCALE)) };
}
