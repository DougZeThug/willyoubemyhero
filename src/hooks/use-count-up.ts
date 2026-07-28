import { useEffect, useRef, useState } from "react";

/**
 * Ease a number up from zero whenever the target changes.
 *
 * Used by the player page's stat tiles so a time and a rank roll into place
 * rather than snapping. Returns the target verbatim under reduced motion, and
 * for null — there is nothing to count up to on a player who hasn't run yet.
 */
export function useCountUp(target: number | null, durationMs = 600): number | null {
  const [value, setValue] = useState<number | null>(target);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (target == null) {
      setValue(null);
      return;
    }
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduced || durationMs <= 0) {
      setValue(target);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutCubic — fast off the line, settles onto the real number.
      setValue(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frameRef.current = requestAnimationFrame(tick);
      else {
        frameRef.current = null;
        // Land exactly on the target; the easing only ever approaches it.
        setValue(target);
      }
    };
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [target, durationMs]);

  return value;
}
