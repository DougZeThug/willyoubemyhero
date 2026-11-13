import { useState } from "react";
import { useModalSurface } from "@/hooks/use-modal-surface";
import { motion } from "motion/react";
import { HoloCard } from "@/components/holo-card";
import { RevealAmbience } from "@/components/reveal-ambience";
import { SecretBackPanel } from "@/components/secret-back-panel";
import { useSecretRevealTurn } from "@/components/secret-reveal-turn";
import { secretFoil } from "@/lib/secret-cards";
import { EASE_OUT } from "@/lib/motion";
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
  const [flipped, setFlipped] = useState(false);
  const rarity = secretFoil(card.foil, card.borderFx, card.tier);
  const tier = secretTierStyle(card.tier);
  const revealed = useSecretRevealTurn(duplicate, rarity);

  // A user-dismissed full-screen dialog has to own focus while it is open —
  // role="dialog" alone still lets Tab fall through to the nav behind the
  // overlay, which is painted and reachable. The shared hook also hands focus
  // back to whatever opened this.
  const surfaceRef = useModalSurface<HTMLDivElement>();

  return (
    <div
      ref={surfaceRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 px-6 pt-safe pb-safe outline-none"
      data-testid="bought-pull-reveal"
      role="dialog"
      aria-modal="true"
      aria-label="Bought secret card"
    >
      <RevealAmbience rarity={rarity} secret revealed={revealed} anticipating={!revealed} />

      <div className="relative z-10 text-center">
        <div className="font-display text-label font-bold uppercase tracking-[0.08em] text-muted-foreground">
          Bought pull
        </div>
        <div
          className="mt-1 font-display text-badge font-black uppercase tracking-[0.08em]"
          style={{ color: tier.accent }}
        >
          {tier.label}
        </div>
        {duplicate && (
          <div className="mt-1 text-meta text-muted-foreground">You already had this one</div>
        )}
      </div>

      <motion.div
        className="relative z-10 w-full max-w-[280px]"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.35, ease: EASE_OUT }}
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

      <button onClick={onDone} className="neon-btn-sm relative z-10" data-testid="bought-pull-done">
        {duplicate ? "Another one for the pile" : "Nice"}
      </button>
    </div>
  );
}
