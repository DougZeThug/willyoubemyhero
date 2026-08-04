import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { HoloCard } from "@/components/holo-card";
import { SealedBack } from "@/components/pack-card-back";
import { CardBackPanel } from "@/components/card-back-panel";
import { SecretBackPanel } from "@/components/secret-back-panel";
import { rarityStyle, type Rarity } from "@/lib/card-rarity";
import { swipeDirection } from "@/lib/zoom";
import type { SecretCardView } from "@/lib/secret-cards";
import type { SecretSlot } from "@/lib/pack";
import { packedByLabel } from "@/lib/card-pulls";
import type { CardUrls, ImageUrlSet } from "@/lib/media";
import type { StatsBundle } from "@/lib/card-stats";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

/** A roster card turns over at the house speed. */
export const FLIP_MS = 500;
/**
 * The secret takes more than twice as long.
 *
 * This is the one card on the screen nobody has seen before, and the only one
 * whose turn is the payoff rather than a way of getting at the stats on the back.
 */
export const SECRET_FLIP_MS = 1100;

type StandParticipant = {
  id: string;
  participant_id: string;
  running_order: number;
  bib_number: number | null;
  selected_draft_position: number | null;
  participant?: { name?: string | null; trash_talk_quote?: string | null } | null;
};

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
  secretRarity: Rarity;
}): React.CSSProperties {
  const { peeking, onSecret, isRevealed, rarity, secretRarity } = args;
  const style: Record<string, string> = { "--seal-edge": secretRarity.border };
  if (peeking && !onSecret) {
    style.boxShadow = `inset 0 0 0 6px ${rarity.border}, 0 0 40px ${rarity.border}`;
  } else if (onSecret && isRevealed) {
    style.boxShadow = `0 0 60px -10px ${secretRarity.border}`;
  }
  return style as React.CSSProperties;
}

/** Where the eye should be: which card of how many, and which are already turned. */
function StepDots({ total, at, accent }: { total: number; at: number; accent: string }) {
  return (
    <div className="flex items-center justify-center gap-1.5" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn("h-1.5 rounded-full transition-all", i === at ? "w-5" : "w-1.5")}
          style={{ background: i <= at ? accent : "oklch(1 0 0 / 20%)" }}
        />
      ))}
    </div>
  );
}

/**
 * The reveal stand — one card at a time, face-down, until you turn it.
 *
 * Deliberately not the final grid. Laying all four out at once spends the payoff
 * before it has been earned: the columns are where the pack ends up, and getting
 * there is the thing being animated.
 */
export function PackStand({
  pack,
  bundle,
  cursor,
  cards,
  rarities,
  revealed,
  universalBack,
  pullCounts,
  secretSlot,
  secret,
  secretRarity,
  secretRevealed,
  secretDuplicate,
  secretPeeking,
  peeking,
  busy,
  fromPack = false,
  onReveal,
  onRevealSecret,
  onAdvance,
}: {
  pack: StandParticipant[];
  bundle: StatsBundle | null | undefined;
  cursor: number;
  cards: Record<string, CardUrls> | undefined;
  rarities: Map<string, Rarity>;
  revealed: number[];
  universalBack: ImageUrlSet | null;
  pullCounts: Record<string, number> | undefined;
  secretSlot: SecretSlot;
  secret: SecretCardView | null;
  secretRarity: Rarity;
  secretRevealed: boolean;
  secretDuplicate: boolean;
  secretPeeking: boolean;
  peeking: boolean;
  /** True while "Reveal all" is driving, so a tap cannot cut across it. */
  busy: boolean;
  /**
   * The stand is mounting straight out of the opening ceremony.
   *
   * The house entrance slides in from the right, which is right for stepping from
   * one card to the next and wrong for the first one: the ceremony has just
   * gathered a deck onto this exact mark, so a card arriving from off-screen
   * reads as the deck having been thrown away. Only the first mount — after that
   * the sequence is stepping again and the slide is correct.
   */
  fromPack?: boolean;
  onReveal: (i: number) => void;
  onRevealSecret: () => void;
  onAdvance: () => void;
}) {
  const reduced = usePrefersReducedMotion();
  const onSecret = cursor >= pack.length;
  const ep = onSecret ? null : pack[cursor];
  const isRevealed = onSecret ? secretRevealed : revealed.includes(cursor);

  // Whether the card may show its own back yet.
  //
  // Revealing swaps the back face from the sealed wrapper to the stats panel, and
  // the back is still facing the viewer for the first half of the turn. Held
  // until the card is front-on, so the swap happens somewhere nobody is looking.
  const [settled, setSettled] = useState(false);
  const [flipped, setFlipped] = useState(false);
  // Latched on the first render, so only the card the ceremony handed over gets
  // the gather entrance. Every card after it is a step, and a step slides.
  const firstMountRef = useRef(true);
  const gathered = fromPack && firstMountRef.current;
  useEffect(() => {
    firstMountRef.current = false;
  }, []);

  useEffect(() => {
    setSettled(false);
    setFlipped(false);
  }, [cursor]);

  useEffect(() => {
    if (!isRevealed) return;
    if (reduced) {
      setSettled(true);
      return;
    }
    const ms = onSecret ? SECRET_FLIP_MS : FLIP_MS;
    const t = setTimeout(() => setSettled(true), ms + 40);
    return () => clearTimeout(t);
  }, [isRevealed, onSecret, reduced]);

  // The card is mid-ceremony: turned over already in everything but appearance.
  const holding = onSecret ? secretPeeking : peeking;
  const canAdvance = isRevealed && !busy && !holding;

  // The step gesture. Swiping the card away is how you move on — there is no
  // Next button — so the whole stand reads the throw, not just the card.
  const swipeRef = useRef<{ id: number; x: number; y: number; at: number } | null>(null);
  // A swipe can end in a click the browser synthesises over whatever the finger
  // lifted on, and the card underneath must not also treat that as a tap —
  // same trap useCardZoom swallows. Cleared again on the next pointerdown,
  // because a touch drag produces no click at all and a stale flag here would
  // eat the next genuine tap.
  const swallowClickRef = useRef(false);

  function handleSwipeDown(e: React.PointerEvent) {
    swallowClickRef.current = false;
    swipeRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, at: Date.now() };
  }
  function handleSwipeUp(e: React.PointerEvent) {
    const d = swipeRef.current;
    swipeRef.current = null;
    if (!d || d.id !== e.pointerId) return;
    const dir = swipeDirection(e.clientX - d.x, e.clientY - d.y, Date.now() - d.at);
    if (dir === 0) return;
    // Swallowed for either direction, advanced or not: a throw across a
    // face-down card must not fall through and run the reveal ceremony.
    swallowClickRef.current = true;
    if (dir === 1 && canAdvance) onAdvance();
  }
  function handleSwipeClickCapture(e: React.MouseEvent) {
    if (!swallowClickRef.current) return;
    swallowClickRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  }

  // Desktop has no natural swipe; the arrow key is the same step.
  useEffect(() => {
    if (!canAdvance) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") onAdvance();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canAdvance, onAdvance]);

  const rarity = onSecret ? secretRarity : (rarities.get(ep?.id ?? "") ?? rarityStyle("base"));
  const name = onSecret ? (secret?.name ?? "Secret") : (ep?.participant?.name ?? "—");
  const showStats = isRevealed && settled;

  const heading = onSecret ? "One More Card" : `Card ${cursor + 1} of ${pack.length}`;

  return (
    <div className="relative flex flex-col items-center gap-3">
      {/* Everything else on the page steps back for the fourth card. */}
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

      <div
        className="relative z-10 flex w-full flex-col items-center gap-3"
        onPointerDown={handleSwipeDown}
        onPointerUp={handleSwipeUp}
        onPointerCancel={() => {
          swipeRef.current = null;
        }}
        onClickCapture={handleSwipeClickCapture}
      >
        <div className="text-center">
          <div
            className="font-display text-[10px] font-black uppercase tracking-[0.3em]"
            style={{ color: onSecret ? secretRarity.accent : undefined }}
          >
            {heading}
          </div>
          <p className="mt-1 h-4 text-[10px] leading-snug text-muted-foreground">
            {secretPeeking || (peeking && !onSecret)
              ? ""
              : onSecret
                ? secretSlot === "pending"
                  ? "Checking the wrapper…"
                  : isRevealed
                    ? "Swipe to see the whole pack"
                    : "Not on the roster. One a day, and it's yours for good."
                : isRevealed
                  ? "Swipe for the next card · tap for the back"
                  : "Tap the card to turn it"}
          </p>
          {(peeking || secretPeeking) && (
            <p
              className="mt-1 text-[10px] font-bold uppercase tracking-[0.3em]"
              style={{ color: rarity.accent }}
            >
              {onSecret ? "Something else…" : "Last card…"}
            </p>
          )}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={onSecret ? "secret" : (ep?.id ?? cursor)}
            initial={
              gathered
                ? { opacity: 0, x: 0, scale: reduced ? 1 : 0.94 }
                : { opacity: 0, x: reduced ? 0 : 64, scale: 0.94 }
            }
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: reduced ? 0 : -64, scale: 0.94 }}
            transition={{ type: "spring", stiffness: 240, damping: 26 }}
            // Sized off the viewport's *height*, not just its width. HoloCard
            // derives its height from its width via aspect-ratio, so on a short
            // phone a 300px-wide card is 420px tall and pushes the name and the
            // step dots below the fold.
            className="w-full max-w-[min(280px,calc((100svh-21rem)*5/7))]"
          >
            {onSecret && secretSlot === "pending" ? (
              <div className="wax-foil flex aspect-[5/7] w-full animate-pulse items-center justify-center rounded-xl border border-white/15" />
            ) : onSecret && !secret ? null : (
              <motion.div
                // The layout id is what carries this card into its column when the
                // sequence ends. On a wrapper, never on HoloCard itself, whose
                // subtree is preserve-3d and projects badly.
                layoutId={`pack-card-${onSecret ? "secret" : ep!.id}`}
                animate={secretPeeking && !reduced ? { scale: 1.06 } : { scale: 1 }}
                transition={{ duration: 0.9 }}
                className={cn(
                  "relative rounded-xl",
                  // Only while sealed: a breathing ring on a card you are already
                  // looking at is a notification badge, not anticipation.
                  onSecret && !isRevealed && "secret-seal",
                  onSecret && isRevealed && !settled && "secret-reveal-sweep",
                  onSecret && isRevealed && secretDuplicate && "secret-dupe-shimmer",
                  peeking && !onSecret && !reduced && "animate-pulse",
                )}
                style={standStyle({ peeking, onSecret, isRevealed, rarity, secretRarity })}
              >
                <HoloCard
                  // Mounted while the card is still face-down, so the art is
                  // decoded before the turn rather than during it. The front face
                  // is backface-hidden and explicitly `invisible` until the flip
                  // passes edge-on, so nothing shows through early.
                  frontUrl={onSecret ? (secret?.artUrl ?? null) : (cards?.[ep!.id]?.front ?? null)}
                  backUrl={
                    showStats
                      ? onSecret
                        ? universalBack
                        : (cards?.[ep!.id]?.back ?? null)
                      : universalBack
                  }
                  name={name}
                  rarity={rarity}
                  cacheKey={onSecret ? (secret?.id ?? "secret") : ep!.id}
                  tilt="hero"
                  flipMs={onSecret ? SECRET_FLIP_MS : FLIP_MS}
                  faceDown={!isRevealed}
                  flipped={isRevealed ? flipped : false}
                  onFlippedChange={isRevealed ? setFlipped : undefined}
                  backContent={
                    showStats ? (
                      onSecret && secret ? (
                        <SecretBackPanel card={secret} rarity={secretRarity} />
                      ) : (
                        <CardBackPanel ep={ep!} bundle={bundle} rarity={rarity} />
                      )
                    ) : (
                      <SealedBack />
                    )
                  }
                  // A card still face-down owns its tap: turning it has to run the
                  // ceremony, not just rotate quietly. Handing the tap back once
                  // revealed is what re-arms HoloCard's own flip, so examining the
                  // back needs no code here.
                  //
                  // Dropped during the hold and while the automatic run owns the
                  // sequence. A card holds face-down for 900ms (1600ms for the
                  // secret) before it turns, and every tap in that window used to
                  // start another ceremony over the same card.
                  onClick={
                    isRevealed || holding || busy
                      ? undefined
                      : onSecret
                        ? onRevealSecret
                        : () => onReveal(cursor)
                  }
                  // A horizontal throw is the stand's own gesture now — it means
                  // "next card", read by the wrapper above — so the card must not
                  // also answer to it. Same split as the player detail page.
                  flickToFlip={false}
                />
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Reserved height, so turning a card never shunts the dots below it. */}
        <div className="flex min-h-12 flex-col items-center justify-start gap-0.5 text-center">
          <AnimatePresence>
            {isRevealed && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                <div className="font-display text-sm font-black uppercase leading-tight tracking-wide">
                  {name}
                </div>
                {onSecret ? (
                  <div
                    className="text-[9px] font-bold uppercase tracking-[0.25em]"
                    style={{ color: secretDuplicate ? undefined : secretRarity.border }}
                  >
                    {secretDuplicate
                      ? "Already yours — this one's just showing off"
                      : "Secret · Not on the roster"}
                  </div>
                ) : (
                  <>
                    <div
                      className="text-[10px] font-bold uppercase tracking-[0.2em]"
                      style={{ color: rarity.accent }}
                    >
                      {rarity.label}
                    </div>
                    {packedByLabel(pullCounts?.[ep!.id]) && (
                      <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
                        {packedByLabel(pullCounts?.[ep!.id])}
                      </div>
                    )}
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <StepDots
          total={pack.length + (secretSlot === "hidden" || secretSlot === "gated" ? 0 : 1)}
          at={cursor}
          accent={onSecret ? secretRarity.accent : "oklch(0.82 0.14 210)"}
        />
      </div>
    </div>
  );
}
