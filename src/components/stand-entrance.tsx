import { motion } from "motion/react";
import { PackCardBack } from "@/components/pack-card-back";
import {
  entryTransform,
  restingDeckOffset,
  standDeckOffset,
  STAND_DECK_MAX,
  type PackHandoff,
  type SlotRect,
} from "@/lib/pack-handoff";
import type { ImageUrlSet } from "@/lib/media";

/**
 * The pack arriving on the stand.
 *
 * The one job here is that the first painted frame is exactly the last frame of
 * the ceremony. Every position is a transform from a measured viewport rect onto
 * the stand's own slot — nothing is derived, because nothing on either side can
 * be derived from the other.
 *
 * These are `PackCardBack`s, not `HoloCard`s, and that is not a shortcut. A
 * HoloCard computes `canFlip` from having a back, which the stand always gives
 * it, so it carries `aria-pressed` whatever else is done to it — and the e2e
 * suite finds the card on the stand with exactly `[role="button"][aria-pressed]`.
 * Flying real cards would put three more of those on screen for the whole
 * flight.
 */
export function StandEntrance({
  from,
  slot,
  art,
  onLanded,
}: {
  from: PackHandoff;
  slot: SlotRect;
  /** The event's universal deck back, which is what the ceremony was showing. */
  art: ImageUrlSet | null;
  onLanded: () => void;
}) {
  return (
    <div aria-hidden data-testid="stand-entrance" className="pointer-events-none absolute inset-0">
      {from.cards.slice(0, STAND_DECK_MAX + 1).map((c, i) => (
        <motion.div
          key={i}
          initial={entryTransform(c, slot)}
          animate={standDeckOffset(i, slot.width)}
          transition={{ type: "spring", stiffness: 180, damping: 26, delay: i * 0.04 }}
          // Only the front card reports. The others land within a couple of
          // frames of it, and racing four completions is four state updates for
          // one event.
          onAnimationComplete={i === 0 ? onLanded : undefined}
          style={{ position: "absolute", inset: 0, zIndex: 20 - i }}
          className="rounded-xl border border-primary/30 shadow-2xl"
        >
          <PackCardBack art={art} />
        </motion.div>
      ))}
    </div>
  );
}

/**
 * The rest of the pack, waiting behind the card on the stand.
 *
 * This is what "the others collapse behind it" resolves to, and it persists for
 * the whole reveal rather than being spent on the transition. It answers "where
 * did the rest of my pack go", it gives the stand physical weight, and it thins
 * out as the cursor advances so the last card actually feels like the last card.
 *
 * Never draws the hero — by the time this is on screen the hero is a real
 * HoloCard the stand owns — which is the whole reason `restingDeckOffset` exists
 * rather than calling `standDeckOffset` with a hand-written `+ 1`.
 */
export function StandDeck({
  count,
  art,
  width,
}: {
  /** How many cards are still behind this one. */
  count: number;
  art: ImageUrlSet | null;
  width: number;
}) {
  if (count <= 0 || width <= 0) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {Array.from({ length: Math.min(count, STAND_DECK_MAX) }, (_, i) => {
        const at = restingDeckOffset(i, width);
        return (
          <div
            key={i}
            className="absolute inset-0 overflow-hidden rounded-xl border border-primary/20"
            style={{
              transform: `translate(${at.x}px, ${at.y}px) scale(${at.scale})`,
              // Behind the card on the stand, and behind each other in order.
              zIndex: -1 - i,
              // Progressively dimmer with depth, so the stack recedes rather than
              // reading as three equally bright cards fanned out.
              opacity: 1 - i * 0.18,
            }}
          >
            <PackCardBack art={art} />
          </div>
        );
      })}
    </div>
  );
}
