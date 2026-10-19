import { useEffect, useState } from "react";

/**
 * Live elapsed ms for a clock that was `baseMs` at the moment its props last
 * changed, ticking on animation frames until `paused`.
 *
 * The frame delta is tagged with the anchor it was measured against. A render
 * after the props change sees a stale tag and shows `baseMs` exactly, so there is
 * no synchronous reset in an effect and no ref read during render — both of which
 * the React Compiler rules flag, and the first of which cost an extra render on
 * every start/stop of the race clock.
 */
export function useElapsed(baseMs: number, paused: boolean): number {
  const anchor = `${baseMs}:${paused}`;
  const [frame, setFrame] = useState({ anchor: "", delta: 0 });

  useEffect(() => {
    if (paused) return;
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      setFrame({ anchor, delta: performance.now() - start });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [anchor, paused]);

  if (paused) return baseMs;
  return Math.max(0, baseMs + (frame.anchor === anchor ? frame.delta : 0));
}
