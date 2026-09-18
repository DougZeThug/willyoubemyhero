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
/**
 * What a refused start says, shared because two sides have to agree on it.
 *
 * setParticipantStatus throws this, and useRunConsole has to tell it apart from
 * a network failure: a blip must leave the local timer running, and a refusal
 * must take it away.
 */
export const OUT_OF_FIELD_MESSAGE = "That athlete is out of the field.";

/**
 * The other sentence a refused start can carry: the roster row it aimed at is
 * gone, so the server never found an athlete to put on the clock.
 *
 * It lives here rather than beside `assertInEvent`, which builds it for every
 * table it guards, so the server's wording and the client's test of it cannot
 * drift. admin-write.functions.ts already imports this file; the reverse would
 * be a cycle.
 */
export function notInEventMessage(what: string): string {
  return `That ${what} is not part of this event.`;
}

/** What the console says for that one, matching startRun's own pre-flight. */
export const OFF_ROSTER_MESSAGE = "That athlete is no longer on the roster.";

/**
 * A start the server REFUSED, as opposed to one the network dropped. Returns the
 * sentence to show, or null when it was the network.
 *
 * Both refusals are permanent, and that is why they share a branch: the athlete
 * is out of the field, or their roster row has been deleted. Either way the
 * local timer has to come down, because finishing a run the server would not
 * start goes through saveCompletedRun -- which either writes the athlete back to
 * "finished" and undoes a scratch by another door, or writes an official run
 * with no roster row behind it for standings() to rank.
 */
export function refusedStart(message: string): string | null {
  if (message.includes(OUT_OF_FIELD_MESSAGE)) return OUT_OF_FIELD_MESSAGE;
  if (message.includes(notInEventMessage("athlete"))) return OFF_ROSTER_MESSAGE;
  return null;
}

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
 * Roster status only, which is all a QueueEntry carries. That makes this a
 * headcount of who is nominally in — what /admin's "N in · M out" wants — and
 * NOT the denominator for a done tally: a run marked dq puts somebody out of
 * contention without touching their roster row, and this cannot see it. /live
 * takes both halves of its fraction from outOfContention for that reason.
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
