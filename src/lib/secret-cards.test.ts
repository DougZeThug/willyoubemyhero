import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { rarityStyle, type FoilPattern, type RarityTier } from "./card-rarity";
import { SECRET_RARITY, secretFoil, secretsPulledLabel, SECRET_REASON } from "./secret-cards";

const RARITY_TIERS: RarityTier[] = [
  "champion",
  "podium",
  "stationKing",
  "penaltyBox",
  "dnf",
  "base",
];

describe("SECRET_RARITY", () => {
  it("keeps its accent opaque, like every real tier does", () => {
    // The same invariant card-rarity.test.ts pins for the six tiers: `accent`
    // paints text and glows, and a translucent white there is invisible.
    expect(SECRET_RARITY.accent).not.toMatch(/\/\s*\d+%/);
  });

  it("stays inside the 0..1 range the holo engine scales by", () => {
    expect(SECRET_RARITY.strength).toBeGreaterThan(0);
    expect(SECRET_RARITY.strength).toBeLessThanOrEqual(1);
    expect(SECRET_RARITY.sparkle).toBeGreaterThanOrEqual(0);
    expect(SECRET_RARITY.sparkle).toBeLessThanOrEqual(1);
  });

  it("uses oklch everywhere, like the rest of the palette", () => {
    for (const colour of [
      SECRET_RARITY.holoA,
      SECRET_RARITY.holoB,
      SECRET_RARITY.border,
      SECRET_RARITY.accent,
    ]) {
      expect(colour).toMatch(/^oklch\(/);
    }
  });

  it("sits outside the tier ladder so it never sorts against the roster", () => {
    const ranks = RARITY_TIERS.map((t) => rarityStyle(t).rank);
    expect(ranks).not.toContain(SECRET_RARITY.rank);
  });

  it("wears a pattern no earned tier can have", () => {
    const tierPatterns = RARITY_TIERS.map((t) => rarityStyle(t).pattern);
    expect(tierPatterns).not.toContain(SECRET_RARITY.pattern);
  });

  it("is the only thing in the app with a prism edge", () => {
    expect(SECRET_RARITY.prismEdge).toBe(true);
    for (const tier of RARITY_TIERS) {
      expect(rarityStyle(tier).prismEdge).toBeUndefined();
    }
  });

  it("does not print a tier reason on the back", () => {
    // SECRET_RARITY carries tier "base" purely to satisfy the type. A card back
    // that looked the reason up would print "Combine athlete" on a card that has
    // never been near a combine, which is why SecretBackPanel hardcodes this.
    expect(SECRET_REASON).toBe("Not on the roster");
  });
});

describe("secretFoil", () => {
  it("falls back for a value nobody has written a treatment for", () => {
    // secret_cards.foil has no CHECK behind it, so this is the same
    // unknown-string-falls-back contract rarityMap has for card_rarity.
    expect(secretFoil("nonsense")).toBe(SECRET_RARITY);
    expect(secretFoil(null)).toBe(SECRET_RARITY);
    expect(secretFoil(undefined)).toBe(SECRET_RARITY);
  });

  it("resolves the treatment the migration defaults to", () => {
    expect(secretFoil("rosette")).toBe(SECRET_RARITY);
  });
});

describe("secretsPulledLabel", () => {
  it.each([
    [1, "1 secret pulled"],
    [3, "3 secrets pulled"],
  ])("reads %i as %s", (n, expected) => {
    expect(secretsPulledLabel(n)).toBe(expected);
  });
});

describe("every foil pattern has a rule to render it", () => {
  // The class name is assembled at runtime from `rarity.pattern`, so a pattern
  // with no matching CSS rule is invisible until somebody pulls that card in a
  // garden — and a rule with no pattern is dead weight the scanner cannot see.
  // Resolved from the project root rather than import.meta.url: this file runs in
  // the jsdom project, where import.meta.url is an http URL and not a path.
  const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
  const declared = [...css.matchAll(/\.holo-pattern-([a-z-]+)\s*\{/g)].map((m) => m[1]).sort();
  const used: FoilPattern[] = ["refractor", "prismatic", "scanline", "hazard", "matte", "rosette"];

  it("declares a rule for every pattern in the union", () => {
    // `refractor` is the shared chassis in holo-foil and deliberately has no
    // override of its own — it is the geometry every other rule departs from.
    for (const pattern of used.filter((p) => p !== "refractor")) {
      expect(declared).toContain(pattern);
    }
  });

  it("declares no rule for a pattern nothing can ask for", () => {
    for (const pattern of declared) {
      expect(used).toContain(pattern as FoilPattern);
    }
  });

  it("keeps the prism edge and the dupe shimmer as plain rules", () => {
    // Both are toggled from JS, so an @utility would be dropped by the Tailwind
    // class scanner exactly the way the note above .holo-pattern-* explains.
    expect(css).toMatch(/^\.holo-prism-edge\s*\{/m);
    expect(css).toMatch(/^\.secret-dupe-shimmer::after\s*\{/m);
  });

  it("still turns the prism edge off under reduced motion", () => {
    expect(css).toMatch(/\.holo-prism-edge\.is-spinning\s*\{\s*animation:\s*none/);
  });
});
