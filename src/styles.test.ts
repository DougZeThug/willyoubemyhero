import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// cwd rather than import.meta.url: this file runs in the jsdom project, where
// import.meta.url is not a file: URL and node:fs refuses it. Same note as
// src/lib/color.test.ts, which reads the same sheet for the same reason.
const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

/**
 * Walks the sheet once, tracking which blocks are open at every character, and
 * reports every `:hover` that is not inside a query gating on a pointer that can
 * hover.
 *
 * A regex cannot answer this — the guard and the rule it protects are separated
 * by a brace, and the two live hundreds of lines apart in `.neon-btn`'s case.
 * What the e2e suite proves in a browser, this proves about the source, in a
 * second, for every rule at once rather than the handful a spec can click.
 */
function ungatedHovers(sheet: string): string[] {
  const found: string[] = [];
  // Preludes of the blocks currently open, outermost first.
  const open: string[] = [];
  let prelude = "";

  // Comments first, or the prose explaining the guard trips the check the guard
  // exists to satisfy. CSS has no other comment form and nothing in this sheet
  // carries `/*` inside a url() or a string, so a replace is enough.
  const code = sheet.replace(/\/\*[\s\S]*?\*\//g, " ");

  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === "{") {
      open.push(prelude);
      prelude = "";
      continue;
    }
    if (ch === "}") {
      open.pop();
      prelude = "";
      continue;
    }
    if (ch === ";") {
      prelude = "";
      continue;
    }
    prelude += ch;

    // `:hover` can appear in the prelude being built (`.x:hover {`) or in one
    // already opened, so test the tail rather than waiting for the brace.
    if (!prelude.endsWith(":hover")) continue;
    const context = [...open, prelude];
    if (context.some((p) => /@media[^{]*\(\s*hover\s*:\s*hover\s*\)/.test(p))) continue;
    found.push(prelude.trim().split("\n").pop()!.trim());
  }
  return found;
}

describe("press feedback on a coarse pointer", () => {
  it("promotes every hover: utility to the press where there is no hover", () => {
    // One declaration standing in for ~160 hand-edits. Both branches have to be
    // here: the first is the behaviour Tailwind ships and this must not lose,
    // the second is the whole point of the change.
    const variant = /@custom-variant hover \{([\s\S]*?)\n\}/.exec(css)?.[1];
    expect(variant).toBeDefined();
    expect(variant).toMatch(/@media \(hover: hover\)\s*\{\s*&:hover\s*\{\s*@slot;/);
    expect(variant).toMatch(/@media \(hover: none\)\s*\{\s*&:active\s*\{\s*@slot;/);
  });

  it("leaves no hand-written :hover able to latch on a touch screen", () => {
    // The failure this catches is not a missing effect, it is a stuck one: an
    // ungated :hover stays on whatever was tapped last, and .tier-chip's stuck
    // state was within a hair of the class that means "selected".
    expect(
      ungatedHovers(css),
      "These :hover rules are not inside an @media (hover: hover) query, so on a " +
        "phone they stick to the last control tapped. Gate them the way " +
        ".neon-btn and .tier-chip are, and give the press its own :active rule.",
    ).toEqual([]);
  });

  it("gives the tier chip a press state of its own, ungated", () => {
    // Gating the hover without adding this would have left the chip with no
    // touch feedback at all — a fix that reads as a regression on the screen it
    // was made for.
    expect(css).toMatch(/&:active:not\(:disabled\) \{[^}]*transform: translateY\(1px\);/);
  });

  it("takes iOS's own tap flash off the elements that own a press", () => {
    // The press treatments above are drawn UNDER Safari's grey highlight, which
    // is the wrong shape, the wrong colour and on its own schedule. A browser
    // cannot see this: Chromium under touch emulation never paints the iOS
    // flash, so the only place it can be checked is the sheet.
    const rule = /-webkit-tap-highlight-color:\s*transparent/.exec(css);
    expect(
      rule,
      "Nothing sets -webkit-tap-highlight-color, so iOS paints its default flash " +
        "over every press state this sheet defines.",
    ).not.toBeNull();

    // On the elements that own a press, not on `*`: it is a WebKit-only
    // property and a universal selector would be reaching further than the
    // finding does.
    for (const sel of ["button", '[role="button"]', "input", "select", "textarea"]) {
      expect(
        css.includes(sel) && new RegExp(`${sel.replace(/[[\]"]/g, "\\$&")}[^{]*\\{`).test(css),
        `${sel} should be covered by the tap-highlight rule`,
      ).toBe(true);
    }
  });
});

describe("scroll containment", () => {
  it("keeps a pull-to-refresh from throwing away a half-torn pack", () => {
    // Every screen is live over realtime and none has a refresh affordance, so
    // a downward drag at the top of the page can only lose work.
    expect(
      /overscroll-behavior-y:\s*contain/.test(css),
      "body has no overscroll-behavior-y, so a drag at the top of any screen is " +
        "a page reload the app has nowhere to put.",
    ).toBe(true);
  });

  it("stops a drawer and a modal handing their scroll to the page", () => {
    // A bottom sheet dragged past its end drags the vault. These two are whole
    // surfaces, so they take both axes.
    expect(
      /\[data-vaul-drawer\],\s*\[role="dialog"\]\s*\{\s*overscroll-behavior:\s*contain/.test(css),
      "Drawers and dialogs need overscroll-behavior: contain, or a sheet dragged " +
        "past its end drags the page behind it.",
    ).toBe(true);
  });

  it("contains each scroller on the axis it actually scrolls, and no other", () => {
    // The shorthand was the first version of this and it was wrong, which is
    // the whole reason this test names the axis.
    //
    // A `.overflow-x-auto` strip is a horizontal scroller whose `y` CSS
    // computes to `auto` alongside it. Containing `y` there would swallow a
    // VERTICAL page gesture that merely started over the filmstrip — the page
    // refusing to scroll under a thumb that happened to land on a row of cards.
    // A dead zone, in exchange for nothing: that strip has no vertical scroll
    // to chain in the first place.
    expect(
      /\.overflow-x-auto\s*\{\s*overscroll-behavior-x:\s*contain/.test(css),
      "Horizontal strips need overscroll-behavior-X only.",
    ).toBe(true);
    expect(
      /\.overflow-y-auto\s*\{\s*overscroll-behavior-y:\s*contain/.test(css),
      "Vertical panes need overscroll-behavior-Y only.",
    ).toBe(true);
    // The shorthand must not come back on either of them.
    expect(
      /\.overflow-[xy]-auto\s*\{\s*overscroll-behavior:\s/.test(css),
      "A scroller is using the overscroll-behavior shorthand again. It contains " +
        "the axis that scroller does not scroll in, which is a dead zone for the " +
        "page gesture that crosses it.",
    ).toBe(false);
  });
});

/**
 * The room a short route may fill has to match the header actually standing
 * above it.
 *
 * Both halves are derived rather than restated, because a literal echoed from
 * one file into a test only proves the echo. This walks site-nav's own classes
 * for the header's height and the token for what it reserves, so changing the
 * header's padding — or the token — without the other one trips it.
 *
 * jsdom cannot stand in: it has no layout engine, so a rendered SiteNav measures
 * zero in every direction. What a browser would prove by scrolling, this proves
 * about the source.
 */
describe("the page-height token reserves the header that is really there", () => {
  const nav = readFileSync(resolve(process.cwd(), "src/components/site-nav.tsx"), "utf8");

  // Tailwind's default 0.25rem step. The sheet names spacing tokens of its own
  // (--spacing-page-x and friends) but never redefines the scale itself, and the
  // arithmetic below is wrong if it ever starts to.
  const STEP_PX = 4;
  it("still uses Tailwind's default spacing scale", () => {
    expect(/--spacing:\s/.test(css)).toBe(false);
  });

  /** The sticky header element, from its opening tag to its close. */
  const header = /<motion\.header[\s\S]*?<\/motion\.header>/.exec(nav)?.[0] ?? "";
  const headerClass = /className="(sticky top-0[^"]*)"/.exec(header)?.[1] ?? "";
  const rowClass = /className="(mx-auto flex max-w-6xl[^"]*)"/.exec(header)?.[1] ?? "";

  it("reads a header it can measure", () => {
    expect(headerClass, "site-nav's sticky header moved or was renamed").toContain("pt-safe");
    expect(rowClass, "site-nav's header row moved or was renamed").toMatch(/py-[\d.]/);
  });

  /** py-N, both sides. */
  const rowPadPx = Number(/\bpy-([\d.]+)\b/.exec(rowClass)?.[1] ?? 0) * STEP_PX * 2;
  /** The tallest floor any child of the row sets — what the row cannot shrink past. */
  const rowFloorPx =
    Math.max(0, ...[...header.matchAll(/\bmin-h-(\d+)\b/g)].map((m) => Number(m[1]))) * STEP_PX;
  const borderPx = /\bborder-b\b/.test(headerClass) ? 1 : 0;
  const headerPx = rowPadPx + rowFloorPx + borderPx;

  /**
   * What the mobile token subtracts for the header: every subtrahend that is not
   * the notch or the tab bar's clearance, which are carried as env()/var() and
   * cancel against the header's own pt-safe and main's padding.
   */
  const tokenLine = /--page-min-h:\s*calc\(100dvh([^)]*(?:\)[^)]*)*?)\);/.exec(css)?.[1] ?? "";
  const reservedPx = [...tokenLine.matchAll(/-\s*([\d.]+)(rem|px)\b/g)]
    .map(([, n, unit]) => Number(n) * (unit === "rem" ? 16 : 1))
    .reduce((a, b) => a + b, 0);

  it("reserves exactly the header's height, notch aside", () => {
    // 65px: a 44px row floor, 20px of py-2.5, and the 1px border-b under it.
    expect(headerPx).toBe(65);
    expect(
      reservedPx,
      `--page-min-h reserves ${reservedPx}px for a header that renders ${headerPx}px. ` +
        `Short routes ${reservedPx < headerPx ? "scroll" : "under-fill"} by ` +
        `${Math.abs(headerPx - reservedPx)}px because of it.`,
    ).toBe(headerPx);
  });
});

/**
 * The flip's light show is a pass, not a repaint.
 *
 * holo-card arms `.holo-turning` with a one-way latch — the class has to stay on
 * so each later turn can restart the animation rather than re-add it — so a fill
 * mode here does not expire when the flip lands. It lasts the whole mount, and
 * an animation outranks both the inline style the component writes and the
 * `.shadow-2xl` the element carries.
 *
 * jsdom has no animation engine and no cascade to ask, so the sheet is the only
 * place this is provable.
 */
describe("the flip hands the card back when it lands", () => {
  it("does not forward-fill holo-flip-light over the card's resting shadow", () => {
    const shorthand = /\.holo-turning \{\s*animation:([^;]*);/.exec(css)?.[1];
    expect(shorthand, ".holo-turning lost its animation shorthand").toBeDefined();
    expect(
      /\b(both|forwards)\b/.test(shorthand!),
      "`.holo-turning` fills holo-flip-light forward. Its 100% frame is a single " +
        "layer — the tier glow — while the resting boxShadow holo-card writes is " +
        "two, tier glow AND edition accent. Filled, the accent bloom on a lifted " +
        "hero card goes at the first turn and never comes back.",
    ).toBe(false);
  });

  it("keeps the frame it lands on equal to the tier glow it started from", () => {
    // Without a fill the last painted frame has to match what the card wears at
    // rest, or dropping the fill trades a permanent loss for a visible snap.
    const frames = /@keyframes holo-flip-light \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    const first = /0% \{\s*box-shadow:([^;]*);/.exec(frames)?.[1]?.trim();
    const last = /100% \{\s*box-shadow:([^;]*);/.exec(frames)?.[1]?.trim();
    expect(first, "holo-flip-light lost its 0% box-shadow").toBeDefined();
    expect(last).toBe(first);
  });
});
