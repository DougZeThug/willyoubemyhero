import { useEffect, useRef, useState } from "react";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Circular HUD timer — dual-ring chrome bezel with an animated cyan progress
 * arc, tick marks at cardinal points, and centered scoreboard digits.
 *
 * `runningSinceMs` is the elapsed time already accumulated at the anchor; when
 * `paused` is false the component interpolates via RAF for smooth movement.
 */
export function HudTimer({
  runningSinceMs,
  paused,
  status,
  size = 300,
  targetMs = 60_000,
  children,
  className,
}: {
  runningSinceMs: number;
  paused: boolean;
  /** Sub-label rendered under the digits, e.g. "ON DECK", "ON THE CLOCK". */
  status: string;
  /** Pixel diameter of the ring. */
  size?: number;
  /** Full sweep in ms — arc completes at this time, then wraps. */
  targetMs?: number;
  /** Optional content rendered behind the digits (silhouette, avatar). */
  children?: React.ReactNode;
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

  const strokeW = 8;
  const r = size / 2 - strokeW * 2 - 6;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const progress = ((ms % targetMs) / targetMs) * circ;

  const seconds = Math.floor(ms / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  const digits = seconds < 60
    ? `${String(seconds).padStart(2, "0")}:${String(cs).padStart(2, "0")}`
    : formatTime(ms);

  return (
    <div
      className={cn("relative mx-auto aspect-square", className)}
      style={{ width: size, height: size }}
    >
      {/* Ambient bloom */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-[-15%] rounded-full opacity-80"
        style={{ background: "var(--gradient-hud)" }}
      />

      {/* Outer chrome bezel */}
      <div className="hud-bezel absolute inset-0 rounded-full" />

      {/* Inner dial */}
      <div
        className="absolute rounded-full border border-primary/30 bg-[oklch(0.11_0.02_240)]"
        style={{ inset: strokeW * 2 }}
      />

      {/* Optional inner content (silhouette/avatar) */}
      {children && (
        <div
          className="absolute grid place-items-center opacity-40"
          style={{ inset: strokeW * 2 + 12 }}
        >
          {children}
        </div>
      )}

      {/* Ring + ticks */}
      <svg
        className="absolute inset-0 h-full w-full -rotate-90"
        viewBox={`0 0 ${size} ${size}`}
      >
        {/* base track */}
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke="oklch(1 0 0 / 0.06)"
          strokeWidth={strokeW}
        />
        {/* progress arc */}
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth={strokeW}
          strokeLinecap="round"
          strokeDasharray={`${progress} ${circ}`}
          style={{
            filter: paused
              ? "none"
              : "drop-shadow(0 0 8px var(--color-primary)) drop-shadow(0 0 16px oklch(0.82 0.14 210 / 0.6))",
          }}
        />
        {/* cardinal tick marks */}
        {[0, 90, 180, 270].map((deg) => {
          const rad = (deg * Math.PI) / 180;
          const x1 = c + Math.cos(rad) * (r - strokeW - 4);
          const y1 = c + Math.sin(rad) * (r - strokeW - 4);
          const x2 = c + Math.cos(rad) * (r + strokeW + 4);
          const y2 = c + Math.sin(rad) * (r + strokeW + 4);
          return (
            <line
              key={deg}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="var(--color-primary)"
              strokeOpacity="0.55"
              strokeWidth="2"
              strokeLinecap="round"
            />
          );
        })}
      </svg>

      {/* Digits + status */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <div
          className={cn(
            "timer-digits text-[3.75rem] leading-none sm:text-[4.25rem]",
            paused ? "text-warn" : "text-primary",
          )}
          style={{
            textShadow: paused
              ? "none"
              : "0 0 20px oklch(0.82 0.14 210 / 0.55), 0 0 40px oklch(0.82 0.14 210 / 0.35)",
          }}
        >
          {digits}
          <span className="ml-1 align-top text-2xl opacity-75">s</span>
        </div>
        <div className="mt-2 text-xs font-black uppercase tracking-[0.4em] text-primary/90">
          {status}
        </div>
      </div>
    </div>
  );
}