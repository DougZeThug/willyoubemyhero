// The pack's client-side rules. Composition is Postgres's now (open_pack), so
// what is tested here is the reading of it: where the ceremony is, which card
// to come back to, what the vault says about a stored row, and the one cue the
// nav and the vault share.
import { describe, expect, it } from "vitest";
import {
  cardsLeft,
  nextLocalMidnight,
  nextPackLabel,
  packStage,
  packWaiting,
  resumeCursor,
  TEAR,
  tearProgress,
  todayPackState,
  type PackStatus,
} from "./pack";

describe("packWaiting", () => {
  const status = (over: Partial<PackStatus> = {}): PackStatus => ({
    claimed: true,
    day: "2026-09-08",
    openedToday: false,
    secretsOwned: 0,
    resetsAt: "2026-09-09T04:00:00Z",
    ...over,
  });

  it("says yes while today's pack is sealed", () => {
    expect(packWaiting(status())).toBe(true);
  });

  it("says no once it has been opened", () => {
    expect(packWaiting(status({ openedToday: true }))).toBe(false);
  });

  it("says no to a device the server does not know", () => {
    expect(packWaiting(status({ claimed: false }))).toBe(false);
    expect(packWaiting(undefined)).toBe(false);
    expect(packWaiting(null)).toBe(false);
  });
});

describe("packStage", () => {
  const at = (cursor: number) => packStage({ torn: true, opening: false, packSize: 3, cursor });

  it("is sealed until the wrapper comes off", () => {
    expect(packStage({ torn: false, opening: false, packSize: 3, cursor: 0 })).toBe("sealed");
  });

  it("plays the opening ceremony before handing over to the stand", () => {
    expect(packStage({ torn: true, opening: true, packSize: 3, cursor: 0 })).toBe("opening");
  });

  // A tab left open across midnight has its pack re-sealed under it by the day
  // tick. A ceremony that outlived the pack it was opening must not hold the
  // screen against a pack that no longer exists.
  it("never opens a pack that is no longer torn", () => {
    expect(packStage({ torn: false, opening: true, packSize: 3, cursor: 0 })).toBe("sealed");
  });

  it("hands to the stand the moment the ceremony ends", () => {
    expect(at(0)).toBe("revealing");
  });

  it("keeps the stand while there are cards left to turn", () => {
    expect(at(1)).toBe("revealing");
    expect(at(2)).toBe("revealing");
  });

  it("hands over to the columns once the user walks off the end", () => {
    expect(at(3)).toBe("complete");
  });

  it("gives a secret no step of its own — it is a slot like any other", () => {
    // Three slots, whatever kind they are. There is no fourth step to park on.
    expect(packStage({ torn: true, opening: false, packSize: 3, cursor: 3 })).toBe("complete");
  });
});

describe("resumeCursor", () => {
  it("comes back to the first card still face-down", () => {
    expect(resumeCursor({ packSize: 3, revealed: [0] })).toBe(1);
  });

  it("starts at the beginning on a pack nobody has touched", () => {
    expect(resumeCursor({ packSize: 3, revealed: [] })).toBe(0);
  });

  it("goes past the end once every card has been seen", () => {
    expect(resumeCursor({ packSize: 3, revealed: [0, 1, 2] })).toBe(3);
  });

  it("ignores the order cards were turned in", () => {
    expect(resumeCursor({ packSize: 3, revealed: [2, 0] })).toBe(1);
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
  it("counts the slots still face-down, whatever kind they are", () => {
    expect(cardsLeft({ slots: 3, revealed: 1 })).toBe(2);
    expect(cardsLeft({ slots: 3, revealed: 3 })).toBe(0);
  });

  it("never goes negative on a row that revealed more than it dealt", () => {
    expect(cardsLeft({ slots: 2, revealed: 5 })).toBe(0);
  });
});

describe("todayPackState", () => {
  const cards = [
    { kind: "roster", id: "a" },
    { kind: "secret", id: "s" },
    { kind: "roster", id: "c" },
  ];
  const row = { dayKey: "2026-09-04", cards, revealed: [], cursor: 0, identity: "d:1" };
  const args = { row, dayKey: "2026-09-04", identity: "d:1" };

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
    const legacy = { dayKey: "2026-09-04", cards: cards.slice(0, 2), revealed: [0], cursor: 1 };
    expect(todayPackState({ ...args, row: legacy })).toEqual({ state: "torn", left: 1 });
  });

  it("is sealed for a row written before the server dealt packs", () => {
    // Such a row has ids and no `cards`. It is not today's pack: the pack screen
    // asks the server, which either resumes or deals over it.
    const old = { dayKey: "2026-09-04", revealed: [0, 1, 2], cursor: 3, identity: "d:1" };
    expect(todayPackState({ ...args, row: old })).toEqual({ state: "sealed" });
  });

  it("is torn while cards are still face-down, secret or not", () => {
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

  it("is done for a row that dealt nothing", () => {
    // The server had nothing to deal and said so; there is nothing to open.
    expect(todayPackState({ ...args, row: { ...row, cards: [] } })).toEqual({ state: "done" });
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
