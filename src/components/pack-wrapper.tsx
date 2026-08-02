import { useCallback, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { playTearTick } from "@/lib/card-sfx";
import { seededRng } from "@/lib/format";
import { TEAR, tearProgress } from "@/lib/pack";
import { urlFromSet } from "@/lib/media.functions";
import type { ImageUrlSet } from "@/lib/media.functions";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

/** How often a crinkle fires across the rip, as a fraction of the travel. */
const TICK_EVERY = 0.12;

type TearPoint = { x: number; y: number };

/**
 * The ragged line the wrapper separates along.
 *
 * Seeded, so a given pack always tears the same way — the same property the old
 * vertical wipe had, and worth keeping: two people opening the same pack side by
 * side should see the same rip.
 */
function tearEdge(rng: () => number, stripPct: number): TearPoint[] {
  const steps = 16;
  const points: TearPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    points.push({
      x: (i / steps) * 100,
      // Kept off the very top edge, or a deep jitter clips the strip away to
      // nothing at that column and the tear reads as a hole rather than a rip.
      y: Math.max(1.5, stripPct + (rng() - 0.5) * 4.5),
    });
  }
  return points;
}

const fmt = (p: TearPoint) => `${p.x.toFixed(1)}% ${p.y.toFixed(1)}%`;

/** Everything above the tear line — the piece that peels away. */
function stripClip(points: TearPoint[]): string {
  return `polygon(0% 0%, 100% 0%, ${[...points].reverse().map(fmt).join(", ")})`;
}

/** Everything below it — the pack, which never moves. */
function bodyClip(points: TearPoint[]): string {
  return `polygon(${points.map(fmt).join(", ")}, 100% 100%, 0% 100%)`;
}

/**
 * The printed face of the pack, drawn once per layer.
 *
 * The wax foil underneath is the designed fallback, not a spinner: a slow network
 * gets a beautiful pack rather than a grey box, and an event with no uploaded back
 * gets the same thing permanently.
 *
 * The lettering hides on `loaded`, never on "an art URL exists". A cached image
 * completes before React attaches onLoad, and an expired signed URL never
 * completes at all — both used to leave a blank foil with the caption already
 * hidden, which is what "the universal back isn't showing" looked like.
 */
function PackFace({ art, size, year }: { art: string | null; size: number; year: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  // Runs on mount too, so an image the browser already had decoded — which fires
  // its load event before the handler exists — still reports itself.
  const settle = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) setLoaded(true);
  }, []);
  const showArt = !!art && !failed;
  return (
    <div className="wax-foil absolute inset-0">
      {showArt && (
        <img
          ref={settle}
          src={art}
          alt=""
          aria-hidden
          crossOrigin="anonymous"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      )}
      <div
        className={cn(
          "relative flex h-full flex-col items-center justify-center gap-2 p-6 text-center",
          // The lettering is the pack's identity until real art is actually on
          // screen. Over a loaded back it is a caption nobody asked for.
          showArt && loaded && "hidden",
        )}
      >
        <Sparkles className="h-8 w-8 text-primary" />
        <div className="font-display text-xs font-black uppercase tracking-[0.35em] text-primary/90">
          Will YOU Be My Hero?
        </div>
        <div className="font-display text-3xl font-black uppercase leading-none">Draft Combine</div>
        <div className="font-display text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
          {size} cards · {year}
        </div>
      </div>
    </div>
  );
}

/**
 * The sealed pack, and the rip that opens it.
 *
 * The gesture is horizontal travel along a perforation near the top, measured
 * from where the finger landed. The version before this compared the pointer's
 * absolute Y against the pack's own top edge, which meant a tap two thirds of the
 * way down opened the pack having travelled nowhere — there was no drag to fail.
 */
export function PackWrapper({
  seed,
  artUrl,
  packSize,
  year,
  onTear,
}: {
  /** Pack seed, so the ragged edge is stable for a given pack. */
  seed: string;
  artUrl: ImageUrlSet | null;
  packSize: number;
  year: string;
  onTear: () => void;
}) {
  const packRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: number; x: number } | null>(null);
  const tickRef = useRef(0);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const reduced = usePrefersReducedMotion();

  const stripPct = TEAR.stripH * 100;
  const edge = tearEdge(seededRng(seed), stripPct);
  const art = urlFromSet(artUrl);

  function end(e: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.id === e.pointerId && e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
    setDragging(false);
    // Short of the threshold the foil springs shut. Losing the progress is the
    // point: a rip you did not finish is a pack you did not open.
    setProgress(0);
  }

  // Rotating about the right edge is what makes this read as tearing rather than
  // sliding: the left end lifts while the right is still stuck down, which is the
  // shape a real wrapper takes when you rip it left to right.
  const lift = reduced ? 0 : progress;
  const stripStyle: React.CSSProperties = {
    clipPath: stripClip(edge),
    transformOrigin: "right center",
    transform: `rotate(${(-lift * 8).toFixed(2)}deg) translateY(${(-lift * 14).toFixed(1)}px)`,
    opacity: reduced ? 1 - progress : 1,
    transition: dragging ? undefined : "transform 320ms cubic-bezier(0.22, 1, 0.36, 1)",
  };

  return (
    <div
      ref={packRef}
      role="button"
      tabIndex={0}
      aria-label="Tear the pack open"
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onTear();
        }
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = { id: e.pointerId, x: e.clientX };
        tickRef.current = 0;
        setDragging(true);
      }}
      onPointerMove={(e) => {
        const drag = dragRef.current;
        const rect = packRef.current?.getBoundingClientRect();
        if (!drag || drag.id !== e.pointerId || !rect) return;

        const p = tearProgress(drag.x, e.clientX, rect.width);
        setProgress(p);

        // One crinkle per step of the rip rather than one per pointermove, which
        // would fire sixty times a second and sound like static.
        const tick = Math.floor(p / TICK_EVERY);
        if (tick > tickRef.current) {
          tickRef.current = tick;
          playTearTick();
        }

        if (p >= TEAR.threshold) {
          dragRef.current = null;
          setDragging(false);
          onTear();
        }
      }}
      onPointerUp={end}
      onPointerCancel={end}
      className="hud-glow relative aspect-[3/4] w-full max-w-xs cursor-grab touch-none overflow-hidden rounded-2xl border border-primary/40 bg-background active:cursor-grabbing"
    >
      {/* The inside of the pack, exposed as the strip peels off it. Sits at the
          bottom of the stack so it is simply what is left once the foil moves. */}
      <div aria-hidden className="absolute inset-0 bg-black">
        <div
          className="absolute inset-x-0 top-0 bg-gradient-to-b from-primary/25 to-transparent"
          style={{ height: `${stripPct + 10}%` }}
        />
      </div>

      {/* The pack itself, which never moves. */}
      <div aria-hidden className="absolute inset-0" style={{ clipPath: bodyClip(edge) }}>
        <PackFace art={art} size={packSize} year={year} />
      </div>

      {/* The torn strip. */}
      <div aria-hidden className="absolute inset-0" style={stripStyle}>
        <PackFace art={art} size={packSize} year={year} />
      </div>

      {/* The perforation, and the tab that says which end to start from. Hidden
          once the rip is under way — a dotted line across a tear you are already
          making is just a label over the thing it describes. */}
      {progress < 0.05 && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 flex items-center gap-2 px-3"
          style={{ top: `${stripPct}%`, transform: "translateY(-50%)" }}
        >
          <div className="tear-hint rounded-sm bg-primary/90 px-1.5 py-0.5 font-display text-[8px] font-black uppercase tracking-[0.2em] text-background">
            Rip
          </div>
          <div className="h-px flex-1 border-t border-dashed border-white/60" />
        </div>
      )}

      {/* The leading edge of the rip, so the eye has something to follow. */}
      {progress > 0.05 && !reduced && (
        <div
          aria-hidden
          className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/70 blur-md"
          style={{ top: `${stripPct}%`, left: `${(progress * 100).toFixed(1)}%` }}
        />
      )}
    </div>
  );
}
