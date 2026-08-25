// The finish ladder, as this module renders it.
//
// The roll itself is not here and cannot be: Postgres decides a finish now
// (roll_card_edition), and tests/db/card-pulls.test.ts is where the distribution
// is pinned. What lives here is everything the client still owns — the odds table
// the card back prints, the ranking, and the styling.
import { describe, expect, it } from "vitest";
import {
  bestEdition,
  EDITION_BP_TOTAL,
  EDITION_CLASS,
  EDITION_ORDER,
  EDITION_WEIGHTS_BP,
  editionCelebrates,
  editionLabel,
  editionOddsLabel,
  editionRank,
  editionStyle,
  isEdition,
  type Edition,
} from "./card-edition";

describe("the odds table", () => {
  it("sums to exactly one", () => {
    // The one property that makes the cumulative walk in roll_card_edition total,
    // and the reason this table is the mirror the SQL ladder is pinned against.
    // In basis points it is an integer sum, so this is exact rather than epsilon.
    const sum = EDITION_ORDER.reduce((n, e) => n + EDITION_WEIGHTS_BP[e], 0);
    expect(sum).toBe(EDITION_BP_TOTAL);
  });

  it("advertises the rates the card backs promise", () => {
    // Pinned as percentages because that is the form a player reads them in, on
    // the back of the card, via editionOddsLabel.
    expect(EDITION_ORDER.map((e) => EDITION_WEIGHTS_BP[e] / 100)).toEqual([0.5, 3.5, 8, 18, 70]);
  });

  it("orders rarest first, matching the array inside card_edition_rank()", () => {
    // The only cross-check on the SQL, which applies the identical best-wins rule
    // on conflict in another language where the compiler cannot help. If this
    // literal changes, 20260813120000_card_pull_editions.sql changes with it.
    expect(EDITION_ORDER).toEqual(["platinum", "gold", "silver", "bronze", "standard"]);
  });
});

describe("editionStyle", () => {
  it("returns a style for every edition, with the edition echoed back", () => {
    for (const edition of EDITION_ORDER) {
      const style = editionStyle(edition);
      expect(style.edition).toBe(edition);
      expect(style.label).toBeTruthy();
      expect(style.lift).toBeGreaterThanOrEqual(0);
      expect(style.lift).toBeLessThanOrEqual(1);
    }
  });

  it("gives every edition an opaque accent", () => {
    // Same rule as the tiers: accent feeds chips, glow and confetti, and a
    // translucent one is invisible against page chrome.
    for (const edition of EDITION_ORDER) {
      expect(editionStyle(edition).accent).not.toMatch(/\/\s*\d+%/);
    }
  });

  it("lifts the room more for a rarer finish", () => {
    const lifts = EDITION_ORDER.map((e) => editionStyle(e).lift);
    expect(lifts).toEqual([...lifts].sort((a, b) => b - a));
    expect(editionStyle("standard").lift).toBe(0);
  });

  it("labels a finish with the bare metal", () => {
    // "Parallel" is gone everywhere: the finish is the headline now, in its own
    // metal colour, and the tier drops to the line beneath it — so the two can
    // never collide on one line and the qualifier bought nothing.
    expect(editionStyle("gold").label).toBe("Gold");
    expect(editionStyle("platinum").label).toBe("Platinum");
  });
});

describe("EDITION_CLASS", () => {
  it("names a class for every edition that renders a frame", () => {
    // Drift between the map and the union shows up as an unstyled card, not a
    // type error, and standard is the only rung that deliberately has none.
    for (const edition of EDITION_ORDER) {
      if (edition === "standard") expect(EDITION_CLASS[edition]).toBeUndefined();
      else expect(EDITION_CLASS[edition]).toBeTruthy();
    }
    expect(Object.keys(EDITION_CLASS).sort()).toEqual([...EDITION_ORDER].sort());
  });
});

describe("editionRank", () => {
  it("ranks best to worst with no duplicates", () => {
    const ranks = EDITION_ORDER.map(editionRank);
    expect(new Set(ranks).size).toBe(EDITION_ORDER.length);
    expect(editionRank("platinum")).toBeLessThan(editionRank("gold"));
    expect(editionRank("bronze")).toBeLessThan(editionRank("standard"));
  });

  it("sorts an unrecognised value last, so a real finish can still displace it", () => {
    expect(editionRank("legendary")).toBeGreaterThan(editionRank("standard"));
    expect(editionRank(undefined)).toBeGreaterThan(editionRank("standard"));
    expect(editionRank(null)).toBeGreaterThan(editionRank("standard"));
  });
});

describe("isEdition", () => {
  it("rejects an inherited property name", () => {
    // Editions come back from IndexedDB and from Postgres, neither of which
    // constrains the string, so this is a live path rather than a theoretical one.
    expect(isEdition("__proto__")).toBe(false);
    expect(isEdition("constructor")).toBe(false);
    expect(isEdition("toString")).toBe(false);
  });

  it("accepts every real edition and nothing else", () => {
    for (const edition of EDITION_ORDER) expect(isEdition(edition)).toBe(true);
    expect(isEdition("base")).toBe(false);
    expect(isEdition(undefined)).toBe(false);
    expect(isEdition(7)).toBe(false);
  });
});

describe("bestEdition", () => {
  it("keeps the better of two finishes", () => {
    expect(bestEdition("bronze", "gold")).toBe("gold");
    expect(bestEdition("gold", "bronze")).toBe("gold");
    expect(bestEdition("platinum", "gold")).toBe("platinum");
  });

  it("does not demote a card you already hold", () => {
    // The rule the whole "best wins" decision rests on: pulling a duplicate in a
    // worse finish is a duplicate, not a downgrade.
    expect(bestEdition("platinum", "standard")).toBe("platinum");
  });

  it("is a no-op on equal finishes", () => {
    expect(bestEdition("silver", "silver")).toBe("silver");
  });

  it("treats an absent finish as standard, for rows written before editions", () => {
    expect(bestEdition(undefined, undefined)).toBe("standard");
    expect(bestEdition(undefined, "gold")).toBe("gold");
    expect(bestEdition("gold", undefined)).toBe("gold");
    expect(bestEdition(null, null)).toBe("standard");
  });

  it("upgrades a corrupt stored value rather than preserving it", () => {
    expect(bestEdition("__proto__", "bronze")).toBe("bronze");
    expect(bestEdition("legendary", undefined)).toBe("standard");
  });
});

describe("labels", () => {
  it("says nothing at all for a standard finish", () => {
    // 70% of pulls. A chip reading "Standard" on seven cards in ten makes the
    // other three quieter, which is the opposite of the point.
    expect(editionLabel("standard")).toBeNull();
    expect(editionOddsLabel("standard")).toBeNull();
  });

  it("names every finish that earns a badge", () => {
    expect(editionLabel("bronze")).toBe("Bronze");
    expect(editionLabel("platinum")).toBe("Platinum");
  });

  it("quotes the odds the roll actually used", () => {
    // Derived from the table, so the back of the card cannot claim a rate the
    // roll does not honour.
    expect(editionOddsLabel("platinum")).toBe("0.5% pull");
    expect(editionOddsLabel("gold")).toBe("3.5% pull");
    expect(editionOddsLabel("bronze")).toBe("18% pull");
  });

  it("says nothing for an unrecognised value rather than rendering it", () => {
    expect(editionLabel("legendary")).toBeNull();
    expect(editionLabel(undefined)).toBeNull();
    expect(editionOddsLabel("__proto__")).toBeNull();
  });
});

describe("editionCelebrates", () => {
  it("fires on gold and up, whatever the tier did", () => {
    // The payoff of the ladder: a base card can stop the garden on the roll alone.
    expect(editionCelebrates("platinum")).toBe(true);
    expect(editionCelebrates("gold")).toBe(true);
  });

  it("stays quiet on the common rungs", () => {
    expect(editionCelebrates("silver")).toBe(false);
    expect(editionCelebrates("bronze")).toBe(false);
    expect(editionCelebrates("standard")).toBe(false);
    expect(editionCelebrates(undefined)).toBe(false);
  });
});
