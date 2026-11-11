import { motion } from "motion/react";
import { HoloCard } from "@/components/holo-card";
import { SealedBack } from "@/components/pack-card-back";
import { CardBackPanel } from "@/components/card-back-panel";
import { SecretBackPanel } from "@/components/secret-back-panel";
import type { StandParticipant } from "@/components/pack-stand";
import type { Rarity } from "@/lib/card-rarity";
import type { Edition } from "@/lib/card-edition";
import type { CardUrls, ImageUrlSet } from "@/lib/media";
import type { SecretCardView } from "@/lib/secret-cards";
import type { StatsBundle } from "@/lib/card-stats";
import { BEAT_MS, FACE_LANDS_AT, flipMsFor, type StandBeat } from "@/lib/stand-view";
import { cn } from "@/lib/utils";

/**
 * The glow the card on the stand is wearing.
 *
 * `--seal-edge` is read by the `.secret-seal` keyframes in styles.css, which is
 * why this leaves the type system's beaten path — a custom property cannot be
 * expressed in CSSProperties.
 */
function standStyle(args: {
  peeking: boolean;
  onSecret: boolean;
  isRevealed: boolean;
  rarity: Rarity;
}): React.CSSProperties {
  const { peeking, onSecret, isRevealed, rarity } = args;
  const style: Record<string, string> = { "--seal-edge": rarity.border };
  if (peeking && !onSecret) {
    style.boxShadow = `inset 0 0 0 6px ${rarity.border}, 0 0 40px ${rarity.border}`;
  } else if (onSecret && isRevealed) {
    style.boxShadow = `0 0 60px -10px ${rarity.border}`;
  }
  return style as React.CSSProperties;
}

function faceClassName(args: {
  landing: boolean;
  onSecret: boolean;
  isRevealed: boolean;
  isDupe: boolean;
  peeking: boolean;
  reduced: boolean;
}) {
  const { landing, onSecret, isRevealed, isDupe, peeking, reduced } = args;
  return cn(
    "relative rounded-xl",
    // Mounted from the first frame so the front art decodes while
    // the deck is still in the air, and held behind `invisible`
    // rather than unmounted so the flip is warm the instant it
    // lands. `visibility: hidden` is not only paint: the card is
    // out of the accessibility tree, out of the tab order and not
    // hit-tested, so neither a thumb nor Playwright can reach a
    // card that is still travelling.
    landing && "invisible",
    // Only while sealed: a breathing ring on a card you are already
    // looking at is a notification badge, not anticipation. This
    // ring is the first thing that says "secret" — the pack's own
    // backs are identical, so the room going dark and the edge
    // starting to breathe are the whole reveal that one is here.
    onSecret && !isRevealed && "secret-seal",
    // A wink, not a parade. An upgraded copy is not a plain
    // duplicate and does not shimmer like one.
    onSecret && isRevealed && isDupe && "secret-dupe-shimmer",
    peeking && !onSecret && !reduced && "animate-pulse",
  );
}

function frontUrlFor(args: {
  onSecret: boolean;
  secret: SecretCardView | null;
  ep: StandParticipant | null;
  cards: Record<string, CardUrls> | undefined;
}) {
  const { onSecret, secret, ep, cards } = args;
  return onSecret ? (secret?.artUrl ?? null) : (cards?.[ep?.id ?? ""]?.front ?? null);
}

function backUrlFor(args: {
  showStats: boolean;
  onSecret: boolean;
  ep: StandParticipant | null;
  cards: Record<string, CardUrls> | undefined;
  universalBack: ImageUrlSet | null;
}) {
  const { showStats, onSecret, ep, cards, universalBack } = args;
  if (!showStats) return universalBack;
  return onSecret ? universalBack : (cards?.[ep?.id ?? ""]?.back ?? null);
}

function backContentFor(args: {
  showStats: boolean;
  onSecret: boolean;
  secret: SecretCardView | null;
  ep: StandParticipant | null;
  bundle: StatsBundle | null | undefined;
  rarity: Rarity;
  edition: Edition | null;
}) {
  const { showStats, onSecret, secret, ep, bundle, rarity, edition } = args;
  if (!showStats) return <SealedBack />;
  if (onSecret && secret) return <SecretBackPanel card={secret} rarity={rarity} />;
  if (ep) {
    return (
      <CardBackPanel ep={ep} bundle={bundle} rarity={rarity} edition={edition ?? "standard"} />
    );
  }
  return <SealedBack />;
}

/**
 * The card on the stand: its layout wrapper and the HoloCard inside it.
 *
 * Everything it needs comes in as a prop, because the keyed wrapper that mounts
 * and unmounts it, the gesture and the effects that drive the reveal all stay in
 * PackStand. This is the part that only ever draws.
 */
export function StandCardFace({
  slotId,
  shownIndex,
  onSecret,
  peeking,
  reduced,
  landing,
  isRevealed,
  isDupe,
  tapRefused,
  showStats,
  beat,
  flipped,
  setFlipped,
  rarity,
  edition,
  secret,
  ep,
  name,
  cards,
  universalBack,
  bundle,
  onReveal,
}: {
  slotId: string;
  shownIndex: number;
  onSecret: boolean;
  peeking: boolean;
  reduced: boolean;
  landing: boolean;
  isRevealed: boolean;
  isDupe: boolean;
  tapRefused: boolean;
  showStats: boolean;
  beat: StandBeat;
  flipped: boolean;
  setFlipped: (next: boolean) => void;
  rarity: Rarity;
  edition: Edition | null;
  secret: SecretCardView | null;
  ep: StandParticipant | null;
  name: string;
  cards: Record<string, CardUrls> | undefined;
  universalBack: ImageUrlSet | null;
  bundle: StatsBundle | null | undefined;
  onReveal: (i: number) => void;
}) {
  return (
    <motion.div
      // The layout id is what carries this card into its column when the
      // sequence ends. On a wrapper, never on HoloCard itself, whose
      // subtree is preserve-3d and projects badly.
      layoutId={`pack-card-${slotId}`}
      animate={onSecret && peeking && !reduced ? { scale: 1.06 } : { scale: 1 }}
      transition={{ duration: 0.9 }}
      className={faceClassName({ landing, onSecret, isRevealed, isDupe, peeking, reduced })}
      style={standStyle({ peeking, onSecret, isRevealed, rarity })}
    >
      <HoloCard
        edition={edition ?? "standard"}
        // Mounted while the card is still face-down, so the art is
        // decoded before the turn rather than during it. The front face
        // is backface-hidden and explicitly `invisible` until the flip
        // passes edge-on, so nothing shows through early.
        frontUrl={frontUrlFor({ onSecret, secret, ep, cards })}
        backUrl={backUrlFor({ showStats, onSecret, ep, cards, universalBack })}
        name={name}
        rarity={rarity}
        tilt="hero"
        flipMs={flipMsFor(onSecret)}
        // A held pull sweeps when it blooms rather than when it
        // lands: fired under the scrim, the sweep would be spent on
        // a card nobody can see.
        shineDelayMs={
          beat === "none" ? undefined : Math.round(flipMsFor(onSecret) * FACE_LANDS_AT) + BEAT_MS
        }
        faceDown={!isRevealed}
        flipped={isRevealed ? flipped : false}
        onFlippedChange={isRevealed ? setFlipped : undefined}
        backContent={backContentFor({
          showStats,
          onSecret,
          secret,
          ep,
          bundle,
          rarity,
          edition,
        })}
        // A card still face-down owns its tap: turning it has to run the
        // ceremony, not just rotate quietly. Handing the tap back once
        // revealed is what re-arms HoloCard's own flip, so examining the
        // back needs no code here.
        //
        // Dropped during the hold, while the automatic run owns the
        // sequence, and while the card before this one is still being
        // revealed. A card holds face-down for 900ms (1600ms for a
        // secret) before it turns, and every tap in that window used to
        // start another ceremony over the same card.
        onClick={isRevealed || tapRefused ? undefined : () => onReveal(shownIndex)}
        // And refused rather than merely unhandled. Without this a tap
        // in those windows falls through to HoloCard's own flip and
        // turns a face-down card to its sealed back — the card would
        // answer, just not with the thing it offered.
        tapDisabled={tapRefused}
        // A horizontal throw is the stand's own gesture now — it means
        // "next card", read by the wrapper above — so the card must not
        // also answer to it. Same split as the player detail page.
        flickToFlip={false}
      />
    </motion.div>
  );
}
