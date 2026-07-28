import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { HoloCard } from "@/components/holo-card";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import type { Rarity } from "@/lib/card-rarity";
import { cn } from "@/lib/utils";

/**
 * Where the card currently held up is in its own little life.
 *
 * entering  flying out of the wrapper, or up out of its board slot, face-down
 * facedown  waiting on a flip — the only phase that waits on a person
 * held      face-up, foil live, chime spent; the payoff
 * landing   shrinking back down into its board slot
 *
 * There is deliberately no `flipping`: HoloCard owns the 500ms rotateY itself,
 * and re-deriving it here would be a second clock for one animation.
 */
export type StagePhase = "entering" | "facedown" | "held" | "landing";

export type StageCard = {
  /** Real event_participant id, always — HoloCard's aspect cache is keyed on it. */
  cacheKey: string;
  /** "Card 2" while face-down, the real name once flipped. See the live region. */
  name: string;
  rarity: Rarity;
  frontUrl: string | null;
  backUrl: string | null;
  backContent: ReactNode;
  /** Copy under the card. A secret's differs from a roster card's. */
  caption: ReactNode;
};

/** The transform that puts a `from` rect exactly on top of a `to` rect. */
function rectDelta(from: DOMRect, to: DOMRect) {
  return {
    x: from.left + from.width / 2 - (to.left + to.width / 2),
    y: from.top + from.height / 2 - (to.top + to.height / 2),
    // Both rects are a HoloCard at the same measured aspect, so one uniform
    // scale is exact. transform-origin stays at the default centre, which is
    // what makes that true.
    scale: to.width ? from.width / to.width : 1,
  };
}

/** A rect that is at least partly on screen is worth flying to. */
function onScreen(r: DOMRect | null): r is DOMRect {
  return !!r && r.bottom > 0 && r.top < window.innerHeight && r.width > 0;
}

/**
 * One card, held up.
 *
 * Purely presentational: no queries, no IndexedDB, no server functions. The route
 * owns the ceremony; this owns the overlay, the scroll lock, focus, and the
 * flight transforms.
 *
 * The board underneath is deliberately left rendered rather than hidden. It is
 * what the card flies down into, its slots have to be measurable mid-ceremony,
 * and the fourth-slot copy has to stay in the accessibility tree.
 */
export function PackStage({
  card,
  phase,
  flipped,
  glow,
  originRect,
  targetRect,
  position,
  total,
  onFlip,
  onEntered,
  onAdvance,
  onLanded,
  onRevealAll,
}: {
  card: StageCard;
  phase: StagePhase;
  flipped: boolean;
  /** The breathing bezel — the hit's hold, and the secret's. */
  glow: boolean;
  /** Where the card flies in from: the wrapper for card one, its slot after. */
  originRect: DOMRect | null;
  /** Where it flies to. Off-screen or missing falls back to a fade. */
  targetRect: DOMRect | null;
  position: number;
  total: number;
  /** Passed straight through to HoloCard's onFlippedChange, so a keyboard flip
   *  and a tap arrive by the same door. */
  onFlip: (next: boolean) => void;
  onEntered: () => void;
  onAdvance: () => void;
  onLanded: () => void;
  /** Null hides the skip — there is nothing left to skip. */
  onRevealAll: (() => void) | null;
}) {
  const reduced = usePrefersReducedMotion();
  const overlayRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [stageRect, setStageRect] = useState<DOMRect | null>(null);
  const headingId = useId();

  // Taken once for the whole ceremony — the stage stays mounted between cards,
  // so this is one lock and one release rather than one per card. Restored to the
  // captured value rather than "", so the stylesheet's own overflow rules on body
  // take back over rather than being overwritten with an empty string.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // The overlay takes focus, not the card. HoloCard exposes no ref, and reaching
  // into it with a querySelector would couple this to another component's DOM.
  // The card underneath is still Tab-reachable for anyone who wants it.
  useEffect(() => {
    overlayRef.current?.focus();
  }, []);

  // Measured at the transition into `landing`, never earlier: an image finishing
  // its decode changes the cached aspect and reflows the board, so a rect taken
  // at `held` can be stale by the time it is used.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (el) setStageRect(el.getBoundingClientRect());
  }, [phase, card.cacheKey]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onRevealAll?.();
      return;
    }
    if (e.key !== "Enter" && e.key !== " ") return;
    // The card carries its own Enter/Space handler, so a key that reached it
    // first has already done the work.
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    if (phase === "facedown") onFlip(true);
    else if (phase === "held") onAdvance();
  }

  const landing = phase === "landing";
  const flying = landing ? onScreen(targetRect) : onScreen(originRect);
  const from = landing ? targetRect : originRect;
  const delta = flying && stageRect && from ? rectDelta(from, stageRect) : null;

  /**
   * Where the card is going.
   *
   * The fallback shrink is not decoration. Without it, a landing with no usable
   * target animated to the values the card already held — motion sees nothing to
   * animate, never fires onAnimationComplete, and the ceremony wedges with a card
   * on screen and no way past it but a reload, on the one screen where a reload
   * costs somebody their pack. Always give it something to move to.
   */
  const target = landing
    ? delta
      ? { ...delta, opacity: 0 }
      : { scale: 0.85, opacity: 0 }
    : { x: 0, y: 0, scale: 1, opacity: 1 };

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      tabIndex={-1}
      onKeyDown={onKey}
      // h-[100dvh] on top of inset-0: inset positions it, dvh bounds the content
      // column by the *dynamic* viewport, so the bottom row does not end up
      // underneath iOS's URL bar. z-50 clears the nav's z-30, and canvas-confetti
      // mounts above both, which is where its bursts belong.
      className="fixed inset-0 z-50 flex h-[100dvh] flex-col items-center justify-center gap-4 bg-background/92 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] backdrop-blur-sm outline-none"
    >
      <h2
        id={headingId}
        className="font-display text-xs font-black uppercase tracking-[0.35em] text-primary"
      >
        {/* "Tap again for the stats" rather than anything about advancing: a tap
            on a face-up card turns it over to its back, and saying otherwise
            promises a control that does something else. Going down to the board
            happens on its own. The last branch is a non-breaking space, so the
            heading holds its line and the card does not jump when it empties. */}
        {phase === "facedown" ? "Tap to flip" : phase === "held" ? "Tap again for the stats" : " "}
      </h2>

      <motion.div
        ref={cardRef}
        // A wrapper carries the flight, never HoloCard: it writes transforms
        // imperatively on both of its own inner layers and would overwrite
        // anything set here on the next pointer frame.
        initial={delta && !landing ? { ...delta, opacity: 0.6 } : { opacity: 0 }}
        animate={target}
        transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 26 }}
        onAnimationComplete={() => (landing ? onLanded() : onEntered())}
        style={glow ? ({ "--stage-glow": card.rarity.accent } as React.CSSProperties) : undefined}
        // 85vw is the phone number this is drawn to. The dvh cap keeps a 5:7 card
        // on screen when the screen is short — a landscape phone, a tablet in
        // split view — and 26rem stops it becoming a poster on a desktop.
        className={cn("w-[min(85vw,58dvh,26rem)] rounded-xl", glow && "pack-stage-glow")}
      >
        <HoloCard
          frontUrl={card.frontUrl}
          backUrl={card.backUrl}
          name={card.name}
          rarity={card.rarity}
          cacheKey={card.cacheKey}
          faceDown
          flipped={flipped}
          onFlippedChange={onFlip}
          // The one place in the app where `hero` is unambiguously right: the
          // page scroll is already locked and there is nothing else on screen,
          // so its touch-action: none has no scroll to steal. It is also what
          // finally unlocks holo-idle and the spinning prism edge, both gated on
          // tilt === "hero" and so never once seen on a card pulled from a pack.
          tilt="hero"
          backContent={card.backContent}
        />
      </motion.div>

      <div className="min-h-[3.5rem] text-center">{card.caption}</div>

      <div className="flex items-center gap-3">
        {/* Which card of how many, without naming any of them. */}
        <div className="flex items-center gap-1.5" aria-hidden>
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 w-1.5 rounded-full transition-colors",
                i < position - 1
                  ? "bg-primary/60"
                  : i === position - 1
                    ? "bg-primary"
                    : "bg-white/20",
              )}
            />
          ))}
        </div>
        {onRevealAll && (
          <button
            onClick={onRevealAll}
            className="rounded-full border border-white/10 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground hover:border-primary/50 hover:text-primary"
          >
            Reveal all
          </button>
        )}
      </div>

      {/* Announced only once the card is face-up. Reading out the name of a card
          that is still face-down is precisely the spoiler this screen exists to
          withhold — the same reason the face-down card's own title says
          "Card 2" rather than whose it is. */}
      <p aria-live="polite" className="sr-only">
        {phase === "held"
          ? `${card.name} — ${card.rarity.label}. Card ${position} of ${total}.`
          : ""}
      </p>
    </div>
  );
}
