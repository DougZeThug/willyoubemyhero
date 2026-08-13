// How loud each tier makes the room.
//
// A taste scale, but not an arbitrary one: the order it puts the tiers in is a
// deliberate disagreement with `rank`, and that disagreement is the thing worth
// writing down.
import { describe, expect, it } from "vitest";
import { ambienceStrength, SECRET_GLOW } from "./reveal-ambience";
import { rarityStyle, type RarityTier } from "./card-rarity";

const TIERS: RarityTier[] = ["champion", "podium", "stationKing", "base", "penaltyBox", "dnf"];

describe("ambienceStrength", () => {
  it("answers for every tier, on one scale", () => {
    for (const tier of TIERS) {
      const glow = ambienceStrength(tier);
      expect(glow).toBeGreaterThan(0);
      expect(glow).toBeLessThanOrEqual(1);
    }
  });

  it("puts the champion at the top and the DNF at the bottom", () => {
    expect(ambienceStrength("champion")).toBe(1);
    for (const tier of TIERS.filter((t) => t !== "champion")) {
      expect(ambienceStrength(tier)).toBeLessThan(ambienceStrength("champion"));
      expect(ambienceStrength("dnf")).toBeLessThanOrEqual(ambienceStrength(tier));
    }
  });

  /**
   * The deliberate disagreement with `rank`.
   *
   * Rank sorts the vault best-to-worst, which puts `base` above `penaltyBox`. On
   * screen that is the wrong way round: taking the most penalty time in the
   * league is a story, and being an unremarkable finisher is not. The scale is
   * about how interesting a card is to pull, not how well somebody did.
   */
  it("is louder for a penalty box than for a base card, unlike rank", () => {
    expect(rarityStyle("penaltyBox").rank).toBeGreaterThan(rarityStyle("base").rank);
    expect(ambienceStrength("penaltyBox")).toBeGreaterThan(ambienceStrength("base"));
  });

  it("leaves a DNF looking like the lights went out", () => {
    // Distinctly below everything else rather than a notch under it — the tier is
    // supposed to be the one card that does not light up.
    expect(ambienceStrength("dnf")).toBeLessThan(ambienceStrength("base") / 1.5);
  });

  it("gives the secret the top of the scale, without making it a tier", () => {
    // SECRET_RARITY carries tier "base" so it satisfies the type, and nothing may
    // branch on that — so the secret's level is named separately rather than
    // looked up.
    expect(SECRET_GLOW).toBe(ambienceStrength("champion"));
  });
});

describe("what a finish adds to the room", () => {
  const TIERS = ["champion", "podium", "stationKing", "penaltyBox", "base", "dnf"] as const;

  it("changes nothing for a standard finish, or for a caller that names none", () => {
    // The default parameter is what keeps every pre-edition call site honest.
    for (const tier of TIERS) {
      expect(ambienceStrength(tier, "standard")).toBe(ambienceStrength(tier));
    }
  });

  it("lifts a quiet tier by the same amount as a loud one", () => {
    // Added, not scaled: the two axes are independent, so a rare finish is worth
    // the same on a DNF as on a champion.
    const onDnf = ambienceStrength("dnf", "gold") - ambienceStrength("dnf");
    const onStationKing = ambienceStrength("stationKing", "gold") - ambienceStrength("stationKing");
    expect(onDnf).toBeCloseTo(onStationKing, 10);
  });

  it("puts a platinum base card into the room whatever the tier did", () => {
    // The payoff of the whole ladder, and the number platinum's lift is set to
    // clear: 0.6 is where the wash grows its second core.
    expect(ambienceStrength("base", "platinum")).toBeGreaterThan(0.6);
    expect(ambienceStrength("dnf", "platinum")).toBeGreaterThan(ambienceStrength("base"));
  });

  it("never goes past the top of the scale", () => {
    for (const tier of TIERS) {
      expect(ambienceStrength(tier, "platinum")).toBeLessThanOrEqual(1);
    }
    expect(ambienceStrength("champion", "platinum")).toBe(1);
  });

  it("orders the finishes the way the ladder does", () => {
    const lifts = (["standard", "bronze", "silver", "gold", "platinum"] as const).map((e) =>
      ambienceStrength("base", e),
    );
    expect(lifts).toEqual([...lifts].sort((a, b) => a - b));
  });
});
