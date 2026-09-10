// Control edges, measured off the rendered pixels.
//
// The companion to button-glow.spec.ts and the same argument: a class-name
// assertion proves the markup and nothing about which rule paints. Here that gap
// is the whole finding. Before the token split every edge in this app composited
// to 1.25:1 against the ground (§23 F3), and two of the edges that were raised —
// .neon-btn-quiet's and .tier-chip's — are written in CSS rather than in a
// className, so nothing in src/**/*.test.tsx can see them at all.
//
// The readback is a screenshot, not getComputedStyle. Chromium hands `oklch()`
// straight back unresolved — the trap e2e/feedback.spec.ts:22-34 already carries
// a hand-rolled parser for — and a translucent border only becomes a number once
// something composites it over what is behind it. A pixel already has.
//
// The acceptance criterion is docs/ux-audit-mobile.md:960.
import { expect, test } from "./fixtures";
import { tearPack } from "./fixtures";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { contrast, relativeLuminance, srgb8ToLinear, type LinearRgb } from "../src/lib/color";

/** WCAG 1.4.11, the boundary of a control against what is next to it. */
const FLOOR = 3;

type Grid = { width: number; height: number; px: number[] };

/**
 * A rectangle of the page, as pixels.
 *
 * Playwright hands back a PNG Buffer, and decoding one in Node would need a
 * dependency this repo will not add. So the image goes back into the page and
 * the browser — which already has a PNG decoder — reads it into a canvas. A
 * data: URL does not taint the canvas, so getImageData still works.
 *
 * `scale: "css"` matters: this runs on the desktop project at dsf 1, where one
 * image pixel is one device pixel and a 1px border lands on exactly one row.
 */
async function readback(page: Page, clip: { x: number; y: number; width: number; height: number }) {
  const png = await page.screenshot({ clip, scale: "css" });
  return page.evaluate<Grid, string>(
    async (dataUrl) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return { width: canvas.width, height: canvas.height, px: Array.from(data) };
    },
    `data:image/png;base64,${png.toString("base64")}`,
  );
}

const pixelAt = (g: Grid, x: number, y: number): LinearRgb => {
  const i = (y * g.width + x) * 4;
  return srgb8ToLinear(g.px[i], g.px[i + 1], g.px[i + 2]);
};

function rowColour(g: Grid, y: number): LinearRgb {
  let r = 0;
  let gr = 0;
  let b = 0;
  for (let x = 0; x < g.width; x++) {
    const p = pixelAt(g, x, y);
    r += p[0];
    gr += p[1];
    b += p[2];
  }
  return [r / g.width, gr / g.width, b / g.width];
}

/**
 * The contrast between a control's top edge and its own fill.
 *
 * The brightest row in the strip is the border and the deepest row is the fill
 * behind it. Brightest-row is robust to a border that straddles two rows at a
 * fractional offset, and it can only ever *understate* the edge — so a pass here
 * is a true pass. The fill is the lighter of the border's two neighbours on
 * every control in this app, which makes it the harder of the two comparisons.
 */
async function topEdgeContrast(page: Page, target: Locator): Promise<number> {
  // A clip is in page coordinates but has to intersect the viewport, so a
  // control below the fold has to be brought into it before it can be measured.
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("no box; is the control visible?");
  const g = await readback(page, {
    x: Math.round(box.x + box.width / 2) - 8,
    y: Math.round(box.y) - 2,
    width: 16,
    height: 8,
  });

  let edge = 0;
  let best = -1;
  for (let y = 0; y < g.height; y++) {
    const lum = relativeLuminance(rowColour(g, y));
    if (lum > best) {
      best = lum;
      edge = y;
    }
  }
  return contrast(rowColour(g, edge), rowColour(g, g.height - 1));
}

/**
 * The contrast of text against the background *directly behind it*.
 *
 * Column by column, because this button is transparent over the pack screen's
 * radial ground and the rarity wash `RevealAmbience` lays over it. Taking the
 * brightest and darkest pixel of the whole box would pair a glyph with a patch
 * of backdrop from somewhere else entirely, and on a gradient that overstates
 * the ratio — the failure mode where a sub-3:1 regression still passes.
 *
 * So: the glyph is the brightest pixel in the text band of one column, and its
 * background is the padding above and below it in that same column, a dozen
 * pixels away, where the wash has not meaningfully moved. Columns with no glyph
 * in them read as no delta and are skipped. The answer is the best-covered
 * column, since partial anti-aliased coverage only ever reads dimmer than the
 * colour actually being drawn.
 */
function glyphContrast(g: Grid): number {
  const bandTop = Math.round(g.height * 0.3);
  const bandBottom = Math.round(g.height * 0.7);
  // Two rows at each end: padding on a min-h-11 button with a 12px label.
  const padRows = [0, 1, g.height - 2, g.height - 1];

  let best = 0;
  let columnsWithGlyph = 0;
  for (let x = 0; x < g.width; x++) {
    const bg = padRows
      .map((y) => pixelAt(g, x, y))
      .reduce<LinearRgb>(
        (acc, p) => [acc[0] + p[0] / 4, acc[1] + p[1] / 4, acc[2] + p[2] / 4],
        [0, 0, 0],
      );

    let glyph = bg;
    for (let y = bandTop; y <= bandBottom; y++) {
      const p = pixelAt(g, x, y);
      if (relativeLuminance(p) > relativeLuminance(glyph)) glyph = p;
    }

    // A column of bare background reads as no delta. The threshold is well
    // under the ~3:1 being measured and well over the wash's drift across the
    // dozen pixels between the padding and the text.
    if (relativeLuminance(glyph) - relativeLuminance(bg) < 0.005) continue;
    columnsWithGlyph += 1;
    best = Math.max(best, contrast(glyph, bg));
  }

  // Measuring nothing must fail loudly rather than report a number.
  if (columnsWithGlyph < 5) {
    throw new Error(`found ${columnsWithGlyph} glyph columns; the label was not rendered here`);
  }
  return best;
}

/**
 * Read at dsf 1, on the desktop project only.
 *
 * The phone project is the iPhone 13 preset at device-scale factor 3, where a
 * 1px CSS border is resampled into its neighbours and reads dimmer than it is —
 * by more than a 3:1 measurement can spare. The edge itself is device
 * independent, so nothing is lost by measuring it where it is exact.
 *
 * A helper rather than a beforeEach: Playwright wants the first argument
 * destructured and there is no fixture to name here.
 */
function desktopOnly(testInfo: TestInfo) {
  test.skip(
    testInfo.project.name !== "desktop",
    "Measured at device-scale factor 1, where one image pixel is one device pixel.",
  );
}

test.describe("control edges clear 3:1", () => {
  test("on a selectable tile and on a shadcn input", async ({ page }, testInfo) => {
    desktopOnly(testInfo);
    // /claim is the ideal sample and needs no stub of its own: getClaimRoster is
    // already in DEFAULT_RESPONSES with four unclaimed players. One page load
    // covers both halves of the change — a hand-swept className and a token the
    // primitives inherit without being edited.
    await page.goto("/claim");

    const tile = page.getByRole("button", { name: /Alice Ace/ });
    await expect(tile).toBeVisible();
    const tileEdge = await topEdgeContrast(page, tile);
    expect(
      tileEdge,
      `the unselected roster tile reads ${tileEdge.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(FLOOR);

    // Proves --input, which is what carries ui/input.tsx, textarea, select,
    // toggle, input-otp and the outline button without a line changing in any
    // of them.
    const field = page.locator("#member-code");
    await expect(field).toBeVisible();
    const fieldEdge = await topEdgeContrast(page, field);
    expect(
      fieldEdge,
      `the member-code field reads ${fieldEdge.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(FLOOR);
  });

  test("on a tier chip, whose border is written in CSS rather than a class", async ({
    page,
  }, testInfo) => {
    desktopOnly(testInfo);
    await page.goto("/players/ep-alice");

    // Not .is-active: that branch paints the tier colour and was never the
    // finding. Not :disabled either — 1.4.11 exempts an inactive component, and
    // the chips carry disabled:opacity-50, which halves the edge to about 1.6.
    // The resting, pressable chip is the one that was 1.25:1.
    const chip = page.locator("button.tier-chip:not(.is-active):not(:disabled)").first();
    await expect(chip).toBeVisible();
    const edge = await topEdgeContrast(page, chip);
    expect(edge, `the resting tier chip reads ${edge.toFixed(2)}:1`).toBeGreaterThanOrEqual(FLOOR);
  });

  test('the disabled "Reveal all" is still readable', async ({ page }, testInfo) => {
    desktopOnly(testInfo);
    // §23 F4. Disabled it was 1.40:1 — text-muted-foreground/70 multiplied by
    // disabled:opacity-30 — and this is not a rare state: it covers the whole
    // auto-reveal run, which is exactly when someone is looking at the screen.
    await page.goto("/players/pack");
    await tearPack(page);

    const revealAll = page.getByRole("button", { name: /reveal all/i });
    await expect(revealAll).toBeEnabled();
    await revealAll.click();
    await expect(revealAll).toBeDisabled();

    const box = await revealAll.boundingBox();
    if (!box) throw new Error("no box for Reveal all");
    const g = await readback(page, box);

    // Re-checked after the readback rather than before it: the auto-run holds
    // the button for about 2.2s, and a screenshot taken after it finished would
    // be measuring the enabled state and passing for the wrong reason.
    await expect(revealAll).toBeDisabled();

    const ratio = glyphContrast(g);
    expect(ratio, `disabled "Reveal all" reads ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      FLOOR,
    );
  });
});
