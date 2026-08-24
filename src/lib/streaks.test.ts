import { describe, expect, it } from "vitest";
import {
  STREAK_MILESTONES,
  isStreakMilestone,
  nextMilestone,
  nextMilestoneLine,
  previousDay,
  streakLine,
  streakMilestone,
  walkStreak,
  type Streak,
} from "./streaks";
import { SECRET_TIER_ORDER, isSecretTier, secretTierRank } from "./secret-rarity";

/** A live streak `current` days long. Only `current` matters to the copy. */
function walkStreakOfLength(current: number): Streak {
  return { current, startedOn: null, lastOpenedOn: null, openedToday: true };
}

describe("STREAK_MILESTONES", () => {
  it("is ascending, unique and positive", () => {
    const days = STREAK_MILESTONES.map((m) => m.days);
    // Ascending is load-bearing, not tidiness: players.pack.tsx picks the
    // claimable rung with .at(-1) to hand out the best one first, and out of
    // order that hands out the worst.
    expect(days).toEqual([...days].sort((a, b) => a - b));
    expect(new Set(days).size).toBe(days.length);
    expect(days.every((d) => d > 0)).toBe(true);
  });

  it("pays a rarer floor the longer the run, which is what makes farming day 3 bad", () => {
    // The invariant the whole feature exists for. A typo putting `rare` on day 14
    // would restore the exploit — three days on and one off would out-earn a
    // month — and nothing else in the suite would notice.
    const ranks = STREAK_MILESTONES.map((m) =>
      m.tierFloor === null ? Number.POSITIVE_INFINITY : secretTierRank(m.tierFloor),
    );
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it("floors the bottom rung at nothing and the top one at the top of the ladder", () => {
    expect(STREAK_MILESTONES[0].tierFloor).toBeNull();
    expect(STREAK_MILESTONES.at(-1)?.tierFloor).toBe(SECRET_TIER_ORDER[0]);
    // Only the first rung may go unfloored: every other one is a promise.
    expect(STREAK_MILESTONES.slice(1).every((m) => isSecretTier(m.tierFloor))).toBe(true);
  });

  it("only pays secrets, because a guest cannot hold a roster card", () => {
    expect(STREAK_MILESTONES.every((m) => m.reward === "secret")).toBe(true);
  });

  it("looks a rung up, and answers nothing for one that does not exist", () => {
    expect(isStreakMilestone(3)).toBe(true);
    expect(isStreakMilestone(5)).toBe(false);
    expect(streakMilestone(7)?.days).toBe(7);
    expect(streakMilestone(5)).toBeUndefined();
  });

  it("finds the next rung, and none once they are all behind you", () => {
    expect(nextMilestone(0)?.days).toBe(3);
    expect(nextMilestone(3)?.days).toBe(7);
    expect(nextMilestone(29)?.days).toBe(30);
    expect(nextMilestone(30)?.days).toBe(100);
    expect(nextMilestone(100)).toBeNull();
    expect(nextMilestone(400)).toBeNull();
  });
});

describe("nextMilestoneLine", () => {
  const at = (current: number) => walkStreakOfLength(current);

  it("names the rung above and what it pays", () => {
    expect(nextMilestoneLine(at(1))).toBe("Day 3 pays a bonus secret.");
    expect(nextMilestoneLine(at(3))).toBe("Day 7 pays Rare or better.");
    expect(nextMilestoneLine(at(13))).toBe("Day 14 pays Epic or better.");
    expect(nextMilestoneLine(at(29))).toBe("Day 30 pays Legendary or better.");
  });

  it("says guaranteed at the top, where there is no better", () => {
    expect(nextMilestoneLine(at(30))).toBe("Day 100 pays Mythic, guaranteed.");
  });

  it("says nothing once every rung is behind you", () => {
    // Same rule as streakLine: a promise that does not exist is not worth a line
    // of a phone screen.
    expect(nextMilestoneLine(at(100))).toBeNull();
    expect(nextMilestoneLine(at(365))).toBeNull();
  });
});

describe("previousDay", () => {
  it("steps back one calendar day", () => {
    expect(previousDay("2026-08-24")).toBe("2026-08-23");
  });

  it("crosses a month boundary", () => {
    expect(previousDay("2026-09-01")).toBe("2026-08-31");
    expect(previousDay("2026-03-01")).toBe("2026-02-28");
  });

  it("crosses a year boundary", () => {
    expect(previousDay("2026-01-01")).toBe("2025-12-31");
  });

  it("handles a leap day", () => {
    expect(previousDay("2028-03-01")).toBe("2028-02-29");
    expect(previousDay("2028-02-29")).toBe("2028-02-28");
  });

  it("is unmoved by DST, in both directions", () => {
    // 2026-03-08 is the US spring-forward and 2026-11-01 the fall-back. A
    // local-time subtraction of 24h lands on the same calendar day on one of
    // these and skips one on the other; a `date` in Postgres does neither, and
    // neither does this.
    expect(previousDay("2026-03-09")).toBe("2026-03-08");
    expect(previousDay("2026-03-08")).toBe("2026-03-07");
    expect(previousDay("2026-11-02")).toBe("2026-11-01");
    expect(previousDay("2026-11-01")).toBe("2026-10-31");
  });
});

describe("walkStreak", () => {
  const TODAY = "2026-08-24";

  it("is dead with no days at all", () => {
    expect(walkStreak([], TODAY)).toEqual({
      current: 0,
      startedOn: null,
      lastOpenedOn: null,
      openedToday: false,
    });
  });

  it("counts a run that ends today", () => {
    const s = walkStreak(["2026-08-22", "2026-08-23", "2026-08-24"], TODAY);
    expect(s).toEqual({
      current: 3,
      startedOn: "2026-08-22",
      lastOpenedOn: "2026-08-24",
      openedToday: true,
    });
  });

  it("keeps a run that ended yesterday alive, and flags it", () => {
    const s = walkStreak(["2026-08-22", "2026-08-23"], TODAY);
    expect(s.current).toBe(2);
    expect(s.openedToday).toBe(false);
    expect(s.lastOpenedOn).toBe("2026-08-23");
  });

  it("kills a run that ended two days ago", () => {
    expect(walkStreak(["2026-08-21", "2026-08-22"], TODAY).current).toBe(0);
  });

  it("stops at a gap rather than counting every day ever", () => {
    const s = walkStreak(["2026-08-01", "2026-08-02", "2026-08-23", "2026-08-24"], TODAY);
    expect(s.current).toBe(2);
    expect(s.startedOn).toBe("2026-08-23");
  });

  it("does not care about order", () => {
    const s = walkStreak(["2026-08-24", "2026-08-22", "2026-08-23"], TODAY);
    expect(s.current).toBe(3);
    expect(s.startedOn).toBe("2026-08-22");
  });

  it("counts a repeated day once", () => {
    const s = walkStreak(["2026-08-23", "2026-08-23", "2026-08-24"], TODAY);
    expect(s.current).toBe(2);
  });

  it("walks across a month boundary", () => {
    const s = walkStreak(["2026-07-31", "2026-08-01", "2026-08-02"], "2026-08-02");
    expect(s.current).toBe(3);
    expect(s.startedOn).toBe("2026-07-31");
  });

  it("counts a single day opened today", () => {
    const s = walkStreak([TODAY], TODAY);
    expect(s).toEqual({
      current: 1,
      startedOn: TODAY,
      lastOpenedOn: TODAY,
      openedToday: true,
    });
  });
});

describe("streakLine", () => {
  it("says nothing at zero, rather than saying zero", () => {
    expect(streakLine(walkStreak([], "2026-08-24"))).toBeNull();
  });

  it("asks for today's pack when the run is at risk", () => {
    const line = streakLine(walkStreak(["2026-08-23"], "2026-08-24"));
    expect(line).toContain("Day 1");
    expect(line).toContain("keep it alive");
  });

  it("just reports the day once today is in", () => {
    const line = streakLine(walkStreak(["2026-08-24"], "2026-08-24"));
    expect(line).toContain("Day 1");
    expect(line).not.toContain("keep it alive");
  });
});
