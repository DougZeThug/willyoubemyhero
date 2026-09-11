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
});
