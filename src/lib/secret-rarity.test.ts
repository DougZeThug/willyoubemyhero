import { describe, expect, it } from "vitest";
import {
  SECRET_TIER_BP_TOTAL,
  SECRET_TIER_ORDER,
  SECRET_TIER_WEIGHTS_BP,
  bestSecretTier,
  secretTierCaption,
  secretTierFloorLabel,
  secretTierLevel,
  secretTierRank,
  toSecretTier,
} from "./secret-rarity";

describe("secret rarity ladder", () => {
  it("advertises rates that sum to the whole", () => {
    const total = SECRET_TIER_ORDER.reduce((n, t) => n + SECRET_TIER_WEIGHTS_BP[t], 0);
    expect(total).toBe(SECRET_TIER_BP_TOTAL);
  });

  it("ranks rarest first", () => {
    expect(secretTierRank("mythic")).toBe(0);
    expect(secretTierRank("common")).toBe(4);
    // Anything unrecognised sorts last, which is what lets bestSecretTier
    // upgrade a corrupt stored string rather than preserving it forever.
    expect(secretTierRank("__proto__")).toBe(SECRET_TIER_ORDER.length);
  });

  it("counts pips from the bottom, so five is the top of the ladder", () => {
    // The inverse of the rank, and what LevelPips draws. Five and one are read
    // off the ladder's own length rather than written out, so a sixth rung moves
    // the count instead of quietly leaving mythic at five.
    expect(secretTierLevel("mythic")).toBe(SECRET_TIER_ORDER.length);
    expect(secretTierLevel("legendary")).toBe(4);
    expect(secretTierLevel("epic")).toBe(3);
    expect(secretTierLevel("rare")).toBe(2);
    expect(secretTierLevel("common")).toBe(1);
  });

  it("lights one pip for a level it does not recognise, never zero", () => {
    // secretTierRank answers out of band for these so bestSecretTier can upgrade
    // them; taking that answer straight would draw an empty row of diamonds,
    // which reads as a card that failed to render rather than as a common.
    expect(secretTierLevel("__proto__")).toBe(1);
    expect(secretTierLevel(null)).toBe(1);
    expect(secretTierLevel(undefined)).toBe(1);
  });

  it("keeps the better copy and never downgrades", () => {
    expect(bestSecretTier("common", "epic")).toBe("epic");
    expect(bestSecretTier("mythic", "legendary")).toBe("mythic");
    expect(bestSecretTier(null, undefined)).toBe("common");
  });

  it("falls back to common for a value Postgres never constrained", () => {
    expect(toSecretTier("gold")).toBe("common");
  });

  it("prints the level with the rate that produced it", () => {
    expect(secretTierCaption("mythic")).toBe("Mythic · 0.5% pull");
    expect(secretTierCaption("rare")).toBe("Rare · 18% pull");
  });

  it("prints a floor as a promise, not as a rate", () => {
    // Deliberately NOT the caption. A milestone that guaranteed a legendary
    // would otherwise print "3.5% pull" under it — the odds of the thing that
    // did not happen.
    expect(secretTierFloorLabel("legendary")).toBe("Legendary or better");
    expect(secretTierFloorLabel("rare")).toBe("Rare or better");
  });

  it("says guaranteed at the top, where there is nothing better to promise", () => {
    expect(secretTierFloorLabel("mythic")).toBe("Mythic, guaranteed");
    // Read off the ladder rather than hardcoded, so a rung added above mythic
    // moves the word with it.
    expect(secretTierFloorLabel(SECRET_TIER_ORDER[0])).toContain("guaranteed");
  });
});
