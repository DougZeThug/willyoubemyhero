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
// The walk below is duplicated in `claim_streak_milestone`, deliberately: the
// button is drawn from this one and the payout is authorised by that one, and a
// client that could shift the boundary is a client that can mint milestones. A db
// test pins the two against each other, the way leagueDay() is pinned to the SQL
// it mirrors.

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
  label: string;
  blurb: string;
};

export const STREAK_MILESTONES: readonly StreakMilestone[] = [
  {
    days: 3,
    reward: "secret",
    label: "Three Days",
    blurb: "A bonus secret, on the house.",
  },
  {
    days: 7,
    reward: "secret",
    label: "One Week",
    blurb: "Seven days straight. Another secret.",
  },
  {
    days: 14,
    reward: "secret",
    label: "Two Weeks",
    blurb: "A fortnight without missing. One more secret.",
  },
  {
    days: 30,
    reward: "secret",
    label: "Thirty Days",
    blurb: "A month of showing up. The big one.",
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
