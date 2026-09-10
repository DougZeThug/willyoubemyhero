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

    // Text, not an edge: the brightest pixel is a glyph's core and the darkest
    // is the ground showing through the padding. Anti-aliasing can only pull the
    // two together, so this understates the real ratio.
    let glyph: LinearRgb = [0, 0, 0];
    let ground: LinearRgb = [1, 1, 1];
    for (let y = 0; y < g.height; y++) {
      for (let x = 0; x < g.width; x++) {
        const p = pixelAt(g, x, y);
        if (relativeLuminance(p) > relativeLuminance(glyph)) glyph = p;
        if (relativeLuminance(p) < relativeLuminance(ground)) ground = p;
      }
    }

    // Re-checked after the readback rather than before it: the auto-run holds
    // the button for about 2.2s, and a screenshot taken after it finished would
    // be measuring the enabled state and passing for the wrong reason.
    await expect(revealAll).toBeDisabled();

    const ratio = contrast(glyph, ground);
    expect(ratio, `disabled "Reveal all" reads ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      FLOOR,
    );
  });
});
