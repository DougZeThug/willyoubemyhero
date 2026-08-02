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

/** Where the ceremony is. Each one owns a slice of the timeline below. */
export type CeremonyPhase =
  /** The rip finishes travelling on its own, from wherever the finger stopped. */
  | "rip"
  /** The strip breaks into shards and tumbles away. */
  | "peel"
  /** The pack is open and lit, with nothing out of it yet. */
  | "mouth"
  /** Cards rise out of the mouth, still stacked. */
  | "launch"
  /** They spread into an arc hovering in front of the viewer. */
  | "fan"
  /** A beat where nothing moves, so the fan can actually be looked at. */
  | "hold"
  /** They square up into a deck on the stand's mark. */
  | "collapse"
  /** Off the end — the stand owns the screen now. */
  | "done";

/**
 * The timeline.
 *
 * Tuned for a phone held at arm's length, which is the only place this is ever
 * seen. The two long phases are the ones carrying information — the strip coming
 * off, and the fan spreading — and the two short ones (`mouth`, `hold`) are
 * pauses that stop those reading as one continuous slide.
 *
 * The total is a shade over two seconds because that is about how long somebody
 * will happily watch an animation they did not ask to watch a second time, and
 * this one plays every day.
 */
export const CEREMONY: readonly { readonly phase: CeremonyPhase; readonly ms: number }[] = [
  { phase: "rip", ms: 300 },
  { phase: "peel", ms: 420 },
  { phase: "mouth", ms: 200 },
  { phase: "launch", ms: 340 },
  { phase: "fan", ms: 460 },
  { phase: "hold", ms: 180 },
  // Long enough for the gather to actually finish. The deck spring takes about
  // 300ms to settle, and a collapse shorter than that hands PackStand a deck that
  // is still moving — which is a jump on the one frame both are on screen.
  { phase: "collapse", ms: 340 },
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
const FAN_SPREAD = 104;
const FAN_TILT = 18;

/**
 * Where card `i` of `n` sits as it clears the mouth — out of the pack, but still
 * a stack.
 *
 * Two stages rather than one long spring from inside the pack to the spread fan:
 * cards that come *out* and then *open* read as a pack being emptied, where a
 * single move reads as a fan that happened to start small.
 */
export function riseTransform(
  i: number,
  n: number,
): { x: number; y: number; rotate: number; z: number } {
  // Card 0 is the front of the stack, at zero offset, with the rest behind it —
  // the same order `layer()` paints them in. Counted the other way round, the card
  // drawn on top is the one furthest off the mark, which only stays invisible for
  // as long as the offsets stay small. `n` is unused and kept for symmetry with
  // the other two, which need it.
  const depth = i;
  return { x: depth * 2, y: -104 + depth * 5, rotate: depth * 1.2, z: 60 - depth * 8 };
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
export function fanTransform(
  i: number,
  n: number,
): { x: number; y: number; rotate: number; z: number } {
  const t = i - (n - 1) / 2;
  // Normalised -1..1 across the fan, for the arc. Guarded at n = 1, where every
  // card is the middle one.
  const u = n > 1 ? (2 * t) / (n - 1) : 0;
  // Per-slot step, sized so the fan spans the same width whatever it is holding.
  // A fixed step is fine at three and pushes a four-card fan — the pack plus its
  // secret — past the edges of a phone, where `overflow-x: hidden` silently eats
  // the outer cards. Capped rather than purely divided, so two cards sit close
  // together instead of stretching to fill a width they do not need.
  const step = n > 1 ? Math.min(58, FAN_SPREAD / (n - 1)) : 0;
  const tilt = n > 1 ? Math.min(9, FAN_TILT / (n - 1)) : 0;
  return {
    x: t * step,
    // Up out of the pack, plus an arc that lifts the middle — the shape a hand of
    // cards makes, and the thing that stops this reading as a row.
    y: -148 - (1 - u * u) * 22,
    rotate: t * tilt,
    // The outer cards sit further back, so the fan has depth rather than being a
    // flat plane that happens to be rotated.
    z: 96 - Math.abs(u) * 24,
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
export function deckTransform(
  i: number,
  n: number,
): { x: number; y: number; rotate: number; z: number } {
  // Card 0 lands *on* the mark, because it is the card PackStand mounts with a
  // beat later and any offset it still carries is a jump at the handoff. The rest
  // stack behind it. This used to count from the back, which put the one card
  // that had to be exact at the far end of the stagger.
  const depth = i;
  return { x: depth * 1.6, y: -38 + depth * 4, rotate: depth * 1.1, z: depth * -5 };
}
