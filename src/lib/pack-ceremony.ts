// The pack-opening ceremony, as data.
//
// Lifted out of the components for the same reason pack.ts was lifted out of the
// route: a sequence built from seven scattered setTimeouts is impossible to
// reason about and impossible to test. Here the phases are a table, "where are we
// at t ms" is a pure function, and the flight geometry is arithmetic somebody can
// check without a browser.
//
// Why the ceremony exists at all: the tear used to commit at 60% of the drag and
// unmount the wrapper on that same frame, so the strip never travelled the rest
// of the width and never came off. What the user saw was a crease. Everything
// below is the rest of that rip, plus the cards actually leaving the pack.

import { seededRng } from "./format";

/** Where the ceremony is. Each one owns a slice of the timeline below. */
export type CeremonyPhase =
  /** The pack takes the strain: a squash, before anything comes apart. */
  | "anticipate"
  /** The seam lights up and builds. The tear line is under tension, not yet open. */
  | "seam"
  /** The rip finishes travelling on its own, from wherever the finger stopped. */
  | "rip"
  /** The strip breaks into shards and tumbles away, and light escapes the mouth. */
  | "peel"
  /** Cards rise out of the mouth, still stacked. */
  | "launch"
  /** They spread into an arc hovering in front of the viewer. */
  | "fan"
  /** A beat where nothing moves, so the fan can actually be looked at. */
  | "hold"
  /** They square up into a deck on the stand's mark. */
  | "handoff"
  /** Off the end — the stand owns the screen now. */
  | "done";

/**
 * The timeline.
 *
 * Tuned for a phone held at arm's length, which is the only place this is ever
 * seen. Every phase carries something that is *changing* — that is the rule this
 * table is built on, and it is why it is half the length it used to be.
 *
 * The previous table ran 4.3s and was written the other way round: it had been
 * lengthened from two seconds because the short cut "read as a flicker". That
 * diagnosis was right about the symptom and wrong about the cause. The problem
 * was never that two seconds is too short to watch; it was that the sequence had
 * two phases in it — a 360ms `mouth` and a 560ms `hold` — where nothing evolved,
 * so the eye had nothing to follow and the whole thing read as a slideshow being
 * clicked through. Give every phase something to do and the same two seconds is
 * dense rather than hurried.
 *
 * `mouth` is gone outright: the pack being open and lit with nothing coming out
 * of it is a held frame by definition. Its work is now the tail of `peel`, where
 * the light escaping the tear is the thing being looked at. `hold` survives at
 * 200ms, because the fan does need one beat to be seen as a fan — but a beat, not
 * a pause.
 *
 * Skip is always on screen for anyone who has seen it enough times.
 */
export const CEREMONY: readonly { readonly phase: CeremonyPhase; readonly ms: number }[] = [
  // Retuned once more after watching it on a phone: at 2.05s the rip, the shards
  // and the fan all happened, and none of them registered — the sequence was
  // right and simply gone before the eye caught up. The extra ~750ms goes only
  // into the phases that are visibly evolving (peel, launch, fan), plus one beat
  // on the fan hold; the dead-ish head of the sequence is left short on purpose.
  { phase: "anticipate", ms: 150 },
  { phase: "seam", ms: 220 },
  { phase: "rip", ms: 260 },
  { phase: "peel", ms: 420 },
  { phase: "launch", ms: 480 },
  { phase: "fan", ms: 600 },
  { phase: "hold", ms: 320 },
  // Long enough for the gather to actually finish, and no longer. The deck spring
  // settles in about 260ms, and a handoff shorter than that hands PackStand a
  // deck that is still moving — which is a jump on the one frame both are on
  // screen, and the whole reason this phase has a name.
  { phase: "handoff", ms: 300 },
] as const;

/** Total run time. Derived, so the table stays the single source of truth. */
export const CEREMONY_MS = CEREMONY.reduce((total, step) => total + step.ms, 0);

/** When each phase starts, measured from the moment the rip committed. */
export const CEREMONY_START: Readonly<Record<CeremonyPhase, number>> = (() => {
  const starts: Partial<Record<CeremonyPhase, number>> = {};
  let at = 0;
  for (const step of CEREMONY) {
    starts[step.phase] = at;
    at += step.ms;
  }
  starts.done = at;
  return starts as Record<CeremonyPhase, number>;
})();

/**
 * Which phase the ceremony is in `ms` after it committed.
 *
 * Total on purpose — a clock that has not started answers "rip" rather than
 * throwing, and anything past the end answers "done".
 */
export function ceremonyPhaseAt(ms: number): CeremonyPhase {
  if (!(ms > 0)) return CEREMONY[0].phase;
  let at = 0;
  for (const step of CEREMONY) {
    at += step.ms;
    if (ms < at) return step.phase;
  }
  return "done";
}

/** True once `phase` has started, so a component can ask "have we got there yet". */
export function ceremonyReached(phase: CeremonyPhase, at: CeremonyPhase): boolean {
  return CEREMONY_START[at] >= CEREMONY_START[phase];
}

/**
 * The pack width every offset below is quoted against, in px.
 *
 * `max-w-xs`, which is what the pack renders at on anything but a very narrow
 * phone. The component measures the real width and scales by the ratio, so a
 * narrower pack shrinks its fan with it rather than letting it push the page
 * sideways — `html, body` carry `overflow-x: hidden`, so a card that escapes the
 * viewport is silently clipped rather than scrollable, which reads on screen as a
 * card that simply vanished.
 */
export const CEREMONY_BASIS = 320;

/**
 * How wide the fan spreads, and how much it tilts across that spread, in total.
 *
 * Totals rather than per-card steps, because the pack holds three cards on most
 * days and four on a day with a secret in it, and a fan that grew with the count
 * would run off the sides of a phone on exactly the days worth watching.
 */
// Widened after the fan turned out to read as a stack rather than a hand: at 104
// across a 198px card the neighbours overlapped by three quarters and the spread
// was invisible. 132 leaves the outer edge ~145px off centre against a 160px pack
// half-width, so it still lands inside the pack's own column — which matters,
// since `overflow-x: hidden` clips an escaped card rather than scrolling to it.
const FAN_SPREAD = 132;
const FAN_TILT = 24;

/**
 * How much smaller each card is than the one in front of it, in a stack.
 *
 * Only ever applied to `depth`, never across the fan — a fan is a row of cards
 * held at the same distance and they are all the same size in it. This is the
 * difference between a stack of cards and one thick card, which the perspective
 * alone does not carry at these depths.
 */
const DEPTH_SHRINK = 0.015;

/**
 * Where a card is, and how big.
 *
 * `scale` is here rather than left to the component because it is depth, and
 * depth is geometry. Everything on it is deterministic and symmetric — the seeded
 * per-card jitter that stops the fan looking machined lives in pack-opening.tsx,
 * on top of this, precisely so that this stays checkable arithmetic.
 */
export type CardPose = { x: number; y: number; rotate: number; z: number; scale: number };

/** How far a card may sit off the geometry's own angle, in degrees either way. */
const JITTER_DEG = 2;

/**
 * The per-card variation that stops the fan looking machined.
 *
 * Deliberately *not* part of the three pose functions below, and the distinction
 * is load-bearing. Those are symmetric, exact, and tested for both — an
 * asymmetric fan *shape* reads as a bug. This is the untidiness laid on top: an
 * asymmetric *card* reads as a hand somebody is holding. Folding one into the
 * other would make the pose tests fail intermittently, which is a miserable thing
 * to debug.
 *
 * Seeded off the pack for the same reason the tear edge is: a given pack always
 * opens the same way, so two people opening the same pack side by side see the
 * same thing, and a re-render mid-flight cannot re-roll a card's angle underneath
 * it.
 */
export type CardJitter = {
  /** Degrees off the pose's own angle. */
  rotate: number;
  /** Multipliers on the spring, so the cards do not arrive in lockstep. */
  stiffness: number;
  damping: number;
  /** How far and how slowly this card breathes while the fan is being looked at. */
  breath: number;
};

export function packJitter(seed: string, count: number): CardJitter[] {
  const rng = seededRng(seed);
  return Array.from({ length: count }, () => ({
    rotate: (rng() * 2 - 1) * JITTER_DEG,
    // ±10%, small enough that no card misses the end of its own phase.
    stiffness: 1 + (rng() * 2 - 1) * 0.1,
    damping: 1 + (rng() * 2 - 1) * 0.1,
    breath: 0.7 + rng() * 0.6,
  }));
}

/**
 * Where card `i` of `n` sits as it clears the mouth — out of the pack, but still
 * a stack.
 *
 * Two stages rather than one long spring from inside the pack to the spread fan:
 * cards that come *out* and then *open* read as a pack being emptied, where a
 * single move reads as a fan that happened to start small.
 */
export function riseTransform(i: number, n: number): CardPose {
  // Card 0 is the front of the stack, at zero offset, with the rest behind it —
  // the same order `layer()` paints them in. Counted the other way round, the card
  // drawn on top is the one furthest off the mark, which only stays invisible for
  // as long as the offsets stay small. `n` is unused and kept for symmetry with
  // the other two, which need it.
  const depth = i;
  return {
    x: depth * 2,
    y: -104 + depth * 5,
    rotate: depth * 1.2,
    z: 60 - depth * 8,
    // Card 0 is exactly its nominal size and everything behind it is smaller. The
    // perspective already shrinks them a little for being further back; this is
    // the rest of the separation, and without it a stack coming out of the pack
    // reads as one thick card.
    scale: 1 - depth * DEPTH_SHRINK,
  };
}

/**
 * Where card `i` of `n` hovers in the fan, in the pack's own coordinate space.
 *
 * The origin is the middle of the tear line, which is where the cards come out.
 * `z` is toward the viewer — the whole point of the phase is that the cards hover
 * in *front* of the pack rather than beside it, and that only reads with real
 * perspective.
 *
 * `t` is the card's signed distance from the centre of the fan, in card slots. A
 * single card gets t = 0 and sits dead centre rather than dividing by zero.
 */
export function fanTransform(i: number, n: number): CardPose {
  const t = i - (n - 1) / 2;
  // Normalised -1..1 across the fan, for the arc. Guarded at n = 1, where every
  // card is the middle one.
  const u = n > 1 ? (2 * t) / (n - 1) : 0;
  // Per-slot step, sized so the fan spans the same width whatever it is holding.
  // A fixed step is fine at three and pushes a four-card fan — the pack plus its
  // secret — past the edges of a phone, where `overflow-x: hidden` silently eats
  // the outer cards. Capped rather than purely divided, so two cards sit close
  // together instead of stretching to fill a width they do not need.
  const step = n > 1 ? Math.min(66, FAN_SPREAD / (n - 1)) : 0;
  const tilt = n > 1 ? Math.min(12, FAN_TILT / (n - 1)) : 0;
  return {
    x: t * step,
    // Up out of the pack, plus an arc that lifts the middle — the shape a hand of
    // cards makes, and the thing that stops this reading as a row.
    y: -148 - (1 - u * u) * 22,
    rotate: t * tilt,
    // The outer cards sit further back, so the fan has depth rather than being a
    // flat plane that happens to be rotated.
    z: 96 - Math.abs(u) * 24,
    // Uniform across the fan, and deliberately so. These cards are held out at
    // the same distance from the viewer; the `z` above already renders the outer
    // ones fractionally smaller for being further back, which is the only size
    // difference a real hand of cards has. Anything else here would also break
    // the mirror symmetry this function is tested for.
    scale: 1,
  };
}

/**
 * Where card `i` sits once the fan has squared up into a deck.
 *
 * It settles *down* toward the middle of the pack rather than staying where it
 * hovered: the stand mounts with its card near the centre of the same column, and
 * a deck that gathered high would hand over with a visible jump.
 *
 * Not exactly zero for every card either — a stack of three with no offset at all
 * is indistinguishable from one card, and the deck has to still read as a pack's
 * worth at the moment the stand takes over.
 */
export function deckTransform(i: number, n: number): CardPose {
  // Card 0 lands *on* the mark, because it is the card PackStand mounts with a
  // beat later and any offset it still carries is a jump at the handoff. The rest
  // stack behind it. This used to count from the back, which put the one card
  // that had to be exact at the far end of the stagger.
  const depth = i;
  return {
    // Wider than the 1.6/4 this used to gather to. A deck whose cards are two
    // pixels apart is a deck you have to be told is a deck; at four across and
    // six down each edge is separately visible on a phone, which is the whole
    // point of gathering into one rather than simply stopping.
    x: depth * 4,
    y: -38 + depth * 6,
    rotate: depth * 1.1,
    z: depth * -5,
    scale: 1 - depth * DEPTH_SHRINK,
  };
}
