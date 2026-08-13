// The finish ladder. Everything here is random in the sense that a player cannot
// predict it, and nothing here is random in the sense that a test cannot: every
// input is a fixed seed, so the whole distribution is pinnable exactly.
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
  editionSeed,
  editionStyle,
  isEdition,
  rollEdition,
  type Edition,
} from "./card-edition";
import { packSeed } from "./pack";

const EVENT = "11111111-1111-4111-8111-111111111111";
const DAY = "2026-07-28";
const SEED = packSeed(EVENT, DAY, "m:alice");

describe("the odds table", () => {
  it("sums to exactly one", () => {
    // The one property that makes the cumulative walk in rollEdition total. In
    // basis points it is an integer sum, so this is exact rather than epsilon.
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

describe("rollEdition", () => {
  it("holds the advertised odds across a fixed sweep", () => {
    const counts: Record<Edition, number> = {
      platinum: 0,
      gold: 0,
      silver: 0,
      bronze: 0,
      standard: 0,
    };
    const n = 20_000;
    for (let i = 0; i < n; i++) counts[rollEdition(editionSeed(SEED, `ep-${i}`))]++;

    // Exact, not a tolerance. Every input above is fixed, so these numbers can
    // only move if the table or the walk moves — which is exactly when this
    // should fail rather than quietly re-baseline.
    expect(counts).toEqual({
      platinum: 110,
      gold: 695,
      silver: 1612,
      bronze: 3586,
      standard: 13997,
    });

    // And the pinned numbers are the rates we think they are. Stated separately
    // so a mistuned table cannot hide behind a self-consistent pin: the block
    // above would happily pass with platinum at 40%.
    for (const edition of EDITION_ORDER) {
      const actual = counts[edition] / n;
      const advertised = EDITION_WEIGHTS_BP[edition] / EDITION_BP_TOTAL;
      expect(Math.abs(actual - advertised)).toBeLessThan(0.01);
    }
  });

  it("reaches the rarest rung at all", () => {
    // Its own assertion, because 0.5% is precisely the band an off-by-one in the
    // cumulative walk kills silently — every other rung would still look right.
    const hits = Array.from(
      { length: 5_000 },
      (_, i) => rollEdition(editionSeed(SEED, `plat-${i}`)) === "platinum",
    ).filter(Boolean);
    expect(hits.length).toBeGreaterThan(0);
  });

  it("returns a known edition for any seed", () => {
    for (let i = 0; i < 500; i++) {
      expect(isEdition(rollEdition(editionSeed(SEED, `any-${i}`)))).toBe(true);
    }
  });
});

describe("editionSeed", () => {
  const card = "card-1";

  it("rolls the same finish for the same person, day and card", () => {
    // The refresh guarantee: a pack cannot be rerolled by reloading, and neither
    // can the finish on it.
    expect(rollEdition(editionSeed(SEED, card))).toBe(rollEdition(editionSeed(SEED, card)));
  });

  it("rolls independently per card, so one pack can hold two finishes", () => {
    const finishes = new Set(
      Array.from({ length: 200 }, (_, i) => rollEdition(editionSeed(SEED, `ep-${i}`))),
    );
    expect(finishes.size).toBeGreaterThan(1);
  });

  it("gives two people different finishes of the same card", () => {
    const mine = Array.from({ length: 60 }, (_, i) =>
      rollEdition(editionSeed(packSeed(EVENT, DAY, "m:alice"), `ep-${i}`)),
    );
    const theirs = Array.from({ length: 60 }, (_, i) =>
      rollEdition(editionSeed(packSeed(EVENT, DAY, "m:bob"), `ep-${i}`)),
    );
    expect(mine).not.toEqual(theirs);
  });

  it("gives one person different finishes on two days", () => {
    const today = Array.from({ length: 60 }, (_, i) =>
      rollEdition(editionSeed(packSeed(EVENT, DAY, "m:alice"), `ep-${i}`)),
    );
    const tomorrow = Array.from({ length: 60 }, (_, i) =>
      rollEdition(editionSeed(packSeed(EVENT, "2026-07-29", "m:alice"), `ep-${i}`)),
    );
    expect(today).not.toEqual(tomorrow);
  });

  it("keeps the pack seed intact inside it, so the two cannot drift apart", () => {
    expect(editionSeed(SEED, "card-1")).toBe(`${SEED}:edition:card-1`);
  });

  it("rolls something different before the event is known, which is why callers wait for it", () => {
    // The hazard this documents, and the reason players.pack.tsx gates the roll
    // on `event?.id` rather than merely on the seed being present: packSeed
    // substitutes "no-event" until the bundle query answers, while the identity
    // behind the other two thirds comes straight out of localStorage. So there is
    // a real window where the seed is fully formed, entirely wrong, and TRUTHY —
    // which a presence check sails past. Rolling there and recording it would
    // store finishes the screen then re-rolls away from.
    const provisional = packSeed(null, DAY, "m:alice");
    const real = packSeed(EVENT, DAY, "m:alice");
    expect(provisional).not.toBe(real);
    // Truthy, which is the whole trap.
    expect(provisional).toBeTruthy();

    const before = Array.from({ length: 80 }, (_, i) =>
      rollEdition(editionSeed(provisional, `ep-${i}`)),
    );
    const after = Array.from({ length: 80 }, (_, i) => rollEdition(editionSeed(real, `ep-${i}`)));
    expect(before).not.toEqual(after);
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
