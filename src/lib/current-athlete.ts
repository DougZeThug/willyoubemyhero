/**
 * Who the crowd screens should be looking at.
 *
 * An admin putting someone on the clock always wins — that is a deliberate
 * "this person is stepping up now" action. With nobody on the clock we fall
 * back to the running order rather than showing STANDBY, so a freshly
 * randomized order immediately puts its new #1 on the Live page.
 */
import { OUT_OF_CONTENTION_STATUSES } from "./standings";

export type QueueEntry = {
  running_order: number;
  participation_status: string | null;
};

export type AthleteSlot<T> = { athlete: T | null; onClock: boolean };

/**
 * Nobody left to wait for. "finished" plus the whole out-of-contention family —
 * a scratched athlete was already here, but a dq, dnp or absent one was not, so
 * they sat in the Up Next slot indefinitely with the queue stuck behind them.
 */
const DONE = new Set(["finished", ...OUT_OF_CONTENTION_STATUSES]);

/**
 * Still waiting for a turn — the other half of the same rule `currentAthlete`
 * places somebody by.
 *
 * Exported because the timing controls had their own copy of it, and a narrower
 * one: "not finished and not scratched" left a dq, dnp or absent athlete at the
 * head of the queue the Start card was pointing at, while this file had already
 * skipped them for the slot beside it. One predicate, so the athlete a screen
 * shows and the athlete its button starts cannot be two different people.
 */
export function awaitingRun(entry: Pick<QueueEntry, "participation_status">): boolean {
  return !DONE.has(entry.participation_status ?? "queued");
}

export function currentAthlete<T extends QueueEntry>(entries: readonly T[]): AthleteSlot<T> {
  const onClock = entries.find((e) => e.participation_status === "running");
  if (onClock) return { athlete: onClock, onClock: true };
  const queued = entries
    .filter((e) => !DONE.has(e.participation_status ?? "queued"))
    .sort((a, b) => a.running_order - b.running_order);
  return { athlete: queued[0] ?? null, onClock: false };
}

/**
 * Athletes that count toward the "x/y done" tally.
 *
 * Anybody out of contention is out of the denominator too: they are never going
 * to finish, so counting them holds the screen at "12 of 13" forever. The
 * numerator counts distinct athletes, not official runs — see /live.
 */
export function fieldSize(entries: readonly QueueEntry[]): number {
  return entries.filter((e) => !OUT_OF_CONTENTION_STATUSES.has(e.participation_status ?? ""))
    .length;
}

/**
 * Why nobody is on the clock, for the screens that have to say something.
 *
 * "Everyone is done" is only true when there was a field to finish. An empty
 * roster reads the same whether the fetch has not landed yet, the read failed,
 * or the commissioner has not set the field — and /live used to congratulate
 * all three.
 */
export type IdleField = "roster-failed" | "no-roster" | "all-done" | "waiting";

export function idleFieldState(done: number, total: number, rosterFailed: boolean): IdleField {
  if (rosterFailed) return "roster-failed";
  if (total === 0) return "no-roster";
  return done >= total ? "all-done" : "waiting";
}
