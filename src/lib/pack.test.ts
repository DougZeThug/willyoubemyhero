// Pack composition. The property that matters is that two people opening on the
// same day get different cards — which is the whole point of the change, and was
// not true before: the seed carried no identity at all.
import { describe, expect, it } from "vitest";
import { dealPack, packSeed, tearPolygon } from "./pack";
import { seededRng } from "./format";

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

describe("tearPolygon", () => {
  /** The 15 ragged points, left to right, with the square corners dropped.
   *
   *  Both polygons close over a straight edge of the pack — the bottom two
   *  corners for the strip, the top two for the keep — and those are not part of
   *  the rip. Reading them as if they were is how a first pass at this had the
   *  tear "reaching y=100" at every progress. */
  function edgeYs(polygon: string, side: "keep" | "strip"): number[] {
    const inner = polygon.slice(polygon.indexOf("(") + 1, polygon.lastIndexOf(")"));
    const pts = inner.split(", ").map((p) => p.split(" ").map((n) => parseFloat(n))[1]);
    // strip: [...edge, bottom-right, bottom-left]. keep: [top-left, top-right, ...edge reversed].
    return side === "strip" ? pts.slice(0, -2) : pts.slice(2).reverse();
  }

  const strip = (p: number) => tearPolygon(seededRng("seed"), p, "strip");
  const keep = (p: number) => tearPolygon(seededRng("seed"), p, "keep");
  const stripYs = (p: number) => edgeYs(strip(p), "strip");

  it("tears the same way every time for a given seed", () => {
    expect(strip(0.4)).toBe(tearPolygon(seededRng("seed"), 0.4, "strip"));
    expect(strip(0.4)).not.toBe(tearPolygon(seededRng("other"), 0.4, "strip"));
  });

  it("rises as the swipe goes up, which is the whole direction of the gesture", () => {
    // The single most breakable thing in this file: the edge used to be anchored
    // at the top and grow downward. A y that increases with progress means the
    // tear is running the wrong way and the pack opens from the wrong end.
    const mean = (ys: number[]) => ys.reduce((a, b) => a + b, 0) / ys.length;
    expect(mean(stripYs(0.8))).toBeLessThan(mean(stripYs(0.2)));
  });

  it("gives both halves the same edge, so the rip lines up", () => {
    // Each side must be handed its own generator off the same seed. One
    // generator shared across both calls walks the sequence on, the two halves
    // get different jitter, and the pieces come apart along the seam they are
    // supposed to share.
    expect(edgeYs(keep(0.5), "keep")).toEqual(edgeYs(strip(0.5), "strip"));
  });

  it("never leaves the pack, however wild the jitter", () => {
    for (const p of [0, 0.01, 0.5, 0.99, 1]) {
      for (const y of stripYs(p)) {
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(100);
      }
    }
  });

  it("is well formed at both ends of the gesture", () => {
    // At progress 0 the rip sits along the very bottom edge; at 1 it has reached
    // the top. Both ends have to be closed polygons or the first and last frames
    // of the swipe flash an empty clip.
    expect(strip(0)).toContain("100% 100%");
    expect(keep(1)).toContain("0% 0%");
    expect(stripYs(0).every((y) => y > 90)).toBe(true);
    expect(stripYs(1).every((y) => y < 10)).toBe(true);
  });
});
