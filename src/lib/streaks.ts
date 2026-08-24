// Pack streaks: the run of consecutive league days somebody opened a pack on,
// and the milestones that run pays out.
//
// Nothing here is stored. A streak is a walk over `pack_opens`, which has carried
// one row per identity per league day since the table was added — which is why
// this feature needs almost no schema, and why a streak survives the guest ->
// member claim for free (`claim_guest_packs` moves the rows, and the walk simply
// finds more of them afterwards).
//
// `STREAK_MILESTONES[].days` is stored in `streak_milestone_claims.milestone`, so
// a rung may be ADDED but never renumbered — changing 7 to 8 would orphan every
// claim already paid at 7 and hand those people the reward twice. Same contract
// as the award ids in awards.ts.
//
// The rungs are mirrored by the `IN` list inside `claim_streak_milestone`, and
// `tierFloor` by the `CASE` beside it. Both live in SQL as well as here for the
// same reason: that function is SECURITY DEFINER, so a ladder that existed only
// in this module would be a ladder anybody could rewrite. A db test pins each.
//
// The walk below is duplicated in `claim_streak_milestone`, deliberately: the
// button is drawn from this one and the payout is authorised by that one, and a
// client that could shift the boundary is a client that can mint milestones. A db
// test pins the two against each other, the way leagueDay() is pinned to the SQL
// it mirrors.

import { secretTierFloorLabel, type SecretTier } from "./secret-rarity";

/**
 * What a milestone pays.
 *
 * Only `secret` exists today. `card_copies.participant_id` is NOT NULL, so a
 * roster card cannot be granted to a guest — and guests build real streaks — so
 * paying secrets is what keeps one ladder for everybody rather than two.
 */
export type StreakRewardKind = "secret";

export type StreakMilestone = {
  /** Consecutive days required. Stored in streak_milestone_claims.milestone. */
  days: number;
  reward: StreakRewardKind;
  /**
   * The worst level this rung's secret may roll — null on day 3, which pays the
   * plain rate. A floor only ever upgrades, so a deep rung can still roll better
   * than it promised.
   *
   * This is what stops a broken streak being farmable. Every rung stays
   * re-earnable, because a run that died and was rebuilt genuinely is a new run;
   * but three days on and one day off now farms commons, while the thirty nobody
   * broke is the only way to a guaranteed legendary.
   */
  tierFloor: SecretTier | null;
  label: string;
  blurb: string;
};

export const STREAK_MILESTONES: readonly StreakMilestone[] = [
  {
    days: 3,
    reward: "secret",
    tierFloor: null,
    label: "Three Days",
    blurb: "A bonus secret, on the house.",
  },
  {
    days: 7,
    reward: "secret",
    tierFloor: "rare",
    label: "One Week",
    blurb: "Seven days straight. Rare or better.",
  },
  {
    days: 14,
    reward: "secret",
    tierFloor: "epic",
    label: "Two Weeks",
    blurb: "A fortnight without missing. Epic or better.",
  },
  {
    days: 30,
    reward: "secret",
    tierFloor: "legendary",
    label: "Thirty Days",
    blurb: "A month of showing up. Legendary or better.",
  },
  {
    days: 100,
    reward: "secret",
    tierFloor: "mythic",
    label: "One Hundred Days",
    blurb: "A hundred days without a gap. The mythic one.",
  },
] as const;

const DAYS = new Set(STREAK_MILESTONES.map((m) => m.days));

export function isStreakMilestone(days: number): boolean {
  return DAYS.has(days);
}

export function streakMilestone(days: number): StreakMilestone | undefined {
  return STREAK_MILESTONES.find((m) => m.days === days);
}

/** The next rung above this streak, or null once they are all behind you. */
export function nextMilestone(streak: number): StreakMilestone | null {
  return STREAK_MILESTONES.find((m) => m.days > streak) ?? null;
}

/**
 * The day before `day`, both as `YYYY-MM-DD` in the league's zone.
 *
 * Built from the digits and done in UTC rather than through `new Date(day)` and a
 * local-time subtraction. Two reasons, and both have bitten date code before: a
 * bare date string parses as UTC midnight while a date-time string parses as
 * local, and subtracting 24h in a zone that observes DST lands on the same
 * calendar day twice a year. UTC has no DST, so this is pure calendar arithmetic
 * — which is exactly what Postgres `opened_on - 1` does to a `date`, a type that
 * carries no zone at all. That is what makes the two agree by construction.
 */
export function previousDay(day: string): string {
  const at = Date.UTC(
    Number(day.slice(0, 4)),
    Number(day.slice(5, 7)) - 1,
    Number(day.slice(8, 10)),
  );
  const d = new Date(at - 86_400_000);
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${d.getUTCFullYear()}-${month}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export type Streak = {
  /** Consecutive days, counting back from the last open. 0 when it is dead. */
  current: number;
  /** First day of the run. This is what a claim is keyed on. */
  startedOn: string | null;
  lastOpenedOn: string | null;
  /** Whether today's pack is already in the run — i.e. whether it is at risk. */
  openedToday: boolean;
};

const DEAD: Streak = { current: 0, startedOn: null, lastOpenedOn: null, openedToday: false };

/**
 * Walk a set of league days into the streak ending today or yesterday.
 *
 * Yesterday still counts, and that asymmetry is the whole feature: a run that
 * ended yesterday is alive but *at risk*, which is what earns the "open to keep
 * it alive" line. A run that ended earlier is gone.
 *
 * Takes the days as they come — unsorted, with duplicates — because the caller is
 * reading rows, and a query whose ORDER BY is load-bearing is one refactor away
 * from being wrong.
 */
export function walkStreak(days: readonly string[], today: string): Streak {
  const seen = new Set(days);
  if (seen.size === 0) return DEAD;

  const yesterday = previousDay(today);
  // Anchor on today when it is there, otherwise yesterday. Anything older means
  // the run has already been broken by a day nobody opened.
  const last = seen.has(today) ? today : seen.has(yesterday) ? yesterday : null;
  if (!last) return DEAD;

  let startedOn = last;
  let current = 1;
  for (let day = previousDay(last); seen.has(day); day = previousDay(day)) {
    startedOn = day;
    current += 1;
  }

  return { current, startedOn, lastOpenedOn: last, openedToday: last === today };
}

/**
 * The line under "Today's Pack".
 *
 * Null at zero rather than "Day 0": a streak nobody has is not a fact worth a
 * line of a phone screen, same rule as packedByLabel.
 */
export function streakLine(streak: Streak): string | null {
  if (streak.current === 0) return null;
  return streak.openedToday
    ? `Day ${streak.current} — streak alive.`
    : `Day ${streak.current} — open today's pack to keep it alive.`;
}

/**
 * "Day 7 pays Rare or better." — the rung above wherever they are standing.
 *
 * The only place the ladder is visible BEFORE you are on it, and the whole reason
 * the floors are worth having: without this line a longer run looks like the same
 * card for more work, which is exactly the read that makes breaking a streak on
 * purpose sensible.
 *
 * Null once every rung is behind them, on the same rule as streakLine: a promise
 * that does not exist is not worth a line of a phone screen.
 */
export function nextMilestoneLine(streak: Streak): string | null {
  const next = nextMilestone(streak.current);
  if (!next) return null;
  return next.tierFloor
    ? `Day ${next.days} pays ${secretTierFloorLabel(next.tierFloor)}.`
    : `Day ${next.days} pays a bonus secret.`;
}
