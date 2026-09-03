import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { HoloCard } from "@/components/holo-card";
import { RevealAmbience } from "@/components/reveal-ambience";
import { SecretBackPanel } from "@/components/secret-back-panel";
import { celebrateSecret } from "@/lib/card-confetti";
import { cue, playReveal } from "@/lib/card-sfx";
import { SECRET_CHIME, SECRET_DUPE_CHIME, secretFoil } from "@/lib/secret-cards";
import type { SecretCardView } from "@/lib/secret-cards";
import { secretTierStyle } from "@/lib/secret-rarity";
import type { ImageUrlSet } from "@/lib/media";

/**
 * The card a purchase bought, turned over in front of you.
 *
 * The shop used to close a 150-dust purchase on "check your secrets", which is
 * the one way of getting a secret that never showed you the card — people went
 * hunting through the vault guessing which one was new. Every other route to a
 * secret (the daily pull, the streak rung) ends in a turn, so this one does too.
 *
 * Deliberately NOT a fifth phase of MilestoneReveal: that component's whole top
 * half is a flame counting a streak up, and a purchase has no streak to count.
 * What it shares — the face-down beat, the ambience, the tap-to-read back — is
 * shared by composition instead.
 */
const TURN_DELAY_MS = 260;

/**
 * Read synchronously, same as the milestone reveal does it: the hook settles a
 * tick later, which is fine for a duration and useless to something deciding
 * whether to animate at all on its first frame.
 */
function reducedNow(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

export function BoughtPullReveal({
  card,
  duplicate,
  universalBack = null,
  onDone,
}: {
  card: SecretCardView;
  duplicate: boolean;
  /**
   * The event's shared back. Secret cards rarely carry one of their own, and
   * without this the turn lands on the generated text panel instead of art —
   * the same bug the milestone reveal was fixed for.
   */
  universalBack?: ImageUrlSet | string | null;
  onDone: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const rarity = secretFoil(card.foil, card.borderFx);
  const celebratedRef = useRef(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const tier = secretTierStyle(card.tier);

  // A user-dismissed full-screen dialog has to own focus while it is open —
  // role="dialog" alone still lets Tab fall through to the nav behind the
  // overlay. Same pattern the finish celebration uses: the surface is
  // focusable, takes focus on arrival, and declares itself modal.
  useEffect(() => {
    surfaceRef.current?.focus();
  }, []);

  useEffect(() => {
    if (celebratedRef.current) return;
    celebratedRef.current = true;
    cue("secretImpact");
    playReveal(duplicate ? SECRET_DUPE_CHIME : SECRET_CHIME);
    // A duplicate is still yours, but it does not get the cannon — the same rule
    // the daily pull and the milestone reveal both keep.
    if (!duplicate) void celebrateSecret(rarity);
    if (reducedNow()) {
      setRevealed(true);
      return;
    }
    const t = setTimeout(() => setRevealed(true), TURN_DELAY_MS);
    return () => clearTimeout(t);
  }, [duplicate, rarity]);

  return (
    <div
      ref={surfaceRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 px-6 outline-none"
      data-testid="bought-pull-reveal"
      role="dialog"
      aria-modal="true"
      aria-label="Bought secret card"
    >
      <RevealAmbience rarity={rarity} secret revealed={revealed} anticipating={!revealed} />

      <div className="relative z-10 text-center">
        <div className="font-display text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
          Bought pull
        </div>
        <div
          className="mt-1 font-display text-xs font-black uppercase tracking-[0.18em]"
          style={{ color: tier.accent }}
        >
          {tier.label}
        </div>
        {duplicate && (
          <div className="mt-1 text-[11px] text-muted-foreground">You already had this one</div>
        )}
      </div>

      <motion.div
        className="relative z-10 w-full max-w-[280px]"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.35 }}
      >
        <HoloCard
          frontUrl={card.artUrl}
          backUrl={universalBack ?? card.backUrl}
          name={card.name}
          rarity={rarity}
          tilt="hero"
          faceDown={!revealed}
          flipped={revealed ? flipped : false}
          onFlippedChange={revealed ? setFlipped : undefined}
          backContent={<SecretBackPanel card={card} rarity={rarity} />}
        />
      </motion.div>

      <button
        onClick={onDone}
        className="neon-btn-sm relative z-10"
        data-testid="bought-pull-done"
      >
        {duplicate ? "Another one for the pile" : "Nice"}
      </button>
    </div>
  );
}
