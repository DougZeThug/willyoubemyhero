import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";

/**
 * Ease a number up from zero whenever the target changes.
 *
 * Used by the player page's stat tiles so a time and a rank roll into place
 * rather than snapping. Returns the target verbatim under reduced motion, and
 * for null — there is nothing to count up to on a player who hasn't run yet.
 *
 * Those two cases are worked out during render rather than set from an effect:
 * only the animation itself needs state, and each frame is tagged with the
 * target it was easing toward so a stale frame never shows against a new one.
 */
export function useCountUp(target: number | null, durationMs = 600): number | null {
  const reduced = usePrefersReducedMotion();
  const still = target == null || reduced || durationMs <= 0;
  const [frame, setFrame] = useState<{ target: number | null; value: number | null }>({
    target,
    value: target,
  });

  useEffect(() => {
    if (still || target == null) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutCubic — fast off the line, settles onto the real number. The last
      // frame lands exactly on the target; the easing only ever approaches it.
      setFrame({ target, value: t < 1 ? target * (1 - Math.pow(1 - t, 3)) : target });
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, still]);

  if (target == null) return null;
  if (still) return target;
  return frame.value;
}
