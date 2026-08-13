// The rip, as geometry.
//
// Lifted out of pack-wrapper.tsx for the reason pack-ceremony.ts was lifted out
// of the components: once the tear has a *front* that travels, the clip strings
// stop being three constants and become functions of one number, and a function
// of one number is worth checking with arithmetic rather than with a browser.
//
// What this replaces was a pack that was already two pieces on its first frame.
// `stripClip` and `bodyClip` were computed once from the full-width edge and
// never changed, so nothing propagated: the ragged opening was always there, and
// what animated was a rigid rectangle rotating off the top of it. Everything
// below exists so that the seam is only open to the left of wherever the tear
// has actually got to.

import { seededRng } from "./format";

/** A point on the tear line, in percentages of the pack's own box. */
export type TearPoint = { x: number; y: number };

/** How many segments the ragged line is sampled at. */
const STEPS = 27;

/**
 * How far ahead of the tear front the material is already bending, as a
 * fraction of the pack's width.
 *
 * A tear front is not a step change from "joined" to "parted" — there is a
 * shoulder in front of it where the foil is stretching but has not yet given.
 * Without this the boundary meets the intact seam at a right angle, which reads
 * as a rectangle being revealed rather than as something coming apart.
 */
const RAMP = 0.08;

/** Hermite ease, so the shoulder has no corners at either end. */
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/**
 * The ragged line the wrapper separates along.
 *
 * Seeded, so a given pack always tears the same way — two people opening the
 * same pack side by side should see the same rip, and a re-render mid-ceremony
 * must not re-roll the edge underneath the animation playing over it.
 *
 * 27 steps rather than 16, and two octaves of jitter rather than one. A single
 * amplitude at low resolution reads as a zigzag; the coarse wander gives the rip
 * its shape and the fine one gives it fibre.
 */
export function tearEdge(seed: string, stripPct: number): TearPoint[] {
  const rng = seededRng(seed);
  const points: TearPoint[] = [];
  for (let i = 0; i <= STEPS; i++) {
    points.push({
      x: (i / STEPS) * 100,
      // Kept off the very top edge, or a deep jitter clips the strip away to
      // nothing at that column and the tear reads as a hole rather than a rip.
      y: Math.max(1.5, stripPct + (rng() - 0.5) * 4.5 + (rng() - 0.5) * 1.6),
    });
  }
  return points;
}

/**
 * How far apart the seam has come at column `x`, 0 (intact) to 1 (fully parted).
 *
 * The front is quoted over `1 + RAMP` rather than over 1, so that at `f = 1` the
 * shoulder has passed the right-hand edge and the whole line is open. Quoted
 * over 1 the last column would still be mid-shoulder at full travel, and the rip
 * would finish with a few pixels of wrapper still attached at the far corner.
 */
export function seamOpen(x: number, f: number): number {
  return smooth(clamp01((f * (1 + RAMP) - x / 100) / RAMP));
}

/** Where the boundary between body and strip sits at this column, right now. */
export function seamY(p: TearPoint, f: number): number {
  return p.y * seamOpen(p.x, f);
}

const fmt = (p: TearPoint) => `${p.x.toFixed(1)}% ${p.y.toFixed(1)}%`;
const at = (p: TearPoint, f: number) => `${p.x.toFixed(1)}% ${seamY(p, f).toFixed(1)}%`;

/**
 * Everything below the tear — the pack, which stays.
 *
 * At `f = 0` every boundary point is at the very top of the box, so this is the
 * whole pack: one continuous image, with the strip layer above it contributing
 * nothing. That is the artwork-continuity guarantee, and it is a property of the
 * geometry rather than of two clip strings being kept in step by hand.
 */
export function bodyClipAt(points: TearPoint[], f: number): string {
  return `polygon(${points.map((p) => at(p, f)).join(", ")}, 100% 100%, 0% 100%)`;
}

/** Everything above it — the piece that peels away. Zero area at `f = 0`. */
export function stripClipAt(points: TearPoint[], f: number): string {
  const line = [...points].reverse().map((p) => at(p, f));
  return `polygon(0% 0%, 100% 0%, ${line.join(", ")})`;
}

/**
 * One segment of the strip: the slice of the tear line between two columns.
 *
 * Adjacent segments share their boundary vertices, so while they are still
 * together there is no seam to see — they separate only because they move apart,
 * which is what makes the break look like a break rather than a reveal of four
 * pieces that were always there.
 */
export function segmentClipAt(points: TearPoint[], f: number, from: number, to: number): string {
  const span = points.slice(from, to + 1);
  const a = span[0].x;
  const b = span[span.length - 1].x;
  const line = [...span].reverse().map((p) => at(p, f));
  return `polygon(${a.toFixed(1)}% 0%, ${b.toFixed(1)}% 0%, ${line.join(", ")})`;
}

/**
 * The exposed fibre along the rip.
 *
 * A thin band that follows the boundary, drawn between the body and the strip so
 * it is only visible once the strip has moved off it. Torn card stock shows a
 * bright core where the printed surface has parted, and it is the one detail
 * that separates "torn" from "cut" — without it the ragged polygon still reads
 * as a very carefully cut edge.
 */
export function coreClipAt(points: TearPoint[], f: number, thickness = 1.4): string {
  const over = points.map((p) => at(p, f));
  const under = [...points]
    .reverse()
    .map((p) => `${p.x.toFixed(1)}% ${(seamY(p, f) + thickness).toFixed(1)}%`);
  return `polygon(${over.join(", ")}, ${under.join(", ")})`;
}

/**
 * The opening, as a clip for whatever is coming out of it.
 *
 * The same ragged line the pack tore along, so a card on its way out is cut by
 * the tear itself rather than by a tidy horizontal edge. `open` slides that line
 * down and off the bottom, which is what lets the cards finish emerging without
 * the clip popping off in one frame.
 *
 * The vertex count is constant across every value of `open` — that is the whole
 * reason this is one function rather than two clip strings, because motion can
 * only interpolate two polygons that agree on how many corners they have.
 *
 * Left and right run well past the pack so the fan can spread outside it once
 * the clip is open; only the top edge is ever doing any work. Quoted against the
 * finished tear line rather than against a front, because by the time anything
 * is coming out the pack is open.
 */
export function mouthClip(points: TearPoint[], open: number): string {
  const drop = open * 150;
  const shifted = (p: TearPoint) => `${p.x.toFixed(1)}% ${(p.y + drop).toFixed(1)}%`;
  const line = [...points].reverse().map(shifted);
  const right = `150% ${(points[points.length - 1].y + drop).toFixed(1)}%`;
  const left = `-50% ${(points[0].y + drop).toFixed(1)}%`;
  return `polygon(-50% -120%, 150% -120%, ${right}, ${line.join(", ")}, ${left})`;
}

/**
 * The waypoints the front travels through once the rip commits.
 *
 * Shaping, not easing: a third of the remaining travel in the first 45% of the
 * time, then it goes. Material under tension does not tear at a constant rate —
 * it resists, then runs — and a plain curve is the difference between a rip and
 * a wipe.
 *
 * Every waypoint is a fraction of what is *left* rather than an absolute
 * position, and that is load-bearing rather than tidy. A fast swipe crosses the
 * 60% commit threshold inside a single pointermove and can commit anywhere up
 * to 100%, so a fixed waypoint behind where the finger got would send the tear
 * backwards: the wrapper visibly rejoins and the pieces settle again before it
 * reopens. Quoted off `start`, this is non-decreasing for every commit point.
 */
export function ripWaypoints(start: number): number[] {
  const from = clamp01(start);
  const left = 1 - from;
  return [from, from + left * 0.35, from + left * 0.74, 1];
}

/** Where those waypoints fall across the phase, as fractions of its length. */
export const RIP_TIMES = [0, 0.45, 0.74, 1] as const;

/**
 * Where the strip breaks, as point indices into the edge.
 *
 * Four pieces rather than three, because four is the fewest that gives the strip
 * a *middle* to bend around rather than just two ends that disagree. Deliberately
 * unequal: foil does not come off in equal thirds, and four identical pieces read
 * as a grid.
 */
export const TEAR_SEGMENTS: readonly (readonly [number, number])[] = [
  [0, 7],
  [7, 14],
  [14, 20],
  [20, STEPS],
] as const;

/**
 * How far segment `k` has let go, 0..1, for a tear front at `f`.
 *
 * Starts when the front reaches the segment's left edge and finishes a shoulder
 * past its right one, so the strip peels *behind* the tear instead of the whole
 * top lifting at once. That lag is most of what makes the material read as
 * flexible: at any moment part of it is free and part is still held down.
 */
export function segmentLift(f: number, k: number): number {
  const [from, to] = TEAR_SEGMENTS[k];
  const left = from / STEPS;
  const right = to / STEPS;
  return smooth(clamp01((f * (1 + RAMP) - left) / (right - left + RAMP)));
}

/**
 * How one segment deforms as it lets go.
 *
 * Authored, not simulated, and seeded off the pack so it is the same rip every
 * time — the rule the edge and the card jitter both follow. The point is that
 * the four pieces *disagree*: a strip whose every part curls by the same amount
 * about the same origin is a rigid panel with extra steps.
 */
export type SegmentPose = {
  /** Degrees of rotateX about the segment's own bottom edge — the torn edge curling back. */
  curl: number;
  /** Degrees of rotateZ. Grows left to right, so the two ends do not agree. */
  lean: number;
  /** Extra pixels of lift, so one part of the strip trails the rest. */
  lag: number;
  /** Horizontal squeeze at full lift. Alternates sign, which is what bends the middle. */
  squeeze: number;
};

export function segmentPose(seed: string, k: number): SegmentPose {
  const rng = seededRng(`${seed}:tear:${k}`);
  const n = TEAR_SEGMENTS.length;
  // Normalised position across the strip, 0 at the left end.
  const u = n > 1 ? k / (n - 1) : 0;
  return {
    // The far end has been under tension longest by the time it goes, so it
    // curls hardest. ±15% of wobble on top, or four segments fan out too neatly.
    curl: (18 + u * 12) * (0.85 + rng() * 0.3),
    // Left end lifts, right end is still anchored: the shape a wrapper takes
    // when it is ripped left to right.
    lean: -(6 + u * 16) * (0.85 + rng() * 0.3),
    lag: rng() * 7,
    // Alternating, so segment 0 stretches while 1 compresses. Reads as a bend
    // through the middle rather than as the whole strip breathing.
    squeeze: 1 + (k % 2 === 0 ? 1 : -1) * (0.02 + rng() * 0.018),
  };
}

/**
 * Where each segment ends up once it is off.
 *
 * Not four equal arcs: real foil comes off in pieces that disagree with each
 * other, and four tidy parallel flights read as an animation rather than as
 * something coming apart.
 *
 * `sec`, not ms — motion's own unit for a duration, and mixing the two here is a
 * thousandfold mistake that looks like a frozen animation.
 *
 * Sized against `peel` plus the phase after it: the pieces are allowed to still
 * be tumbling once the cards have started to rise, because foil coming off a
 * pack does not politely finish before the contents move. What they must not do
 * is outlive the fan — a shard still in the air behind a spread hand of cards
 * reads as a stray element rather than as debris.
 */
export const SEGMENT_FLIGHT = [
  { x: -78, y: -196, rz: -34, rx: 52, sec: 0.44 },
  { x: -18, y: -232, rz: -12, rx: 44, sec: 0.47 },
  { x: 34, y: -238, rz: 22, rx: 38, sec: 0.48 },
  { x: 98, y: -176, rz: 48, rx: 64, sec: 0.4 },
] as const;
