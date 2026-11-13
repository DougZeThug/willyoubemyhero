import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { StandCardFace } from "@/components/stand-card-face";
import { StandHeader } from "@/components/stand-header";
import { StandCaption } from "@/components/stand-caption";
import { DeckBehind, SecretScrim, SlamFlash, StandCardOverlays } from "@/components/stand-overlays";
import { rarityStyle, type Rarity } from "@/lib/card-rarity";
import { editionEarnsTheBeat, type Edition } from "@/lib/card-edition";
import { RevealAmbience } from "@/components/reveal-ambience";
import { ambienceStrength } from "@/lib/reveal-ambience";
import { burst } from "@/lib/card-confetti";
import { cue, playEditionShine } from "@/lib/card-sfx";
import { canFly, type PackHandoff, type SlotRect } from "@/lib/pack-handoff";
import { secretTierEarnsTheBeat } from "@/lib/secret-rarity";
import type { PackSlot } from "@/lib/pack";
import type { PackOutcome } from "@/lib/pack-outcome";
import type { CardUrls, ImageUrlSet } from "@/lib/media";
import type { StatsBundle } from "@/lib/card-stats";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { useStandSwipe } from "@/hooks/use-stand-swipe";
import {
  BEAT_MS,
  type StandSlot,
  type StandParticipant,
  FACE_LANDS_AT,
  SLAM_MS,
  type StandBeat,
  exitVariants,
  flipMsFor,
  gatheredInitial,
  resolveStand,
  steppedInitial,
} from "@/lib/stand-view";
import { cn } from "@/lib/utils";

// Exported from here as they always have been; the numbers themselves live in
// stand-view.ts, beside the helpers that share them.
export { FLIP_MS, SECRET_FLIP_MS } from "@/lib/stand-view";

/**
 * Whether what is on the stand has earned a second beat.
 *
 * The tier half and the finish half take the `known` guard differently, and the
 * asymmetry is the one the confetti gate in pack-outcome.ts already makes: a
 * champion is a champion the moment the pack was dealt, where a finish is only a
 * fact once Postgres has minted it. Gating the whole predicate on the finish
 * being known would make a champion's ceremony depend on how fast the network
 * was, and the one thing worse than no beat is a beat that comes and goes.
 */
function earnsTheBeat(args: {
  onSecret: boolean;
  tier: Rarity["tier"];
  edition: Edition | null;
  secretTier: string | undefined;
}): boolean {
  if (args.onSecret) return secretTierEarnsTheBeat(args.secretTier);
  return (
    args.tier === "champion" ||
    args.tier === "podium" ||
    (args.edition != null && editionEarnsTheBeat(args.edition))
  );
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
          className={cn(
            "h-1 rounded-full transition-[width,background-color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
            i === at ? "w-4" : "w-1",
          )}
          style={{ background: i <= at ? accent : "oklch(1 0 0 / 18%)" }}
        />
      ))}
    </div>
  );
}

/**
 * The reveal stand — one card at a time, face-down, until you turn it.
 *
 * Deliberately not the final grid. Laying all three out at once spends the payoff
 * before it has been earned: the columns are where the pack ends up, and getting
 * there is the thing being animated.
 *
 * A secret is a slot like any other here. It used to be a fourth card with a
 * production of its own — a fake "Pack Complete", a glitch, a bare stage — which
 * only worked because it was always last. Now it can be first, second or third,
 * so it keeps everything that belongs to the card (the breathing ring, the long
 * turn, the slam, the dark room) and drops everything that belonged to its
 * position.
 */
export function PackStand({
  slots,
  bundle,
  cursor,
  cards,
  revealed,
  universalBack,
  pullCounts,
  peeking,
  busy,
  revealing,
  fromPack = false,
  enteringFrom,
  onEntered,
  onReveal,
  onAdvance,
}: {
  slots: StandSlot[];
  bundle: StatsBundle | null | undefined;
  cursor: number;
  cards: Record<string, CardUrls> | undefined;
  revealed: number[];
  universalBack: ImageUrlSet | null;
  pullCounts: Record<string, number> | undefined;
  /** The card on the stand is holding on its glowing edge before it turns. */
  peeking: boolean;
  /** True while "Reveal all" is driving, so a tap cannot cut across it. */
  busy: boolean;
  /**
   * A reveal is in flight — somewhere between the tap that started it and the
   * end of its celebration.
   *
   * Its own prop rather than folded into `busy`, because `busy` also feeds
   * `canAdvance` and would freeze the swipe, the arrow key and the Next button
   * with it. Stepping on while the confetti falls is fine; what is not fine is
   * the *next* card offering a tap that `revealAt`'s latch will discard.
   */
  revealing: boolean;
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
  onAdvance: () => void;
}) {
  const reduced = usePrefersReducedMotion();

  /** Which slot is on the stand. Clamped, because the cursor may be past it. */
  const shownIndex = Math.min(cursor, slots.length - 1);
  const current = slots[shownIndex];
  const { onSecret, ep, secret, rarity, edition, name, outcome, isDupe, standCopies, climbed } =
    resolveStand(current);
  const isRevealed = revealed.includes(shownIndex);
  /**
   * This card is face-down and its tap would go nowhere.
   *
   * `revealing` is the one the stand could not see before: `revealAt` clears
   * `peeking` before its celebration runs, so the step after a hold leaves the
   * next card fully interactive while the latch is still held, and its first tap
   * is dropped on the floor. The three windows are one rule.
   */
  const tapRefused = !isRevealed && (peeking || busy || revealing);
  /**
   * What is on the stand, as an identity rather than a position.
   *
   * Anything that must happen once per *card* — resetting the flip, firing the
   * landing burst — keys on this rather than on `cursor`, so a re-render with
   * the same card in the same slot cannot fire it twice.
   */
  const shownKey = current?.slot.id ?? String(shownIndex);
  /** How many cards are still waiting behind the one on the stand. */
  const behind = slots.length - shownIndex - 1;

  // Whether the card may show its own back yet.
  //
  // Revealing swaps the back face from the sealed wrapper to the stats panel, and
  // the back is still facing the viewer for the first half of the turn. Held
  // until the card is front-on, so the swap happens somewhere nobody is looking.
  const [settled, setSettled] = useState(false);
  const [flipped, setFlipped] = useState(false);
  /** Beat one holds the face at 60%; beat two lets it go. See the effect below. */
  const [beat, setBeat] = useState<StandBeat>("none");
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
  // The stand's own measured box, held separately from any handoff.
  const [slot, setSlot] = useState<SlotRect | null>(null);
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
    // Kept whatever happens, because the resting deck behind the card is sized
    // from it and exists on every path — a resumed pack and a skipped ceremony
    // hand over no geometry, and reading the slot only when there is a flight to
    // fly left those with no stack behind the card at all.
    if (slot && slot.width > 0) setSlot(slot);
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
    // The only sound in the sequence that happens to the *stand* rather than to
    // the pack, which is what makes it read as "the ceremony is over and this
    // card is yours to turn".
    cue("cardLand");
    onEntered?.();
  }

  // Keyed on the card being shown rather than on the cursor, so the flip resets
  // exactly once per card.
  useEffect(() => {
    setSettled(false);
    setFlipped(false);
    setBeat("none");
  }, [shownKey]);

  useEffect(() => {
    if (!isRevealed) return;
    if (reduced) {
      setSettled(true);
      return;
    }
    const ms = flipMsFor(onSecret);
    const t = setTimeout(() => setSettled(true), ms + 40);
    return () => clearTimeout(t);
  }, [isRevealed, onSecret, reduced]);

  /**
   * The spray of light a card throws as it lands.
   *
   * On the frame the face arrives, not when the reveal was requested — the card
   * holds face-down for most of a second before the loud ones turn, and a burst
   * fired at the start of that lands over a card that is still face-down.
   *
   * Every card gets one, scaled by tier. That is the difference between rarity
   * being a label on the card and rarity being something that happens to the
   * screen: a base pull should still feel like something arrived, just quietly.
   */
  const burstFiredRef = useRef<string | null>(null);
  // Assigned during render, below, once `rarity` has been resolved.
  const rarityRef = useRef<Rarity>(rarityStyle("base"));
  // Alongside rarityRef and for the same reason: the burst fires from a timeout
  // that outlives the render it was scheduled in.
  const editionRef = useRef<Edition>("standard");
  // And beside those two for the same reason: the second beat is scheduled from a
  // timeout that outlives the render it was armed in, so a finish landing mid-flip
  // must not be able to re-decide it.
  const twoBeatRef = useRef(false);
  /**
   * A secret's landing, which has to be the loudest thing in the app.
   *
   * The confetti was doing more work than the reveal itself, which is exactly the
   * wrong way round: the confetti is the lap of honour and the *impact* is the
   * event. This is the impact — a blackout, a flash and a shake, all inside the
   * ~200ms either side of the face arriving.
   */
  const [slam, setSlam] = useState(false);
  useEffect(() => {
    if (reduced || !isRevealed) return;
    // Once per card. `settled` flips back and forth across a step.
    if (burstFiredRef.current === shownKey) return;
    const ms = flipMsFor(onSecret);
    const t = setTimeout(() => {
      burstFiredRef.current = shownKey;
      void burst(
        rarityRef.current,
        onSecret ? 1.5 : ambienceStrength(rarityRef.current.tier, editionRef.current),
      );
      if (onSecret) {
        setSlam(true);
        // Picture, sound and haptic inside the same frame. That coincidence is
        // the whole effect — separate them by much more than a frame or two and
        // it stops landing as one impact and becomes three things happening.
        cue("secretImpact");
        setTimeout(() => setSlam(false), SLAM_MS);
      } else {
        cue("cardFace");
      }
    }, ms * FACE_LANDS_AT);
    return () => clearTimeout(t);
    // `rarity` is read through a ref so a bundle arriving mid-flip cannot
    // re-schedule the burst and fire it twice.
  }, [isRevealed, onSecret, reduced, shownKey]);

  /**
   * The second beat.
   *
   * A good pull lands on a face held at 60% for a quarter of a second, and only
   * then does its metal come up. Beat one is the card — the burst above, and the
   * tier's own chime from the route — and beat two is what it turned out to be.
   * A common pull has nothing to say twice and keeps the single beat it had.
   *
   * Scheduled off the same instant the burst is, because that is when the face is
   * actually front-on: the flip's full length is when the rotation stops, a
   * quarter-second after there is anything to look at.
   *
   * The finish's cue fires from here rather than from `revealAt`, where it used to
   * live. That runs at the tap, before the hold and before the turn — the same
   * mistake the landing burst above was moved off the tap to fix.
   */
  const beatFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isRevealed) return;
    // Once per card, like the burst.
    if (beatFiredRef.current === shownKey) return;
    if (!twoBeatRef.current) return;
    const fire = () => {
      beatFiredRef.current = shownKey;
      setBeat("bloomed");
      // A secret's own bell rang at the top of its turn and its impact landed a
      // beat ago; a fifth sound on the same card is noise rather than a second
      // beat. Its second beat is the ring blooming out of the flash.
      if (!onSecret) playEditionShine(editionRef.current);
    };
    // Nothing is held back, so there is nothing to release — but a cue is not a
    // motion setting (see the note at the top of card-sfx.ts) and it still belongs
    // to this card, so it lands on the beat the card was turned.
    if (reduced) {
      fire();
      return;
    }
    setBeat("held");
    const ms = flipMsFor(onSecret);
    const t = setTimeout(fire, ms * FACE_LANDS_AT + BEAT_MS);
    return () => clearTimeout(t);
    // Deliberately the same deps as the burst above, and `beat` is not among them:
    // this effect only writes that value, and listing it would re-run the effect on
    // its own write — clearing the timeout it had just armed. `beatFiredRef` is
    // what keeps the beat to one per card without needing it in the list.
  }, [isRevealed, onSecret, reduced, shownKey]);

  // The card is mid-ceremony: turned over already in everything but appearance.
  const canAdvance = isRevealed && !busy && !peeking;

  // The step gesture, and the card following the finger through it.
  const { dragX, exitX, handlers } = useStandSwipe({ reduced, canAdvance, onAdvance, shownKey });

  // Desktop has no natural swipe; the arrow key is the same step.
  useEffect(() => {
    if (!canAdvance) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") onAdvance();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canAdvance, onAdvance]);

  editionRef.current = edition ?? "standard";
  rarityRef.current = rarity;
  twoBeatRef.current = earnsTheBeat({
    onSecret,
    tier: rarity.tier,
    edition,
    secretTier: secret?.tier,
  });
  const showStats = isRevealed && settled;

  // A position, not a title: the card is the interface, and "CARD 1 OF 3" above
  // it is a web page explaining itself. A secret keeps the same position — that
  // it is a secret is the card's news to break, not the heading's.
  const heading = `${shownIndex + 1} / ${slots.length}`;

  return (
    // The camera shakes when a secret lands, and the *scene* is what shakes —
    // moving the card alone reads as the card wobbling, where moving everything
    // reads as something having hit hard enough to jolt the room. A few pixels
    // is plenty; past about five it stops being an impact and becomes an
    // earthquake, on a phone somebody is holding at arm's length.
    <div className="relative flex flex-col items-center gap-3">
      <SecretScrim onSecret={onSecret} reduced={reduced} />

      <SlamFlash slam={slam} reduced={reduced} accent={rarity.accent} />

      {/* The room reacting to whatever is on the stand. Behind the card, never on
          it: the card already carries a bezel, a foil and an edge light, and a
          fourth glow on the same 280 pixels is how a reveal ends up busy rather
          than big. */}
      <RevealAmbience
        rarity={rarity}
        secret={onSecret}
        revealed={isRevealed}
        anticipating={peeking}
      />

      {/* The shake lives on the card column and nowhere above it.
          Everything rendered above is `position: fixed` and has to stay fixed to
          the *viewport* — and a transformed ancestor becomes the containing block
          for its fixed descendants, so a shake wrapped around the whole stand
          would confine the scrim, the flash and the ambience to this column's own
          box. motion writes a transform even at rest, so that would be true all
          the time rather than only while something was shaking.

          Shaking the column rather than the card is still the point: the card
          alone reads as a wobble, where the column taking the heading and the
          dots with it reads as something having hit hard enough to jolt the room. */}
      <motion.div
        animate={slam && !reduced ? { x: [0, -3, 3, -2, 0], y: [0, 2, -2, 1, 0] } : { x: 0, y: 0 }}
        transition={{ duration: 0.18, ease: "linear" }}
        // touch-pan-y is load-bearing, not styling: touch-action is read at
        // gesture start off the hit element and its ancestors (see the note in
        // holo-card.tsx), and without it a horizontal throw starting beside the
        // card — or on it, when reduced motion strips the card's own
        // touch-action — is a pan the browser may claim. It answers with
        // pointercancel, the swipe dies, and with no Next button that is a
        // player stuck on the card.
        className="relative z-10 flex w-full touch-pan-y flex-col items-center gap-3"
        onPointerDown={handlers.onPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerCancel={handlers.onPointerCancel}
        onClickCapture={handlers.onClickCapture}
      >
        <StandHeader
          heading={heading}
          accent={rarity.accent}
          peeking={peeking}
          onSecret={onSecret}
          isRevealed={isRevealed}
          tapRefused={tapRefused}
          outcome={outcome}
        />

        {/* The slot, not the card.
            It carries the size, so it has one on the commit *before* there is a
            card in it — an entrance measured against a zero-height box starts
            nowhere — and so the deck behind can sit still while the card in front
            of it is stepped through.

            Sized off the viewport's *height*, not just its width. HoloCard
            derives its height from its width via aspect-ratio, so on a short
            phone a 300px-wide card is 420px tall and pushes the name and the step
            dots below the fold.

            21rem of chrome: the header costs its height even while faded out —
            it is `sticky`, which stays in flow — main keeps the bottom nav's
            reserved padding on purpose, and the Next and Reveal all controls
            below (two 44px targets) are part of the budget too. At 19rem
            "Reveal all" sat half below the edge on a 320x568 phone. A 320px card
            still binds from 844px of height up (844 - 336 = 508 * 5/7 = 363).

            max(10rem, ...) is the floor: under 336px of height the calc goes
            negative, which CSS clamps to 0 for a width, collapsing the card in a
            short landscape phone. 160px is above 568px's 166px result, so that
            size is unchanged. */}
        <div
          ref={slotRef}
          className="relative aspect-[5/7] w-full max-w-[min(320px,max(10rem,calc((100svh-21rem)*5/7)))]"
        >
          <DeckBehind reduced={reduced} count={behind} art={universalBack} slot={slot} />

          {/* `mode="wait"` serialises the two mounts, so the card leaving and the
              card arriving never share the mark. */}
          <AnimatePresence mode="wait" custom={exitX}>
            {current && (
              <motion.div
                key={shownKey}
                style={{ x: dragX }}
                // A fact about the card on the stand, for the suite that has to
                // catch the ~300ms beat where it sits face-down before it turns.
                // That used to be read off the "tap the card to turn it" helper
                // line, which stopped being a reliable tell the moment the line
                // started telling the truth: it is blank whenever the tap would
                // be refused, and during "Reveal all" every card's would be.
                data-face-down={isRevealed ? undefined : "true"}
                // While the deck is landing the entrance owns every pixel of motion
                // and the card underneath simply waits. `false` rather than a
                // zeroed initial, so nothing here animates at all and there is no
                // second transition to fight the flight.
                initial={
                  landing ? false : gathered ? gatheredInitial(reduced) : steppedInitial(reduced)
                }
                animate={{ opacity: 1, x: 0, scale: 1 }}
                // A variant, so the exit can read where the finger left the card.
                exit="out"
                variants={exitVariants(reduced)}
                transition={{ type: "spring", stiffness: 240, damping: 26 }}
                className="absolute inset-0"
              >
                <StandCardFace
                  slotId={current.slot.id}
                  shownIndex={shownIndex}
                  onSecret={onSecret}
                  peeking={peeking}
                  reduced={reduced}
                  landing={landing}
                  isRevealed={isRevealed}
                  isDupe={isDupe}
                  tapRefused={tapRefused}
                  showStats={showStats}
                  beat={beat}
                  flipped={flipped}
                  setFlipped={setFlipped}
                  rarity={rarity}
                  edition={edition}
                  secret={secret}
                  ep={ep}
                  name={name}
                  cards={cards}
                  universalBack={universalBack}
                  bundle={bundle}
                  onReveal={onReveal}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <StandCardOverlays
            beat={beat}
            isRevealed={isRevealed}
            settled={settled}
            standCopies={standCopies}
            climbed={climbed}
            entry={entry}
            landing={landing}
            universalBack={universalBack}
            onLanded={land}
          />
        </div>

        {/* Reserved height, so turning a card never shunts the dots below it. */}
        <div className="flex min-h-12 flex-col items-center justify-start gap-0.5 text-center">
          <AnimatePresence>
            {isRevealed && current && (
              <StandCaption
                name={name}
                onSecret={onSecret}
                secret={secret}
                isDupe={isDupe}
                rarity={rarity}
                edition={edition}
                ep={ep}
                pullCounts={pullCounts}
                sellValue={current.sellValue}
              />
            )}
          </AnimatePresence>
        </div>

        {/* Three dots for three cards, whatever kind they are. */}
        <StepDots
          total={slots.length}
          at={shownIndex}
          accent={onSecret ? rarity.accent : "oklch(0.82 0.14 210)"}
        />

        {/* A real control for the step, not just a swipe and an unannounced
            arrow key. The line above it is the hint for a thumb; this is what a
            keyboard, a screen reader, or anybody whose swipe the browser
            claimed as a pan actually has. Kept out of the way rather than out
            of the tree — the gesture is still the intended way through. */}
        <button
          type="button"
          onClick={onAdvance}
          disabled={!canAdvance}
          className="mt-1 min-h-11 rounded-full px-4 text-label font-bold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-primary focus-visible:text-primary disabled:opacity-0"
        >
          Next
        </button>
      </motion.div>
    </div>
  );
}
