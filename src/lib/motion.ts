export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * The setting read once, for code that runs inside an event handler. A component
 * that chooses a duration while rendering wants `usePrefersReducedMotion`
 * instead, which also follows the setting changing.
 */
export function prefersReducedMotionNow(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false;
}
