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
