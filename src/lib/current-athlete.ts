/**
 * Who the crowd screens should be looking at.
 *
 * An admin putting someone on the clock always wins — that is a deliberate
 * "this person is stepping up now" action. With nobody on the clock we fall
 * back to the running order rather than showing STANDBY, so a freshly
 * randomized order immediately puts its new #1 on the Live page.
 */
export type QueueEntry = {
  running_order: number;
  participation_status: string | null;
};

export type AthleteSlot<T> = { athlete: T | null; onClock: boolean };

const DONE = new Set(["finished", "scratched"]);

export function currentAthlete<T extends QueueEntry>(entries: readonly T[]): AthleteSlot<T> {
  const onClock = entries.find((e) => e.participation_status === "running");
  if (onClock) return { athlete: onClock, onClock: true };
  const queued = entries
    .filter((e) => !DONE.has(e.participation_status ?? "queued"))
    .sort((a, b) => a.running_order - b.running_order);
  return { athlete: queued[0] ?? null, onClock: false };
}

/** Athletes that count toward the "x/y done" tally — scratched people don't. */
export function fieldSize(entries: readonly QueueEntry[]): number {
  return entries.filter((e) => e.participation_status !== "scratched").length;
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
