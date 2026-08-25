// The dust constants, and the one function that reads them.
//
// The numbers themselves are pinned against Postgres in tests/db/dust.test.ts,
// which imports this file — that is the mirror. What is asserted here is the
// judgement this module makes on top of them: that an untrusted finish pays the
// floor, whatever it says on the card.
import { describe, expect, it } from "vitest";
import { EDITION_ORDER, editionRank } from "./card-edition";
import {
  dustLive,
  DUPE_SECRET_CREDIT,
  DUST_PRICES,
  MILL_BY_EDITION,
  MILL_CLIENT_FLAT,
  MILL_LADDER,
  millValue,
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

describe("the prices", () => {
  it("costs more to buy a pull than any single copy pays", () => {
    // A sink that one burn covers is not a sink. Six platinums, or thirty
    // standards, is the shape this is tuned to.
    expect(DUST_PRICES.bonusPull).toBeGreaterThan(MILL_BY_EDITION.platinum);
  });

  it("prices a re-roll under a pull, since it buys the smaller thing", () => {
    expect(DUST_PRICES.reroll).toBeLessThan(DUST_PRICES.bonusPull);
  });

  it("pays a dupe enough that six of them buy a pull", () => {
    // The rate the whole earn side is tuned to: a daily player who keeps drawing
    // duplicates still gets somewhere.
    expect(DUPE_SECRET_CREDIT * 6).toBeGreaterThanOrEqual(DUST_PRICES.bonusPull);
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
