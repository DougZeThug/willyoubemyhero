import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { formatTime } from "@/lib/format";

export function FinishCelebration({
  name,
  timeMs,
  deltaMs,
  onDone,
}: {
  name: string | null;
  timeMs: number | null;
  deltaMs: number | null;
  onDone: () => void;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (!name || fired.current) return;
    fired.current = true;
    let cancelled = false;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) {
      import("canvas-confetti").then(({ default: confetti }) => {
        if (cancelled) return;
        const end = Date.now() + 1200;
        (function frame() {
          confetti({
            particleCount: 6,
            angle: 60,
            spread: 55,
            origin: { x: 0, y: 0.6 },
            colors: ["#38bdf8", "#22d3ee", "#a5f3fc"],
          });
          confetti({
            particleCount: 6,
            angle: 120,
            spread: 55,
            origin: { x: 1, y: 0.6 },
            colors: ["#38bdf8", "#22d3ee", "#a5f3fc"],
          });
          if (Date.now() < end) requestAnimationFrame(frame);
        })();
      });
    }
    const t = setTimeout(onDone, 4200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [name, onDone]);

  return (
    <AnimatePresence>
      {name && (
        <motion.button
          key="celebration"
          onClick={onDone}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 grid place-items-center bg-background/85 backdrop-blur"
        >
          <motion.div
            initial={{ scale: 0.85, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: "spring", stiffness: 220, damping: 18 }}
            className="hud-bezel hud-glow mx-4 max-w-lg rounded-3xl border border-primary/40 p-8 text-center"
          >
            <div className="font-display text-xs font-black uppercase tracking-[0.4em] text-primary">
              Finish
            </div>
            <div className="mt-2 font-display text-4xl font-black uppercase leading-none">
              {name}
            </div>
            <div
              className="mt-4 timer-digits text-6xl text-primary"
              style={{ textShadow: "0 0 24px var(--color-primary)" }}
            >
              {formatTime(timeMs ?? 0)}
            </div>
            {deltaMs != null && (
              <div className="mt-2 text-sm font-bold uppercase tracking-widest">
                {deltaMs === 0 ? (
                  <span className="text-primary">New leader</span>
                ) : (
                  <span className="text-muted-foreground">+{formatTime(deltaMs)} off lead</span>
                )}
              </div>
            )}
            <div className="mt-6 text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
              Tap to dismiss
            </div>
          </motion.div>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
