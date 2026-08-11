import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { HoloCard } from "@/components/holo-card";
import { SealedBack } from "@/components/pack-card-back";
import { CardBackPanel } from "@/components/card-back-panel";
import { SecretBackPanel } from "@/components/secret-back-panel";
import { rarityStyle, type Rarity } from "@/lib/card-rarity";
import { swipeDirection } from "@/lib/zoom";
import { StandDeck, StandEntrance } from "@/components/stand-entrance";
import { canFly, type PackHandoff, type SlotRect } from "@/lib/pack-handoff";
import type { SecretCardView } from "@/lib/secret-cards";
import { secretTakesTheStand, type SecretSlot } from "@/lib/pack";
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

/**
 * Where the eye should be: which card of how many, and which are already turned.
 *
 * Deliberately faint. This is a position indicator, not a progress bar somebody
 * is meant to be watching — the card is what they came for.
 */
function StepDots({ total, at, accent }: { total: number; at: number; accent: string }) {
  return (
    <div className="flex items-center justify-center gap-1.5 opacity-55" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn("h-1 rounded-full transition-all", i === at ? "w-4" : "w-1")}
          style={{ background: i <= at ? accent : "oklch(1 0 0 / 18%)" }}
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
  enteringFrom,
  onEntered,
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
  /**
   * Where the ceremony left its deck, in viewport pixels.
   *
   * The stand catches it rather than fading a card in beside it. Answers a
   * different question from `fromPack`: this is *geometry*, that is "a ceremony
   * ran". A skip has the second without the first, and must still suppress the
   * slide-in-from-the-right that a step uses.
   */
  enteringFrom?: PackHandoff | null;
  /** The flight has landed; the stand owns the card outright. */
  onEntered?: () => void;
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

  /**
   * Catching the deck the ceremony threw.
   *
   * Measured in a *layout* effect, not a passive one. What this sets is what
   * gives the flying cards their `initial`, and `initial` is read once, on mount
   * — set from a passive effect it would arrive a painted frame late, which is
   * one frame with no card on screen at all, at exactly the moment this whole
   * thing exists to make seamless. Setting state inside a layout effect
   * re-renders synchronously before the browser paints, so the empty commit is
   * never seen. Same precedent as holo-card.tsx measuring its own scene.
   */
  const slotRef = useRef<HTMLDivElement>(null);
  const [entry, setEntry] = useState<{ from: PackHandoff; slot: SlotRect } | null>(null);
  const [landing, setLanding] = useState(false);
  // Read once, on mount. The prop is cleared by the route the moment the flight
  // lands, and re-reading it would unmount the flight halfway through itself.
  const enteringRef = useRef(enteringFrom);

  useLayoutEffect(() => {
    const from = enteringRef.current;
    const slot = slotRef.current?.getBoundingClientRect() ?? null;
    // jsdom measures everything as zero, a skip hands over nothing, and reduced
    // motion never rendered a card to measure. All three mean the stand mounts
    // the way it always did.
    if (!canFly(from, slot)) {
      onEntered?.();
      return;
    }
    setEntry({ from: from!, slot: slot! });
    setLanding(true);
    // Mount-only, deliberately: `onEntered` is re-created every render by the
    // route, and listing it would re-run this and restart the flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function land() {
    setLanding(false);
    onEntered?.();
  }

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

  // The secret keeps its words — it is the one step whose heading is the event.
  // A roster card gets a position, not a title: the card is the interface, and
  // "CARD 1 OF 3" above it is a web page explaining itself.
  const heading = onSecret ? "One More Card" : `${cursor + 1} / ${pack.length}`;

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
        // touch-pan-y is load-bearing, not styling: touch-action is read at
        // gesture start off the hit element and its ancestors (see the note in
        // holo-card.tsx), and without it a horizontal throw starting beside the
        // card — or on it, when reduced motion strips the card's own
        // touch-action — is a pan the browser may claim. It answers with
        // pointercancel, the swipe dies, and with no Next button that is a
        // player stuck on the card.
        className="relative z-10 flex w-full touch-pan-y flex-col items-center gap-3"
        onPointerDown={handleSwipeDown}
        onPointerUp={handleSwipeUp}
        onPointerCancel={() => {
          swipeRef.current = null;
        }}
        onClickCapture={handleSwipeClickCapture}
      >
        <div className="text-center">
          {/* Carries a test id because the e2e suite reads it to know the stand
              has the screen and which step it is on. It used to match the prose
              ("Card 1 of 3") out of the whole document body, which made a copy
              change a five-spec failure with no obvious cause. */}
          <div
            data-testid="stand-step"
            className={cn(
              "font-display font-black uppercase",
              onSecret
                ? "text-[10px] tracking-[0.3em]"
                : "text-[9px] tracking-[0.35em] text-muted-foreground/50",
            )}
            style={{ color: onSecret ? secretRarity.accent : undefined }}
          >
            {heading}
          </div>
          {/* Kept in the tree at every step — it is what a screen reader and the
              e2e suite both read to know what the card wants — but dimmed to the
              edge of legibility once there is a card to look at instead. */}
          <p className="mt-1 h-4 text-[10px] leading-snug text-muted-foreground/55">
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

        {/* The slot, not the card.
            It carries the size, so it has one on the commit *before* there is a
            card in it — an entrance measured against a zero-height box starts
            nowhere — and so the deck behind can sit still while the card in front
            of it is stepped through.

            Sized off the viewport's *height*, not just its width. HoloCard
            derives its height from its width via aspect-ratio, so on a short
            phone a 300px-wide card is 420px tall and pushes the name and the step
            dots below the fold.

            19rem of chrome rather than 21: the "Tap to Reveal" heading above this
            is gone and the step dots below it are thinner. The header still costs
            its height even while it is faded out — it is `sticky`, which stays in
            flow — and main keeps the bottom nav's reserved padding on purpose, so
            this is the whole budget that was freed. */}
        <div
          ref={slotRef}
          className="relative aspect-[5/7] w-full max-w-[min(320px,calc((100svh-19rem)*5/7))]"
        >
          {/* What is left of the pack, waiting behind this card. */}
          {!reduced && (
            <StandDeck
              count={
                pack.length - cursor - 1 + (secretTakesTheStand(secretSlot) && !onSecret ? 1 : 0)
              }
              art={universalBack}
              width={entry?.slot.width ?? 0}
            />
          )}

          <AnimatePresence mode="wait">
            <motion.div
              key={onSecret ? "secret" : (ep?.id ?? cursor)}
              // While the deck is landing the entrance owns every pixel of motion
              // and the card underneath simply waits. `false` rather than a
              // zeroed initial, so nothing here animates at all and there is no
              // second transition to fight the flight.
              initial={
                landing
                  ? false
                  : gathered
                    ? { opacity: 0, x: 0, scale: reduced ? 1 : 0.94 }
                    : { opacity: 0, x: reduced ? 0 : 64, scale: 0.94 }
              }
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: reduced ? 0 : -64, scale: 0.94 }}
              transition={{ type: "spring", stiffness: 240, damping: 26 }}
              className="absolute inset-0"
            >
              {onSecret && secretSlot === "pending" ? (
                <div className="wax-foil flex h-full w-full animate-pulse items-center justify-center rounded-xl border border-white/15" />
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
                    // Mounted from the first frame so the front art decodes while
                    // the deck is still in the air, and held behind `invisible`
                    // rather than unmounted so the flip is warm the instant it
                    // lands. `visibility: hidden` is not only paint: the card is
                    // out of the accessibility tree, out of the tab order and not
                    // hit-tested, so neither a thumb nor Playwright can reach a
                    // card that is still travelling.
                    landing && "invisible",
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
                    frontUrl={
                      onSecret ? (secret?.artUrl ?? null) : (cards?.[ep!.id]?.front ?? null)
                    }
                    backUrl={
                      showStats
                        ? onSecret
                          ? universalBack
                          : (cards?.[ep!.id]?.back ?? null)
                        : universalBack
                    }
                    name={name}
                    rarity={rarity}
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

          {/* The deck arriving, over the top of the card it is becoming. */}
          {entry && landing && (
            <StandEntrance
              from={entry.from}
              slot={entry.slot}
              art={universalBack}
              onLanded={land}
            />
          )}
        </div>

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
