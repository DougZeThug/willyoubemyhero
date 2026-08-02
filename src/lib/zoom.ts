/**
 * Zoom and pan arithmetic for a single card under a finger.
 *
 * Pure functions, kept out of the hook so the parts that are easy to get wrong —
 * delta normalisation, the cursor anchor, the pan clamp — can be tested without a
 * DOM and a synthetic gesture behind them.
 */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
/** Where a double tap lands. Enough to read a stat panel, not so far you lose the card. */
export const DOUBLE_TAP_ZOOM = 2.4;

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };

export const clampZoom = (z: number, min = MIN_ZOOM, max = MAX_ZOOM) =>
  z < min ? min : z > max ? max : z;

/**
 * Wheel deltas arrive in three units. Firefox reports lines and some setups
 * report pages, so a raw deltaY means something different per browser.
 */
export function normalizeWheelDelta(deltaY: number, deltaMode: number): number {
  return deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 100 : 1);
}

/**
 * Multiplicative zoom scaled by how far the wheel actually travelled. A fixed
 * factor per event compounds across the dozens of events one trackpad flick
 * fires and slams straight into the clamp.
 */
export function zoomFromWheel(zoom: number, normalizedDeltaY: number, intensity = 0.0015) {
  return clampZoom(zoom * Math.exp(-normalizedDeltaY * intensity));
}

/**
 * Keep the content under `point` (frame-local px) stationary while the scale
 * changes. Assumes `translate(offset) scale(zoom)` about a 0 0 origin.
 */
export function anchorOffset(offset: Point, point: Point, zoom: number, next: number): Point {
  const k = next / zoom;
  return {
    x: point.x - (point.x - offset.x) * k,
    y: point.y - (point.y - offset.y) * k,
  };
}

/** Never let the frame show empty space beside the card. */
export function clampOffset(offset: Point, zoom: number, size: Size): Point {
  const minX = Math.min(0, size.width * (1 - zoom));
  const minY = Math.min(0, size.height * (1 - zoom));
  return {
    x: offset.x > 0 ? 0 : offset.x < minX ? minX : offset.x,
    y: offset.y > 0 ? 0 : offset.y < minY ? minY : offset.y,
  };
}

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export const midpoint = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

/** Wraps, so the last card's "next" is the first one. */
export function stepIndex(index: number, length: number, dir: 1 | -1): number {
  if (length <= 0) return 0;
  return (index + dir + length) % length;
}

/** What counts as a swipe rather than a tap or a lean. */
export const SWIPE = {
  /** Minimum horizontal travel in px. */
  dist: 48,
  /** Horizontal must beat vertical by this much, so a scroll is never a swipe. */
  bias: 1.4,
  /** Slower than this and it was a drag that happened to end off to one side. */
  ms: 700,
} as const;

export function swipeDirection(dx: number, dy: number, ms: number): -1 | 1 | 0 {
  if (ms > SWIPE.ms) return 0;
  if (Math.abs(dx) < SWIPE.dist) return 0;
  if (Math.abs(dx) < Math.abs(dy) * SWIPE.bias) return 0;
  return dx < 0 ? 1 : -1;
}