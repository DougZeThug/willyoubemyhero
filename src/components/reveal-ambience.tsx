import { motion, AnimatePresence } from "motion/react";
import type { Rarity } from "@/lib/card-rarity";
import { ambienceStrength, SECRET_GLOW } from "@/lib/reveal-ambience";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";

/**
 * The room reacting to the card on the stand.
 *
 * Everything here is one fixed layer behind the card, tinted with the tier's own
 * accent. It is deliberately not another glow *on* the card: the card already
 * carries its bezel, its foil and its edge light, and stacking a fourth thing on
 * the same 280 pixels is how a reveal ends up looking busy rather than big. What
 * was missing was everything *around* it.
 *
 * `accent` rather than `border`, for the reason CardBackPanel gives: `base` and
 * `dnf` set `border` to a near-transparent white so their bezel disappears into
 * the card, and a wall lit with that colour would not be lit at all.
 */
export function RevealAmbience({
  rarity,
  secret = false,
  /** The card has been turned over. Before that this is only anticipation. */
  revealed,
  /** The card is holding face-down before its hit lands. */
  anticipating = false,
}: {
  rarity: Rarity;
  secret?: boolean;
  revealed: boolean;
  anticipating?: boolean;
}) {
  const reduced = usePrefersReducedMotion();
  const glow = secret ? SECRET_GLOW : ambienceStrength(rarity.tier);

  // Nothing at all for the quiet tiers until they are actually turned over. A
  // DNF does not get a build-up.
  const showing = revealed || (anticipating && glow >= 0.6);
  if (reduced) return null;

  return (
    <AnimatePresence>
      {showing && (
        <motion.div
          aria-hidden
          initial={{ opacity: 0 }}
          // Anticipation is dimmer than the payoff, so the card landing is still
          // the brightest moment even on a tier that was already glowing.
          animate={{ opacity: revealed ? 1 : 0.45 }}
          exit={{ opacity: 0 }}
          transition={{ duration: revealed ? 0.42 : 0.9, ease: "easeOut" }}
          className="pointer-events-none fixed inset-0 z-0"
        >
          {/* The wash: a pool of the tier's colour behind the card, sized so it
              falls off well before the edges of a phone. A full-bleed tint reads
              as a broken screen; a pool reads as a light being pointed at
              something. */}
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(58% 42% at 50% 44%, ${rarity.accent} 0%, transparent 72%)`,
              opacity: 0.11 + glow * 0.2,
            }}
          />
          {/* Only the loud tiers get a second, tighter core. This is the whole
              difference between "a card came up" and "*that* card came up". */}
          {glow >= 0.6 && (
            <motion.div
              className="absolute inset-0"
              style={{
                background: `radial-gradient(30% 22% at 50% 44%, ${rarity.accent} 0%, transparent 70%)`,
              }}
              animate={{ opacity: revealed ? [0, 0.34, 0.2] : 0.1 }}
              transition={{ duration: 0.7, ease: "easeOut" }}
            />
          )}
          {/* And the top of the scale dims everything else further, so the card
              is the only lit thing left in the room. */}
          {glow >= 1 && (
            <motion.div
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(90% 60% at 50% 44%, transparent 0%, oklch(0 0 0 / 62%) 100%)",
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: revealed ? 1 : 0.5 }}
              transition={{ duration: 0.5 }}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
