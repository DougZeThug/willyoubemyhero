// Pack composition. The property that matters is that two people opening on the
// same day get different cards — which is the whole point of the change, and was
// not true before: the seed carried no identity at all.
import { describe, expect, it } from "vitest";
import {
  dealPack,
  packSeed,
  packStage,
  resumeCursor,
  TEAR,
  tearProgress,
  type SecretSlot,
} from "./pack";

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

describe("packStage", () => {
  const at = (cursor: number, secretSlot: SecretSlot = "sealed") =>
    packStage({ torn: true, packSize: 3, cursor, secretSlot });

  it("is sealed until the wrapper comes off", () => {
    expect(packStage({ torn: false, packSize: 3, cursor: 0, secretSlot: "hidden" })).toBe("sealed");
  });

  it("keeps the stand while there are cards left to turn", () => {
    expect(at(0)).toBe("revealing");
    expect(at(2)).toBe("revealing");
  });

  it("gives the secret its own step past the last roster card", () => {
    expect(at(3, "sealed")).toBe("revealing");
    expect(at(3, "pending")).toBe("revealing");
    expect(at(3, "open")).toBe("revealing");
  });

  it("hands over to the columns once the user walks off the end", () => {
    expect(at(4, "open")).toBe("complete");
  });

  // The claim gate and the retry button live in the finished pack, not on the
  // stand — a card that is never coming must not be able to hold the sequence.
  it("does not let a secret nobody is getting stall the sequence", () => {
    for (const slot of ["gated", "failed", "hidden"] as const) {
      expect(at(3, slot)).toBe("complete");
    }
  });
});

describe("resumeCursor", () => {
  it("comes back to the first card still face-down", () => {
    expect(resumeCursor({ packSize: 3, revealed: [0], secretRevealed: false })).toBe(1);
  });

  it("starts at the beginning on a pack nobody has touched", () => {
    expect(resumeCursor({ packSize: 3, revealed: [], secretRevealed: false })).toBe(0);
  });

  it("parks on the secret's slot when the roster is done but it is not", () => {
    expect(resumeCursor({ packSize: 3, revealed: [0, 1, 2], secretRevealed: false })).toBe(3);
  });

  // Re-running the ceremony on every reload turns the payoff into a toll.
  it("goes past the end once the secret has already been seen", () => {
    expect(resumeCursor({ packSize: 3, revealed: [0, 1, 2], secretRevealed: true })).toBe(4);
  });

  it("ignores the order cards were turned in", () => {
    expect(resumeCursor({ packSize: 3, revealed: [2, 0], secretRevealed: false })).toBe(1);
  });
});

describe("tearProgress", () => {
  // The whole point of the rewrite: the old handler compared the pointer's
  // absolute position against the pack's top edge, so a tap that had travelled
  // nowhere opened the pack.
  it("is zero for a press that has not moved", () => {
    expect(tearProgress(100, 100, 300)).toBe(0);
  });

  it("measures travel, not position", () => {
    const width = 300;
    // Same finishing point, different starting points, different progress.
    expect(tearProgress(100, 200, width)).toBeGreaterThan(tearProgress(180, 200, width));
  });

  it("reaches 1 at the full span and clamps beyond it", () => {
    expect(tearProgress(0, 300 * TEAR.span, 300)).toBeCloseTo(1);
    expect(tearProgress(0, 9999, 300)).toBe(1);
  });

  it("clamps a backwards drag to zero rather than going negative", () => {
    expect(tearProgress(200, 50, 300)).toBe(0);
  });

  it("survives a zero-width pack instead of dividing by it", () => {
    expect(tearProgress(0, 50, 0)).toBe(0);
  });
});
