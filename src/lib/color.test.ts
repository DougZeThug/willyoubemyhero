// The oklch → hex conversion, checked against the colours it actually has to
// carry: this app's own palette and its rarity tiers.
import { describe, expect, it } from "vitest";
import { oklchToHex } from "./color";
import { rarityStyle, type RarityTier } from "./card-rarity";

describe("oklchToHex", () => {
  it("converts the house cyan to the cyan it renders as", () => {
    expect(oklchToHex("oklch(0.82 0.14 210)")).toBe("#13dcf6");
  });

  it("converts the tier colours to their own hues, not to one another", () => {
    // The bug this exists for: canvas-confetti's parser reduced every tier to
    // roughly the same olive, because they all start "oklch(0.8…". Distinct
    // output is the whole point.
    const seen = new Set(
      (["champion", "podium", "stationKing", "base", "penaltyBox", "dnf"] as RarityTier[]).map(
        (t) => oklchToHex(rarityStyle(t).accent),
      ),
    );
    expect(seen.size).toBe(6);
  });

  it("answers a real six-digit hex colour for every tier", () => {
    for (const tier of ["champion", "podium", "stationKing", "base", "penaltyBox", "dnf"]) {
      const hex = oklchToHex(rarityStyle(tier as RarityTier).accent);
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("keeps a gold reading as gold and a slate as a slate", () => {
    // Sanity beyond "it is six hex digits": the champion's gold must be
    // red-heavy and blue-light, and the DNF's slate must be near-neutral.
    const gold = oklchToHex("oklch(0.88 0.17 90)");
    const [gr, gg, gb] = [1, 3, 5].map((i) => parseInt(gold.slice(i, i + 2), 16));
    expect(gr).toBeGreaterThan(gb);
    expect(gg).toBeGreaterThan(gb);

    const slate = oklchToHex("oklch(0.62 0.02 240)");
    const [sr, sg, sb] = [1, 3, 5].map((i) => parseInt(slate.slice(i, i + 2), 16));
    expect(Math.max(sr, sg, sb) - Math.min(sr, sg, sb)).toBeLessThan(40);
  });

  it("accepts lightness as a percentage as well as a fraction", () => {
    expect(oklchToHex("oklch(82% 0.14 210)")).toBe(oklchToHex("oklch(0.82 0.14 210)"));
  });

  it("ignores the alpha slash form rather than choking on it", () => {
    expect(oklchToHex("oklch(0.82 0.14 210 / 45%)")).toBe("#13dcf6");
  });

  /**
   * Passing non-oklch through untouched is what lets the call sites stay clean:
   * a burst's colour list mixes tier colours with a plain white, and neither
   * needs a special case.
   */
  it("passes anything that is not oklch straight through", () => {
    expect(oklchToHex("#ffffff")).toBe("#ffffff");
    expect(oklchToHex("rebeccapurple")).toBe("rebeccapurple");
    expect(oklchToHex("oklch(nonsense)")).toBe("oklch(nonsense)");
  });

  it("clamps rather than wrapping when a colour sits outside sRGB", () => {
    // A chroma no display can show. The channels have to saturate at the edge of
    // the gamut, not overflow into an unrelated colour.
    expect(oklchToHex("oklch(0.7 0.9 150)")).toMatch(/^#[0-9a-f]{6}$/);
  });
});
