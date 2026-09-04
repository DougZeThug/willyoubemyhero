// Pack composition. The property that matters is that two people opening on the
// same day get different cards — which is the whole point of the change, and was
// not true before: the seed carried no identity at all.
import { describe, expect, it } from "vitest";
import {
  cardsLeft,
  dealPack,
  nextLocalMidnight,
  nextPackLabel,
  packSeed,
  packStage,
  resumeCursor,
  TEAR,
  tearProgress,
  todayPackState,
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
    packStage({ torn: true, opening: false, packSize: 3, cursor, secretSlot });

  it("is sealed until the wrapper comes off", () => {
    expect(
      packStage({ torn: false, opening: false, packSize: 3, cursor: 0, secretSlot: "hidden" }),
    ).toBe("sealed");
  });

  it("plays the opening ceremony before handing over to the stand", () => {
    expect(
      packStage({ torn: true, opening: true, packSize: 3, cursor: 0, secretSlot: "pending" }),
    ).toBe("opening");
  });

  // The secret is pulled the moment the pack is dealt, so the slot moves under
  // the ceremony while it plays. None of those moves may change the stage.
  it("holds the ceremony however the secret slot moves under it", () => {
    for (const slot of ["hidden", "pending", "sealed", "failed"] as const) {
      expect(
        packStage({ torn: true, opening: true, packSize: 3, cursor: 3, secretSlot: slot }),
      ).toBe("opening");
    }
  });

  // A tab left open across midnight has its pack re-sealed under it by the day
  // tick. A ceremony that outlived the pack it was opening must not hold the
  // screen against a pack that no longer exists.
  it("never opens a pack that is no longer torn", () => {
    expect(
      packStage({ torn: false, opening: true, packSize: 3, cursor: 0, secretSlot: "hidden" }),
    ).toBe("sealed");
  });

  it("hands to the stand the moment the ceremony ends", () => {
    expect(
      packStage({ torn: true, opening: false, packSize: 3, cursor: 0, secretSlot: "pending" }),
    ).toBe("revealing");
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

describe("cardsLeft", () => {
  const args = { ids: 3, revealed: 0, secretRevealed: false, secretPending: false };

  it("counts the roster cards still face-down", () => {
    expect(cardsLeft({ ...args, revealed: 1 })).toBe(2);
  });

  it("counts the secret's slot only when one is actually coming", () => {
    // A guest with no actor, a spent day and an empty set all land here, and none
    // of them should be promised a fourth card.
    expect(cardsLeft({ ...args, revealed: 3, secretPending: false })).toBe(0);
    expect(cardsLeft({ ...args, revealed: 3, secretPending: true })).toBe(1);
  });

  it("stops counting a secret once it has been turned", () => {
    expect(cardsLeft({ ...args, revealed: 3, secretPending: true, secretRevealed: true })).toBe(0);
  });

  it("never goes negative on a row that revealed more than it dealt", () => {
    expect(cardsLeft({ ...args, ids: 2, revealed: 5 })).toBe(0);
  });
});

describe("todayPackState", () => {
  const row = { dayKey: "2026-09-04", ids: ["a", "b", "c"], revealed: [], cursor: 0, identity: "d:1" }; // prettier-ignore
  const args = { row, dayKey: "2026-09-04", identity: "d:1", secretPending: false };

  it("is sealed with no row at all", () => {
    expect(todayPackState({ ...args, row: null })).toEqual({ state: "sealed" });
  });

  it("is sealed once the day has turned", () => {
    expect(todayPackState({ ...args, dayKey: "2026-09-05" })).toEqual({ state: "sealed" });
  });

  it("is sealed for whoever picked the phone up next", () => {
    // Packs are per-person, and a handset changes hands in this league.
    expect(todayPackState({ ...args, identity: "m:p-alice" })).toEqual({ state: "sealed" });
  });

  it("treats a row with no identity as this device's", () => {
    // Written before per-person packs. Calling it somebody else's would take the
    // cards off the screen of anybody mid-reveal on the day this ships.
    const legacy = { dayKey: "2026-09-04", ids: ["a", "b"], revealed: [0], cursor: 1 };
    expect(todayPackState({ ...args, row: legacy })).toEqual({ state: "torn", left: 1 });
  });

  it("is torn while cards are still face-down", () => {
    expect(todayPackState({ ...args, row: { ...row, revealed: [0] } })).toEqual({
      state: "torn",
      left: 2,
    });
  });

  it("is done once the whole pack is turned", () => {
    expect(todayPackState({ ...args, row: { ...row, revealed: [0, 1, 2], cursor: 3 } })).toEqual({
      state: "done",
    });
  });

  it("still owes the secret when one is waiting", () => {
    expect(
      todayPackState({
        ...args,
        secretPending: true,
        row: { ...row, revealed: [0, 1, 2], cursor: 3 },
      }),
    ).toEqual({ state: "torn", left: 1 });
  });

  it("calls a pre-stand row torn, because that is what the pack screen does with it", () => {
    // No cursor and everything revealed is the shape the old ceremony wrote, and
    // the pack replays it through the stand — turning every card face-down again.
    // "Done" here would have the two screens disagree about whether there is
    // anything left to open.
    const preStand = { dayKey: "2026-09-04", ids: ["a", "b", "c"], revealed: [0, 1, 2] };
    expect(todayPackState({ ...args, row: preStand })).toEqual({ state: "torn", left: 3 });
  });

  it("is sealed for a row that dealt nothing", () => {
    expect(todayPackState({ ...args, row: { ...row, ids: [] } })).toEqual({ state: "sealed" });
  });
});

describe("nextPackLabel", () => {
  const now = Date.parse("2026-09-04T18:00:00Z");

  it("rounds hours UP, so the clock never breaks the promise it printed", () => {
    expect(nextPackLabel("2026-09-04T23:50:00Z", now)).toBe("Next pack in 6h");
  });

  it("drops to minutes inside the last hour", () => {
    expect(nextPackLabel("2026-09-04T18:12:00Z", now)).toBe("Next pack in 12m");
  });

  it("never says zero minutes", () => {
    expect(nextPackLabel("2026-09-04T18:00:20Z", now)).toBe("Next pack in 1m");
  });

  it("says so once the instant has passed", () => {
    expect(nextPackLabel("2026-09-04T17:00:00Z", now)).toBe("Next pack any moment now");
  });

  it("falls back to tomorrow when nobody has told us", () => {
    // Every device with no actor: the server tells a stranger nothing.
    expect(nextPackLabel(null, now)).toBe("Next pack tomorrow");
    expect(nextPackLabel("not a date", now)).toBe("Next pack tomorrow");
  });
});

describe("nextLocalMidnight", () => {
  it("is the next midnight where the phone is standing", () => {
    const now = new Date(2026, 8, 4, 18, 30).getTime();
    const at = new Date(nextLocalMidnight(now));
    expect(at.getFullYear()).toBe(2026);
    expect(at.getMonth()).toBe(8);
    expect(at.getDate()).toBe(5);
    expect(at.getHours()).toBe(0);
    expect(at.getMinutes()).toBe(0);
  });

  it("rolls the month rather than landing on the 32nd", () => {
    const at = new Date(nextLocalMidnight(new Date(2026, 8, 30, 23, 59).getTime()));
    expect(at.getMonth()).toBe(9);
    expect(at.getDate()).toBe(1);
  });
});
