// Who owns the reveal stand, as a state machine.
//
// Lifted out of pack-stand.tsx for the same reason pack-ceremony.ts was lifted
// out of the components: the thing that matters here is an invariant — a roster
// card and the secret must never both own the stage — and an invariant is worth
// far more as a transition function somebody can exhaust in a test than as four
// booleans derived from each other inside a render.
//
// What it replaces, and why. The stand used to hold a `finale` state set from a
// passive effect keyed on `[atSecret, secretSlot, reduced, busy]`, with no latch
// on it. Two things went wrong with that, and both of them put the last roster
// card on screen over the secret:
//
//   1. `finale` lagged the cursor by a commit. `atSecret` is computed in render
//      and `finale` was set in an effect, so on the frame the cursor reached the
//      secret's slot the old value was still there — which made "the secret owns
//      the stage" briefly true, mounted the secret's scrim, swapped the card key
//      and leaked the payoff heading, before the effect took it all back.
//
//   2. `secretSlot` was a dependency, so the fake ending *replayed* every time
//      the slot changed — and it changes while the cursor is parked on it:
//      "pending" to "sealed" when the pull lands, and "sealed" to "open" the
//      moment the card is revealed. Each replay dropped the secret and remounted
//      the last roster card over it for another second.
//
// Both are gone by construction below: the phase is reconciled during render,
// and every event that is not a legal move from the current phase is a no-op.

/** Where the stand is between the last roster card and the secret. */
export type StandPhase =
  /** A roster card is on the stand and owns it. */
  | "roster"
  /** The fake ending. The last roster card is still there; the heading lies. */
  | "packComplete"
  /** The moment the pack stops being over. The roster card is still there. */
  | "glitch"
  /** The roster card is leaving. Nothing of the secret is on screen yet. */
  | "clearing"
  /** The stage is bare. The deliberate beat before the fourth card. */
  | "empty"
  /** The secret owns the stage. */
  | "secret";

/** What can move the stand on. */
export type StandEvent =
  /** The cursor walked back onto a roster card. The only way out of the run. */
  | { type: "leftSecret" }
  /**
   * The cursor walked onto the secret's slot.
   *
   * `pretend` is whether this run has earned the twist: a secret that is
   * genuinely coming, walked to rather than landed on, with neither reduced
   * motion nor the automatic run asking to get through it.
   */
  | { type: "atSecret"; pretend: boolean }
  /** The pack has looked finished for long enough. */
  | { type: "pretenceOver" }
  /** The interruption has played. */
  | { type: "glitchOver" }
  /**
   * The roster card has actually unmounted.
   *
   * Sent by AnimatePresence's `onExitComplete`, and by a fallback timer behind
   * it — see STAND_BEAT.clearing. Idempotent, because both may arrive.
   */
  | { type: "cardExited" }
  /** The bare stage has been bare for long enough. */
  | { type: "beatOver" };

/**
 * The next phase, or the current one.
 *
 * Total, and deliberately so: an event that is not a legal move from `at` is a
 * no-op rather than an error. That is the latch. `atSecret` arriving again from
 * anywhere but `roster` — which is what a `secretSlot` change used to look like
 * — cannot restart anything, and a duplicate `cardExited` from the callback and
 * the fallback timer costs nothing.
 */
export function standPhaseNext(at: StandPhase, ev: StandEvent): StandPhase {
  // Checked ahead of everything else: stepping back onto a roster card resets
  // the run from any phase, including `secret`.
  if (ev.type === "leftSecret") return "roster";

  switch (at) {
    case "roster":
      // Straight to `clearing` without the twist for a run that has not earned
      // it — the automatic run, reduced motion, or a reload that landed on the
      // slot rather than walking to it. They still clear the roster card first;
      // skipping the pretence is not the same as skipping the handover.
      return ev.type === "atSecret" ? (ev.pretend ? "packComplete" : "clearing") : at;
    case "packComplete":
      return ev.type === "pretenceOver" ? "glitch" : at;
    case "glitch":
      return ev.type === "glitchOver" ? "clearing" : at;
    case "clearing":
      return ev.type === "cardExited" ? "empty" : at;
    case "empty":
      return ev.type === "beatOver" ? "secret" : at;
    case "secret":
      return at;
  }
}

/**
 * The one card the stage may be showing.
 *
 * Null is a bare stage, on purpose — it is the whole point of `clearing` and
 * `empty`. The stand renders nothing at all for those two phases, so the roster
 * card is genuinely unmounted rather than hidden under something.
 *
 * This is the function that makes the overlap impossible: there is no phase for
 * which this answers "roster" and `secretOwnsStage` is also true, and the only
 * route from one to the other runs through the two phases where it answers null.
 */
export function stageCard(at: StandPhase): "roster" | "secret" | null {
  switch (at) {
    case "roster":
    case "packComplete":
    case "glitch":
      return "roster";
    case "clearing":
    case "empty":
      return null;
    case "secret":
      return "secret";
  }
}

/** True once the secret is the thing on screen, rather than merely next. */
export function secretOwnsStage(at: StandPhase): boolean {
  return at === "secret";
}

/**
 * How long each phase waits before moving itself on.
 *
 * One table rather than durations scattered through the component, for the same
 * reason CEREMONY is one table: the sequence is a schedule, and a schedule you
 * have to reassemble from four call sites is a schedule nobody re-times.
 */
export const STAND_BEAT = {
  /**
   * How long the pack is allowed to look finished.
   *
   * Long enough to be believed and short enough that nobody has started
   * reaching for the back gesture — at about half a second the eye has read
   * "Pack Complete" and settled, which is exactly the moment worth
   * interrupting.
   */
  packComplete: 620,
  /** The interruption itself: one flicker, and the purple coming up. */
  glitch: 520,
  /**
   * A deadlock breaker, and nothing else.
   *
   * `clearing` ends on AnimatePresence's `onExitComplete` — the card has
   * *actually* unmounted, which is the only honest answer to "has it gone yet",
   * and the only one that cannot let the phase run ahead of what is on screen.
   * This is the floor under that, for a tab backgrounded mid-exit or a callback
   * that never arrives: a stand frozen with no card on it is a worse failure
   * than a beat that ran long.
   *
   * Deliberately far clear of the exit rather than just past it. An earlier
   * draft sat at 420ms, a shade over the exit spring's ~400ms settle, and that
   * was a race the fallback sometimes won — which advanced the phase while the
   * old card was still on screen, so the heading announced the fourth card over
   * the third one. That is the exact bug this file exists to remove,
   * reintroduced from the other end. The exit it is insuring is an authored
   * 260ms tween (`HANDOVER_EXIT_MS`), so this has an order of magnitude of slack
   * and firing at all means something has gone wrong.
   */
  clearing: 2600,
  /**
   * The empty beat.
   *
   * The pause is the point: the pack has just behaved as though it were over,
   * the last card has left, and for a moment there is nothing on the stand at
   * all. It also makes the lifecycle boundary visible — if a roster card were
   * still mounted here, it would be obvious.
   */
  empty: 180,
} as const;

/**
 * The timer this phase should arm, if any.
 *
 * `reduced` collapses the two beats that exist purely to be watched. It does not
 * collapse the transitions themselves: the roster card is still cleared before
 * the secret mounts, because that is correctness rather than choreography.
 */
export function standPhaseTimer(
  at: StandPhase,
  reduced: boolean,
): { ms: number; event: StandEvent } | null {
  switch (at) {
    case "packComplete":
      return { ms: STAND_BEAT.packComplete, event: { type: "pretenceOver" } };
    case "glitch":
      return { ms: STAND_BEAT.glitch, event: { type: "glitchOver" } };
    case "clearing":
      // Not shortened for reduced motion. This is the deadlock breaker, and the
      // card still has to actually unmount before the secret may arrive whatever
      // the preference — `onExitComplete` is what normally ends this phase, and
      // a shorter floor here would race it rather than back it up.
      return { ms: STAND_BEAT.clearing, event: { type: "cardExited" } };
    case "empty":
      return { ms: reduced ? 0 : STAND_BEAT.empty, event: { type: "beatOver" } };
    default:
      return null;
  }
}

/** Every phase, for tests that need to be exhaustive rather than representative. */
export const STAND_PHASES: readonly StandPhase[] = [
  "roster",
  "packComplete",
  "glitch",
  "clearing",
  "empty",
  "secret",
] as const;
