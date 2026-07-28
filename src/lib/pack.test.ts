// Pack composition. The property that matters is that two people opening on the
// same day get different cards — which is the whole point of the change, and was
// not true before: the seed carried no identity at all.
import { describe, expect, it } from "vitest";
import { dealPack, packSeed } from "./pack";

const EVENT = "00000000-0000-4000-8000-0000000000ff";
const DAY = "2026-07-28";
const roster = Array.from({ length: 13 }, (_, i) => ({ id: `ep-${i}` }));

const ids = (cards: { id: string }[]) => cards.map((c) => c.id);

describe("packSeed", () => {
  it("carries the identity, which is what makes a pack yours", () => {
    expect(packSeed(EVENT, DAY, "m:alice")).toBe(`${EVENT}:${DAY}:m:alice`);
  });

  it("survives having no event, so the screen still works before one is active", () => {
    expect(packSeed(null, DAY, "d:abc")).toBe(`no-event:${DAY}:d:abc`);
  });
});

describe("dealPack", () => {
  it("deals the same cards to the same person all day", () => {
    const seed = packSeed(EVENT, DAY, "m:alice");
    expect(ids(dealPack(roster, seed, {}, 3))).toEqual(ids(dealPack(roster, seed, {}, 3)));
  });

  it("deals different cards to two different people", () => {
    const alice = dealPack(roster, packSeed(EVENT, DAY, "m:alice"), {}, 3);
    const bob = dealPack(roster, packSeed(EVENT, DAY, "m:bob"), {}, 3);
    expect(ids(alice)).not.toEqual(ids(bob));
  });

  it("deals different cards to one person on two days", () => {
    const today = dealPack(roster, packSeed(EVENT, DAY, "m:alice"), {}, 3);
    const tomorrow = dealPack(roster, packSeed(EVENT, "2026-07-29", "m:alice"), {}, 3);
    expect(ids(today)).not.toEqual(ids(tomorrow));
  });

  it("deals a full pack with no duplicates in it", () => {
    const pack = dealPack(roster, packSeed(EVENT, DAY, "m:alice"), {}, 3);
    expect(pack).toHaveLength(3);
    expect(new Set(ids(pack)).size).toBe(3);
  });

  it("prefers an uncollected card in the last slot, so the set completes", () => {
    // Everything collected except one card: that card has to be the hit.
    const baseline = Object.fromEntries(roster.map((p) => [p.id, true]));
    delete baseline["ep-9"];
    const pack = dealPack(roster, packSeed(EVENT, DAY, "m:alice"), baseline, 3);
    expect(pack[2].id).toBe("ep-9");
  });

  it("leaves the earlier slots alone when it swaps the last one", () => {
    const seed = packSeed(EVENT, DAY, "m:alice");
    const fresh = dealPack(roster, seed, {}, 3);
    const baseline = Object.fromEntries(roster.map((p) => [p.id, true]));
    delete baseline["ep-9"];
    const swapped = dealPack(roster, seed, baseline, 3);
    expect(ids(swapped).slice(0, 2)).toEqual(ids(fresh).slice(0, 2));
  });

  it("does not put the same card in twice when the hit is already in the pack", () => {
    const seed = packSeed(EVENT, DAY, "m:alice");
    const fresh = dealPack(roster, seed, {}, 3);
    // Collect everything except the card already sitting in slot 0.
    const baseline = Object.fromEntries(roster.map((p) => [p.id, true]));
    delete baseline[fresh[0].id];
    const pack = dealPack(roster, seed, baseline, 3);
    expect(new Set(ids(pack)).size).toBe(3);
  });

  it("returns nothing for an empty roster rather than throwing", () => {
    expect(dealPack([], packSeed(EVENT, DAY, "m:alice"), {}, 3)).toEqual([]);
  });

  it("deals what it can when the roster is smaller than the pack", () => {
    expect(dealPack(roster.slice(0, 2), packSeed(EVENT, DAY, "m:alice"), {}, 3)).toHaveLength(2);
  });
});
