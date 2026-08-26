// The dust constants, and the one function that reads them.
//
// The numbers themselves are pinned against Postgres in tests/db/dust.test.ts,
// which imports this file — that is the mirror. What is asserted here is the
// judgement this module makes on top of them: that an untrusted finish pays the
// floor whatever it says on the card, that an unknown secret level pays the
// common rung, and that the two ladders stay in the proportion they were derived
// in.
import { describe, expect, it } from "vitest";
import { EDITION_ORDER, editionRank } from "./card-edition";
import {
  SECRET_TIER_BP_TOTAL,
  SECRET_TIER_ORDER,
  SECRET_TIER_WEIGHTS_BP,
  secretTierRank,
} from "./secret-rarity";
import {
  dustLive,
  DUST_PRICES,
  MILL_BY_EDITION,
  MILL_CLIENT_FLAT,
  MILL_LADDER,
  millValue,
  SECRET_SELL_LADDER,
  SELL_BY_SECRET_TIER,
  secretSellValue,
} from "./dust";

describe("the mill ladder", () => {
  it("pays more for a rarer finish, at every rung", () => {
    // Monotonic rather than a list of five numbers: a table where gold paid less
    // than silver would make the whole finish ladder pointless, and that is worth
    // catching as a property rather than as five separate assertions.
    const byRarity = [...EDITION_ORDER].sort((a, b) => editionRank(a) - editionRank(b));
    for (let i = 1; i < byRarity.length; i++) {
      expect(MILL_BY_EDITION[byRarity[i - 1]]).toBeGreaterThan(MILL_BY_EDITION[byRarity[i]]);
    }
  });

  it("covers every finish, so no copy can fall through it", () => {
    expect(Object.keys(MILL_BY_EDITION).sort()).toEqual([...EDITION_ORDER].sort());
  });

  it("bottoms out at the flat rate a hand-asserted copy pays", () => {
    // Otherwise the floor would be worth more than a real standard, and the way
    // to farm dust would be to stop letting the server decide anything.
    expect(MILL_BY_EDITION.standard).toBe(MILL_CLIENT_FLAT);
  });

  it("reads rarest first", () => {
    expect(MILL_LADDER[0].edition).toBe("platinum");
    expect(MILL_LADDER[MILL_LADDER.length - 1].edition).toBe("standard");
  });
});

describe("millValue", () => {
  it("pays by the finish when the server decided it", () => {
    expect(millValue("platinum", "server")).toBe(MILL_BY_EDITION.platinum);
    expect(millValue("bronze", "server")).toBe(MILL_BY_EDITION.bronze);
  });

  it("pays the floor for a platinum a phone asserted", () => {
    // The whole reason edition_asserted_by exists: forging one has to be pointless.
    expect(millValue("platinum", "client")).toBe(MILL_CLIENT_FLAT);
  });

  it("treats an unfamiliar provenance as untrusted", () => {
    // Under-promise, the same direction the SQL errs in. A value nobody has taught
    // this function about must not unlock the top of the ladder.
    expect(millValue("platinum", "trustme")).toBe(MILL_CLIENT_FLAT);
    expect(millValue("platinum", "")).toBe(MILL_CLIENT_FLAT);
  });
});

describe("the secret sell ladder", () => {
  it("pays more for a rarer level, at every rung", () => {
    // The same property the mill ladder holds, and for the same reason: a table
    // where an epic sold for less than a rare would make the tier meaningless.
    const byRarity = [...SECRET_TIER_ORDER].sort((a, b) => secretTierRank(a) - secretTierRank(b));
    for (let i = 1; i < byRarity.length; i++) {
      expect(SELL_BY_SECRET_TIER[byRarity[i - 1]]).toBeGreaterThan(
        SELL_BY_SECRET_TIER[byRarity[i]],
      );
    }
  });

  it("covers every level, so no copy can fall through it", () => {
    expect(Object.keys(SELL_BY_SECRET_TIER).sort()).toEqual([...SECRET_TIER_ORDER].sort());
  });

  it("is three times the mill, rung for rung", () => {
    // Not a coincidence worth re-deriving by hand: the secret tier weights are
    // identical to the edition weights, so this ladder IS the roster one scaled.
    const mill = MILL_LADDER.map((r) => r.value);
    expect(SECRET_SELL_LADDER.map((r) => r.value)).toEqual(mill.map((v) => v * 3));
  });

  it("reads rarest first", () => {
    expect(SECRET_SELL_LADDER[0].tier).toBe("mythic");
    expect(SECRET_SELL_LADDER[SECRET_SELL_LADDER.length - 1].tier).toBe("common");
  });
});

describe("secretSellValue", () => {
  it("pays by the level on the copy", () => {
    expect(secretSellValue("mythic")).toBe(SELL_BY_SECRET_TIER.mythic);
    expect(secretSellValue("rare")).toBe(SELL_BY_SECRET_TIER.rare);
  });

  it("pays the common rung for a level it does not recognise", () => {
    // The floor `secret_sell_value`'s COALESCE lands on, since secret_tier_rank
    // answers 99 for an unknown value and ARRAY[...][99] is NULL. Both sides have
    // to agree, or the sheet promises one payout and the ledger files another.
    expect(secretSellValue("platinum")).toBe(SELL_BY_SECRET_TIER.common);
    expect(secretSellValue(null)).toBe(SELL_BY_SECRET_TIER.common);
    expect(secretSellValue(undefined)).toBe(SELL_BY_SECRET_TIER.common);
  });
});

describe("the prices", () => {
  it("costs more to buy a pull than any single copy pays", () => {
    // A sink that one burn covers is not a sink. Six platinums, or thirty
    // standards, is the shape this is tuned to.
    expect(DUST_PRICES.bonusPull).toBeGreaterThan(MILL_BY_EDITION.platinum);
  });

  it("prices a re-roll under a pull, since it buys the smaller thing", () => {
    expect(DUST_PRICES.reroll).toBeLessThan(DUST_PRICES.bonusPull);
  });

  it("pays a common secret enough that six sales buy a pull", () => {
    // The rate the whole earn side is tuned to, restated over the ladder that
    // replaced the flat dupe credit. Six sales AT THE AVERAGE, not six commons:
    // the average copy is 26.4 dust, which is why the 150 price needed no
    // retuning when the flat 25 was folded into this.
    const average =
      SECRET_SELL_LADDER.reduce(
        (sum, { tier, value }) => sum + value * SECRET_TIER_WEIGHTS_BP[tier],
        0,
      ) / SECRET_TIER_BP_TOTAL;
    expect(average * 6).toBeGreaterThanOrEqual(DUST_PRICES.bonusPull);
  });
});

describe("dustLive", () => {
  // The switch decides whether the chip and the shop render at all. Postgres is
  // what stops anything being spent, so the only cost of getting this wrong is a
  // button that answers "not yet" — but it has to default to hiding, because the
  // reason the switch exists is that the feature is not ready to be seen.
  it("is on only when the event says so", () => {
    expect(dustLive({ dust_enabled: true })).toBe(true);
    expect(dustLive({ dust_enabled: false })).toBe(false);
  });

  it("treats an event that has not answered yet as off", () => {
    // The vault renders before the event query resolves, and a chip that appears
    // and then vanishes is worse than one that arrives a beat late.
    expect(dustLive(null)).toBe(false);
    expect(dustLive(undefined)).toBe(false);
  });

  it("treats an event that has never heard of the column as off", () => {
    // Deploying the migration is a no-op for a client running the old bundle,
    // and a client running the new bundle against the old view sees nothing.
    expect(dustLive({ name: "Draft Combine" })).toBe(false);
    expect(dustLive({ dust_enabled: null })).toBe(false);
  });
});
