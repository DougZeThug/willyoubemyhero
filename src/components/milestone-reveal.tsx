import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Flame } from "lucide-react";
import { HoloCard } from "@/components/holo-card";
import { RevealAmbience } from "@/components/reveal-ambience";
import { SecretBackPanel } from "@/components/secret-back-panel";
import { useCountUp } from "@/hooks/use-count-up";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { celebrateSecret } from "@/lib/card-confetti";
import { cue, playReveal, playSecretRiser } from "@/lib/card-sfx";
import { SECRET_CHIME, SECRET_DUPE_CHIME, secretFoil } from "@/lib/secret-cards";
import type { SecretCardView } from "@/lib/secret-cards";
import { secretTierFloorLabel, secretTierStyle, type SecretTier } from "@/lib/secret-rarity";

/**
 * The milestone payoff: a flame that counts the days up, then the card it bought.
 *
 * Standalone rather than a fifth slot in stand-phase.ts. That machine's whole
 * thesis is that its phases stay exhaustible in a test, and a claim can fire from
 * the summary long after the stand has been torn down — the two have no shared
 * geometry to justify sharing a state machine.
 *
 * Mounted by the route as a SIBLING of the scene, never wrapping it: the stage
 * behind this uses backdrop-filter, which is a grouping property and flattens
 * every 3D transform inside it.
 */

const FLARE_MS = 1100;
const COUNT_MS = 900;

/**
 * The preference, read synchronously.
 *
 * `usePrefersReducedMotion` deliberately starts false and settles in an effect,
 * so that hydration matches — which is right for a component that chooses a
 * duration, and useless to one that has to decide whether to start at all on its
 * very first frame. Same inline read card-sfx.ts and card-confetti.ts do, for the
 * same reason.
 */
function reducedNow(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

type Phase = "flare" | "card";

export function MilestoneReveal({
  milestone,
  streak,
  card,
  tierFloor,
  duplicate,
  onDone,
}: {
  milestone: number;
  streak: number;
  card: SecretCardView;
  /** What this rung guaranteed. Null on day 3, which promises nothing. */
  tierFloor: SecretTier | null;
  duplicate: boolean;
  onDone: () => void;
}) {
  // Still the hook for anything that only affects how a frame is drawn: it
  // settles a tick later, which is invisible there.
  const reduced = usePrefersReducedMotion();
  const [phase, setPhase] = useState<Phase>("flare");
  const [flipped, setFlipped] = useState(false);
  const rarity = secretFoil(card.foil, card.borderFx);
  const days = useCountUp(phase === "flare" ? streak : null, COUNT_MS);
  const celebratedRef = useRef(false);

  // Driven by timeouts rather than motion callbacks, for the same reason
  // pack-ceremony.ts is: motion does not tick under jsdom, and a ceremony nobody
  // can test is one that breaks quietly.
  useEffect(() => {
    if (phase !== "flare") return;
    // Straight to the card. The flare is pure flourish, and a count-up nobody
    // asked to watch is the exact thing that setting turns off.
    if (reducedNow()) {
      setPhase("card");
      return;
    }
    playSecretRiser(1);
    const t = setTimeout(() => setPhase("card"), FLARE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== "card" || celebratedRef.current) return;
    celebratedRef.current = true;
    setFlipped(true);
    cue("secretImpact");
    playReveal(duplicate ? SECRET_DUPE_CHIME : SECRET_CHIME);
    // A duplicate is still a reward here — it was bought with a month of showing
    // up — but it does not get the cannon. Same rule the daily pull follows.
    if (!duplicate) void celebrateSecret(rarity);
  }, [phase, duplicate, rarity]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 px-6"
      data-testid="milestone-reveal"
      role="dialog"
      aria-label={`Day ${milestone} streak reward`}
    >
      <RevealAmbience
        rarity={rarity}
        secret
        revealed={phase === "card"}
        anticipating={phase === "flare"}
      />

      <div className="relative z-10 text-center">
        <div className="font-display text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
          Streak reward
        </div>
        <div className="mt-1 flex items-center justify-center gap-2">
          <Flame
            aria-hidden
            className="h-7 w-7"
            style={
              {
                color: "oklch(0.82 0.19 85)",
                "--flame-edge": "oklch(0.82 0.19 85 / 55%)",
              } as React.CSSProperties
            }
          />
          <span
            className="font-display text-4xl font-black leading-none"
            style={{ color: "oklch(0.82 0.19 85)" }}
          >
            {/* The hook eases through floats; only whole days mean anything. */}
            {phase === "flare" ? Math.round(days ?? 0) : milestone}
          </span>
        </div>
        <div className="mt-1 font-display text-xs font-bold uppercase tracking-[0.2em]">
          {milestone} days in a row
        </div>
        {/* What the run bought, printed next to the days that bought it. Not
            secretTierCaption: that prints the base pull rate, and under a card
            this rung guaranteed, "3.5% pull" is the odds of the thing that did
            not happen. */}
        {tierFloor && (
          <div
            className="mt-1 font-display text-[10px] font-black uppercase tracking-[0.18em]"
            style={{ color: secretTierStyle(tierFloor).accent }}
          >
            {secretTierFloorLabel(tierFloor)}
          </div>
        )}
      </div>

      {phase === "card" && (
        <motion.div
          className="relative z-10 w-full max-w-[280px]"
          initial={reduced ? false : { opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35 }}
        >
          <HoloCard
            frontUrl={card.artUrl}
            backUrl={card.backUrl}
            name={card.name}
            rarity={rarity}
            tilt="hero"
            flipped={flipped}
            backContent={<SecretBackPanel card={card} rarity={rarity} />}
          />
        </motion.div>
      )}

      <button
        onClick={onDone}
        className="neon-btn relative z-10 !px-5 !py-2 !text-xs"
        data-testid="milestone-done"
      >
        {duplicate ? "Another one for the pile" : "Nice"}
      </button>
    </div>
  );
}
