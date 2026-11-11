import { motion, AnimatePresence } from "motion/react";
import { PullRibbon } from "@/components/pull-ribbon";
import { StandDeck, StandEntrance } from "@/components/stand-entrance";
import type { PackHandoff, SlotRect } from "@/lib/pack-handoff";
import type { ImageUrlSet } from "@/lib/media";
import { SLAM_MS, type StandBeat } from "@/lib/stand-view";
import { cn } from "@/lib/utils";

/** How long the held light takes to let go. */
const BLOOM_MS = 280;

/**
 * Everything else on the page steps back for a secret. The room going dark *is*
 * the tell — and it is the only one: the pack gave nothing away, so this is the
 * first the person hears of it.
 */
export function SecretScrim({ onSecret, reduced }: { onSecret: boolean; reduced: boolean }) {
  return (
    <AnimatePresence>
      {onSecret && (
        <motion.div
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.5 }}
          className={cn("fixed inset-0 z-0 bg-background/85", !reduced && "backdrop-blur-sm")}
        />
      )}
    </AnimatePresence>
  );
}

/**
 * The secret landing.
 *
 * Blackout first, so the flash has something to be brighter than, then white
 * through the secret's own colour. This is the frame the whole sequence has been
 * building to and it is allowed to be the loudest thing the app does.
 */
export function SlamFlash({
  slam,
  reduced,
  accent,
}: {
  slam: boolean;
  reduced: boolean;
  /** The card's own colour, which the flash passes through on its way to white. */
  accent: string;
}) {
  return (
    <AnimatePresence>
      {slam && !reduced && (
        <motion.div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-20"
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: SLAM_MS / 1000, ease: "easeOut" }}
        >
          <motion.div
            className="absolute inset-0 bg-black"
            initial={{ opacity: 0.85 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
          />
          <motion.div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(70% 50% at 50% 44%, oklch(1 0 0 / 92%) 0%, ${accent} 42%, transparent 78%)`,
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.95, 0] }}
            transition={{ duration: 0.34, times: [0, 0.18, 1], ease: "easeOut" }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * What is left of the pack, waiting behind this card.
 *
 * A sibling that has to come *before* the card in the slot, so it is its own
 * piece rather than part of what follows it.
 */
export function DeckBehind({
  reduced,
  count,
  art,
  slot,
}: {
  reduced: boolean;
  count: number;
  art: ImageUrlSet | null;
  /** The stand's own measured box, or null before it has been measured. */
  slot: SlotRect | null;
}) {
  if (reduced) return null;
  return <StandDeck count={count} art={art} width={slot?.width ?? 0} />;
}

/**
 * The things that sit over the card in its slot: the beat, the ribbon and the
 * deck arriving.
 *
 * Siblings of the card and never children of it, because the card carries a
 * layoutId and a projected subtree drags its children through the same
 * distortion.
 */
export function StandCardOverlays({
  beat,
  isRevealed,
  settled,
  standCopies,
  climbed,
  entry,
  landing,
  universalBack,
  onLanded,
}: {
  beat: StandBeat;
  isRevealed: boolean;
  settled: boolean;
  standCopies: number | null;
  climbed: { label: string; accent: string } | null;
  entry: { from: PackHandoff; slot: SlotRect } | null;
  landing: boolean;
  universalBack: ImageUrlSet | null;
  onLanded: () => void;
}) {
  return (
    <>
      {/* The beat between "it's Bob" and "…in Gold".

          A sibling of the card and never a child, for the reason the ribbon
          below is one: the card carries a layoutId and a projected subtree
          drags its children through the same distortion.

          A black scrim rather than a brightness filter, and not an opacity on
          anything above the card either. `filter` is a grouping property — an
          element carrying one is flattened out of its 3D context and the flip
          stops being a rotation and becomes a squash (see .holo-turning in
          styles.css) — and `opacity` groups the same way on the very element
          motion is projecting. This composites the face at 60% and touches
          nothing the card is made of.

          `initial` at zero is load-bearing rather than taste:
          usePrefersReducedMotion answers false on the first client commit by
          design, so a stand mounting on an already-revealed card holds for one
          frame before the reduced pass cancels it. Ramping from nothing means
          that frame is invisible.

          pointer-events-none because the card underneath is tappable the
          instant it lands — its back is one tap away — and a hit test would
          otherwise find this instead. */}
      <AnimatePresence>
        {beat === "held" && (
          <motion.div
            aria-hidden
            data-testid="reveal-beat"
            className="pointer-events-none absolute inset-0 rounded-xl bg-black"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.4 }}
            exit={{ opacity: 0 }}
            transition={{ duration: BLOOM_MS / 1000, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>

      {/* Whether this one is new, better than yours, or another one — stamped
          on the frame rather than added to the four lines of caption below.

          A sibling of the card, never a child: the card carries a layoutId
          and flies to its column on the summary, and a projected subtree
          drags its children through the same distortion. Only once the card
          is actually face up — a ribbon on a back is the answer before the
          question. `settled` and not just `isRevealed`, which goes true on
          the tap: without it the stamp lands on a card still edge-on and
          answers halfway through its own turn. */}
      {isRevealed && settled && standCopies != null && (
        <PullRibbon copies={standCopies} upgrade={climbed} />
      )}

      {/* The deck arriving, over the top of the card it is becoming. */}
      {entry && landing && (
        <StandEntrance
          from={entry.from}
          slot={entry.slot}
          art={universalBack}
          onLanded={onLanded}
        />
      )}
    </>
  );
}
