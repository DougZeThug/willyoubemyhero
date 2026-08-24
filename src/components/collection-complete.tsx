import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Medal } from "lucide-react";
import { RevealAmbience } from "@/components/reveal-ambience";
import { useCountUp } from "@/hooks/use-count-up";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { celebrateCollection } from "@/lib/card-confetti";
import { cue, playReveal } from "@/lib/card-sfx";
import { TROPHY_CHIME, TROPHY_RARITY, trophySizeLabel } from "@/lib/collection-trophies";

/**
 * A set closing.
 *
 * The one screen in this app allowed to print how big a secret set is. Every
 * other surface goes out of its way not to — SecretBackPanel prints no serial,
 * the vault shelf heads itself with what you hold and never a denominator — and
 * this is the moment that silence pays off: the number arrives once, at the end,
 * as the prize rather than as the spoiler. Which is why the count-up is the
 * centre of the composition instead of a caption under something else.
 *
 * Standalone rather than a phase in a ceremony machine, same as MilestoneReveal:
 * a set can close from the pack screen or from the trade screen, and the two have
 * no shared geometry. Mounted by the route as a SIBLING of whatever scene is
 * behind it, never wrapping it — the pack stage uses backdrop-filter, which is a
 * grouping property and flattens every 3D transform inside it.
 */

const SEAL_MS = 900;

/**
 * The preference, read synchronously.
 *
 * `usePrefersReducedMotion` deliberately starts false and settles in an effect so
 * hydration matches, which is right for choosing a duration and useless to a
 * component deciding whether to start at all on its first frame. Same inline read
 * milestone-reveal.tsx, card-sfx.ts and card-confetti.ts do.
 */
function reducedNow(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

type Phase = "seal" | "count";

export function CollectionComplete({
  label,
  size,
  onDone,
}: {
  /** The set's name, resolved server-side so a hidden set still reads as something. */
  label: string;
  /** How many cards were in it. The payoff — see the note above. */
  size: number;
  onDone: () => void;
}) {
  const reduced = usePrefersReducedMotion();
  const [phase, setPhase] = useState<Phase>("seal");
  const celebratedRef = useRef(false);
  // Null until the seal lands, so the number does not start climbing behind the
  // medal — the count IS the reveal and it must not begin before it is visible.
  const cards = useCountUp(phase === "count" ? size : null, 1100);

  // Timeouts rather than motion callbacks, for the reason pack-ceremony.ts gives:
  // motion does not tick under jsdom, and a ceremony nobody can test is one that
  // breaks quietly.
  useEffect(() => {
    if (phase !== "seal") return;
    if (reducedNow()) {
      setPhase("count");
      return;
    }
    const t = setTimeout(() => setPhase("count"), SEAL_MS);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (celebratedRef.current) return;
    celebratedRef.current = true;
    cue("collectionComplete");
    // The resolution of the secret bell. Somebody who has pulled all season has
    // heard the unresolved version dozens of times without ever hearing it land.
    playReveal(TROPHY_CHIME);
    void celebrateCollection();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 px-6"
      data-testid="collection-complete"
      role="dialog"
      aria-label={`${label} complete`}
    >
      <RevealAmbience rarity={TROPHY_RARITY} secret revealed anticipating={false} />

      <div className="relative z-10 flex flex-col items-center text-center">
        <motion.div
          initial={reduced ? false : { scale: 0.4, opacity: 0, rotate: -25 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 14 }}
        >
          <Medal
            aria-hidden
            className="h-16 w-16"
            style={{ color: TROPHY_RARITY.accent, filter: "drop-shadow(0 0 18px currentColor)" }}
          />
        </motion.div>

        <div className="mt-4 font-display text-[10px] font-bold uppercase tracking-[0.35em] text-muted-foreground">
          Set complete
        </div>
        <div
          className="mt-1 font-display text-3xl font-black uppercase leading-tight"
          style={{ color: TROPHY_RARITY.accent }}
        >
          {label}
        </div>

        {/* THE NUMBER. Held back until the seal has landed, then counted, because
            a total that simply appears is information and a total that climbs is
            an achievement. */}
        <div className="mt-6 h-20" aria-live="polite">
          {phase === "count" && (
            <motion.div
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div
                className="timer-digits text-6xl leading-none"
                style={{ color: TROPHY_RARITY.accent }}
              >
                {/* The hook eases through floats; only whole cards mean anything. */}
                {Math.round(cards ?? 0)}
              </div>
              <div className="mt-2 font-display text-xs font-bold uppercase tracking-[0.25em] text-muted-foreground">
                {trophySizeLabel(size)}, all of them
              </div>
            </motion.div>
          )}
        </div>
      </div>

      <button
        onClick={onDone}
        className="neon-btn relative z-10 !px-5 !py-2 !text-xs"
        data-testid="collection-complete-done"
      >
        Every one
      </button>
    </div>
  );
}
