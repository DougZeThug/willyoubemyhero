import { useEffect, useRef, useState } from "react";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export function BigTimer({
  runningSinceMs,
  paused,
  className,
}: {
  /** Elapsed ms already accumulated at anchor (frozen when paused) */
  runningSinceMs: number;
  paused: boolean;
  className?: string;
}) {
  const [now, setNow] = useState(() => performance.now());
  const anchor = useRef({ perf: performance.now(), base: runningSinceMs, paused });

  useEffect(() => {
    anchor.current = { perf: performance.now(), base: runningSinceMs, paused };
    setNow(performance.now());
  }, [runningSinceMs, paused]);

  useEffect(() => {
    if (paused) return;
    let raf = 0;
    const tick = () => {
      setNow(performance.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused]);

  const ms = paused
    ? runningSinceMs
    : Math.max(0, runningSinceMs + (now - anchor.current.perf));

  return (
    <div
      className={cn(
        "timer-digits text-[4.75rem] leading-none sm:text-[6.5rem]",
        paused ? "text-warn" : "text-primary",
        className,
      )}
    >
      {formatTime(ms)}
    </div>
  );
}