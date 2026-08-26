// The marketplace's pure half: the bounds, the labels, and the price anchor.
//
// Everything about whether a listing or a sale is ALLOWED lives in SQL under the
// participant row lock, and tests/db/market.test.ts is where that is pinned. What
// is asserted here is the half this module owns: that the numbers it prints agree
// with the ones Postgres enforces, and that the anchor beside a price field is
// the same ladder the house actually pays.
import { describe, expect, it } from "vitest";
import {
  houseFloor,
  marketStatusLabel,
  MARKET_MAX_ACTIVE,
  MARKET_PRICE_MAX,
  MARKET_PRICE_MIN,
  type MarketListingItem,
  type MarketListingStatus,
} from "./market";
import { DUST_PRICES, MILL_BY_EDITION, MILL_CLIENT_FLAT, SELL_BY_SECRET_TIER } from "./dust";
import { EDITION_ORDER, type Edition } from "./card-edition";
import { SECRET_TIER_ORDER } from "./secret-rarity";

const roster = (edition: Edition): MarketListingItem => ({
  kind: "roster",
  eventParticipantId: "ep",
  edition,
});

describe("the price bounds", () => {
  it("starts at one, because zero would raise rather than refuse", () => {
    // dust_ledger_delta_nonzero is a CHECK, so a price of 0 does not make a free
    // card — it aborts a transaction that has already moved one. The floor is a
    // crash guard first and a product rule second.
    expect(MARKET_PRICE_MIN).toBe(1);
  });

  it("stops far above anything the house sells, and far below a fat finger", () => {
    expect(MARKET_PRICE_MAX).toBeGreaterThan(DUST_PRICES.bonusPull);
    expect(MARKET_PRICE_MAX).toBeGreaterThan(Math.max(...Object.values(SELL_BY_SECRET_TIER)));
    expect(MARKET_PRICE_MAX).toBeLessThan(50_000);
  });

  it("caps a stall at something a phone can scroll", () => {
    // Thirteen people and no pagination: the only shape of denial-of-service a
    // marketplace this size has.
    expect(MARKET_MAX_ACTIVE).toBeGreaterThan(1);
    expect(MARKET_MAX_ACTIVE).toBeLessThanOrEqual(50);
  });
});

describe("houseFloor", () => {
  it("quotes the mill ladder for a copy Postgres rolled", () => {
    for (const edition of EDITION_ORDER) {
      expect(houseFloor(roster(edition), "server")).toBe(MILL_BY_EDITION[edition]);
    }
  });

  it("quotes the flat floor for a finish nobody trustworthy decided", () => {
    // The same direction millValue errs in, and the safe one: a hand-asserted
    // platinum is worth five however rare it claims to be, so the anchor beside
    // the price field must not promise a hundred.
    for (const edition of EDITION_ORDER) {
      expect(houseFloor(roster(edition), "client")).toBe(MILL_CLIENT_FLAT);
    }
  });

  it("treats an unrecognised provenance as untrusted", () => {
    expect(houseFloor(roster("platinum"), "something-new")).toBe(MILL_CLIENT_FLAT);
  });

  it("quotes the secret ladder by tier", () => {
    for (const tier of SECRET_TIER_ORDER) {
      expect(houseFloor({ kind: "secret", name: "x", artUrl: null, tier, concealed: false })).toBe(
        SELL_BY_SECRET_TIER[tier],
      );
    }
  });

  it("ignores provenance for a secret, which has no untrusted path", () => {
    // secret_card_pulls.tier is only ever written by roll_secret_tier(), so unlike
    // an edition there is no claim to distrust. The asymmetry is deliberate.
    expect(
      houseFloor({ kind: "secret", name: "x", artUrl: null, tier: "mythic", concealed: false }, "client"), // prettier-ignore
    ).toBe(SELL_BY_SECRET_TIER.mythic);
  });

  it("is a floor a seller can legitimately undercut", () => {
    // Not a rule, and this is the assertion that says so: every rung sits inside
    // the price bounds, so listing below the mill is expressible.
    for (const edition of EDITION_ORDER) {
      expect(houseFloor(roster(edition), "server")).toBeGreaterThanOrEqual(MARKET_PRICE_MIN);
      expect(houseFloor(roster(edition), "server")).toBeLessThanOrEqual(MARKET_PRICE_MAX);
    }
  });
});

describe("marketStatusLabel", () => {
  it("keeps cancelled and voided apart", () => {
    // The distinction trade_offers draws and this table copies: you took it down
    // versus the card moved first. Collapsing them would tell a seller they
    // cancelled something they did not.
    expect(marketStatusLabel("cancelled")).not.toBe(marketStatusLabel("voided"));
  });

  it("names every status the CHECK allows", () => {
    const all: MarketListingStatus[] = ["active", "sold", "cancelled", "voided"];
    for (const status of all) expect(marketStatusLabel(status)).not.toBe("Unknown");
  });

  it("does not throw on a status it has never heard of", () => {
    // The status column is append-only text; a value added in SQL before this
    // file learns about it should read as unknown rather than crash a list.
    expect(marketStatusLabel("teleported")).toBe("Unknown");
  });
});
