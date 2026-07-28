import { useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { seededRng } from "@/lib/format";
import { tearPolygon } from "@/lib/pack";
import { cn } from "@/lib/utils";

/**
 * Upward travel that completes the tear, as a fraction of the pack's height.
 *
 * This was TEAR_THRESHOLD, an absolute position measured down from the top edge.
 * Same number, different quantity: it is now how far the thumb has to *push*,
 * which is the thing a person can actually feel. Measuring travel rather than
 * position also means the gesture means the same thing wherever on the pack it
 * starts, instead of being unwinnable from near the bottom.
 */
const TEAR_TRAVEL = 0.55;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * The sealed pack, and the swipe that rips it.
 *
 * Hand-rolled pointer events rather than motion's `drag`. Nothing here
 * translates — the tear is a *scrub*, mapping finger position onto a clip-path
 * progress, and `drag` would hand back a `y` motion value we would immediately
 * have to convert into exactly that, with dragConstraints and dragElastic to
 * argue with along the way. holo-card.tsx is the house reference for a pointer
 * gesture; the long note there on why touch-action is all-or-nothing applies
 * here too, and is why this stays `touch-none`.
 */
export function PackWrapper({
  backUrl,
  cardCount,
  year,
  seed,
  onTear,
}: {
  /** The event's universal card back. Null falls through to the wax foil. */
  backUrl: string | null;
  cardCount: number;
  year: number | null;
  /** Seeds the ragged edge, so the same pack always tears the same way. */
  seed: string;
  /**
   * Handed the wrapper's own rect, measured the instant before it goes away, so
   * the first card can fly out of exactly where the pack was standing.
   */
  onTear: (rect: DOMRect | null) => void;
}) {
  const [progress, setProgress] = useState(0);
  const startRef = useRef<{ id: number; y: number } | null>(null);
  const packRef = useRef<HTMLDivElement>(null);

  /** Measured before the parent unmounts this, or there is nothing left to measure. */
  function tear() {
    onTear(packRef.current?.getBoundingClientRect() ?? null);
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (startRef.current?.id === e.pointerId) startRef.current = null;
    // Springs back rather than holding a half-torn pack: an abandoned gesture
    // should look abandoned.
    setProgress(0);
  }

  const face = (
    <>
      {/* The wax foil underneath is the designed fallback, not a spinner: a slow
          network gets a beautiful pack rather than a grey box, and an event with
          no uploaded back gets the same thing permanently. */}
      {backUrl && (
        <img
          src={backUrl}
          alt=""
          aria-hidden
          crossOrigin="anonymous"
          draggable={false}
          onLoad={(e) => e.currentTarget.style.setProperty("opacity", "1")}
          className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-300"
        />
      )}
      <div
        className={cn(
          "relative flex h-full flex-col items-center justify-center gap-2 p-6 text-center",
          // The lettering is the pack's identity only while there is no art.
          // Over a real back it is a caption nobody asked for.
          backUrl && "hidden",
        )}
      >
        <Sparkles className="h-8 w-8 text-primary" />
        <div className="font-display text-xs font-black uppercase tracking-[0.35em] text-primary/90">
          Will YOU Be My Hero?
        </div>
        <div className="font-display text-3xl font-black uppercase leading-none">Draft Combine</div>
        <div className="font-display text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
          {cardCount} cards · {year ?? ""}
        </div>
      </div>
    </>
  );

  return (
    <div className="flex w-full flex-col items-center gap-5">
      <div
        ref={packRef}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          startRef.current = { id: e.pointerId, y: e.clientY };
        }}
        onPointerMove={(e) => {
          const start = startRef.current;
          if (!start || start.id !== e.pointerId) return;
          const r = e.currentTarget.getBoundingClientRect();
          if (!r.height) return;
          const p = clamp01((start.y - e.clientY) / (r.height * TEAR_TRAVEL));
          setProgress(p);
          if (p >= 1) {
            // Cleared before the callback: the parent unmounts this element on
            // tear, and a move event still in flight would otherwise scrub a
            // pack that no longer exists.
            startRef.current = null;
            tear();
          }
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        role="button"
        tabIndex={0}
        aria-label="Swipe up to open the pack"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            tear();
          }
        }}
        // Height-capped rather than width-capped, which is what a swipe-up needs:
        // sized from its width alone the pack ran off the bottom of a 390x844
        // phone and under the fixed nav, so the half you would naturally start a
        // swipe on was not on screen — and the gesture simply never landed. The
        // height drives the width through the aspect ratio, so it still reads as
        // a pack rather than a letterbox.
        className="wax-foil hud-glow relative aspect-[3/4] h-[min(40dvh,22rem)] w-auto max-w-[80vw] cursor-grab touch-none overflow-hidden rounded-2xl border border-primary/40 active:cursor-grabbing"
      >
        {face}
        {/* The rip. Everything below the edge has been opened, so it darkens to
            the inside of the pack; everything above it is still sealed and is
            simply the face already rendered underneath.

            drop-shadow rather than a border or an inset box-shadow: it traces the
            *clip silhouette*, which is the ragged edge itself. A border sits on
            the element's own straight top edge, which the clip then removes — so
            the earlier version drew a lit line nobody ever saw. */}
        {progress > 0 && (
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              clipPath: tearPolygon(seededRng(seed), progress, "strip"),
              filter: "drop-shadow(0 -2px 9px oklch(0.82 0.14 210 / 75%))",
            }}
          >
            {/* Two stops rather than a flat wash: the pack is deeper the further
                past the tear you look. */}
            <div className="absolute inset-0 bg-gradient-to-b from-background/70 to-background/95" />
          </div>
        )}
      </div>

      <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
        Swipe up · or press Enter
      </div>
    </div>
  );
}
