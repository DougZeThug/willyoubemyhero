import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { HoloCard } from "@/components/holo-card";
import { SealedBack } from "@/components/pack-card-back";
import { CardBackPanel } from "@/components/card-back-panel";
import { SecretBackPanel } from "@/components/secret-back-panel";
import { rarityStyle, type Rarity } from "@/lib/card-rarity";
import { cardBadge, editionEarnsTheBeat, type Edition } from "@/lib/card-edition";
import { swipeDirection } from "@/lib/zoom";
import { StandDeck, StandEntrance } from "@/components/stand-entrance";
import { RevealAmbience } from "@/components/reveal-ambience";
import { LevelPips } from "@/components/level-pips";
import { PullRibbon } from "@/components/pull-ribbon";
import { ambienceStrength } from "@/lib/reveal-ambience";
import { burst } from "@/lib/card-confetti";
import { cue, playEditionShine } from "@/lib/card-sfx";
import { canFly, type PackHandoff, type SlotRect } from "@/lib/pack-handoff";
import { secretTierCaption, secretTierEarnsTheBeat, secretTierStyle } from "@/lib/secret-rarity";
import type { PackSlot } from "@/lib/pack";
import { upgradeLabel, type PackOutcome } from "@/lib/pack-outcome";
import { packedByLabel } from "@/lib/card-pulls";
import type { CardUrls, ImageUrlSet } from "@/lib/media";
import type { StatsBundle } from "@/lib/card-stats";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

/** A roster card turns over at the house speed. */
export const FLIP_MS = 500;
/**
 * A secret takes more than twice as long.
 *
 * It is the one card on the screen nobody has seen before, and the only one
 * whose turn is the payoff rather than a way of getting at the stats on the back.
 */
export const SECRET_FLIP_MS = 1100;

/**
 * How long a secret's impact lasts.
 *
 * Short. A flash and a shake are punctuation, and anything long enough to watch
 * stops being an impact and becomes an effect — the confetti afterwards is what
 * carries the celebration.
 */
const SLAM_MS = 460;

/**
 * How far into the turn the face has actually arrived.
 *
 * Not a new number: it is the fraction the landing burst has always used, named
 * here because the second beat has to be measured from the same instant. A card
 * is front-on well before the rotation stops, and a beat measured from the flip's
 * full length would begin a quarter-second after the moment it is punctuating.
 */
const FACE_LANDS_AT = 0.86;

/**
 * The beat a special pull is held on before its metal comes up.
 *
 * Long enough to read as two events — the card, and then what it turned out to
 * be — and short enough that nobody standing in a garden thinks it has stalled.
 */
const BEAT_MS = 250;

/** How long the held light takes to let go. */
const BLOOM_MS = 280;

export type StandParticipant = {
  id: string;
  participant_id: string;
  running_order: number;
  bib_number: number | null;
  selected_draft_position: number | null;
  participant?: { name?: string | null; trash_talk_quote?: string | null } | null;
};

/**
 * One slot of the pack, resolved for the stand and the summary.
 *
 * The route builds these: it is the only thing that holds the roster bundle,
 * the reconciled collection, the dust switch and the secrets query together,
 * and every number here is a decision it has already made. The stand prints
 * and never guesses — a slot missing a count gets no ribbon rather than NEW.
 */
export type StandSlot = {
  slot: PackSlot;
  /** The tier for a roster card; `secretFoil(...)` for a secret. */
  rarity: Rarity;
  /** The finish Postgres minted. Null is "not decided", never "standard". */
  edition: Edition | null;
  outcome: PackOutcome;
  /** Copies held once this one lands, or null when nobody can say. */
  copies: number | null;
  /** What a spare copy would fetch, or null for nothing to say. */
  sellValue: number | null;
  /** The roster row behind a roster slot. Null on a secret. */
  ep: StandParticipant | null;
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
  const onSecret = current?.slot.kind === "secret";
  const ep = current?.ep ?? null;
  const secret = current?.slot.kind === "secret" ? current.slot.card : null;
  const isRevealed = revealed.includes(shownIndex);
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
  const [beat, setBeat] = useState<"none" | "held" | "bloomed">("none");
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
    const ms = onSecret ? SECRET_FLIP_MS : FLIP_MS;
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
    const ms = onSecret ? SECRET_FLIP_MS : FLIP_MS;
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
    const ms = onSecret ? SECRET_FLIP_MS : FLIP_MS;
    const t = setTimeout(fire, ms * FACE_LANDS_AT + BEAT_MS);
    return () => clearTimeout(t);
    // Deliberately the same deps as the burst above, and `beat` is not among them:
    // this effect only writes that value, and listing it would re-run the effect on
    // its own write — clearing the timeout it had just armed. `beatFiredRef` is
    // what keeps the beat to one per card without needing it in the list.
  }, [isRevealed, onSecret, reduced, shownKey]);

  // The card is mid-ceremony: turned over already in everything but appearance.
  const canAdvance = isRevealed && !busy && !peeking;

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

  const rarity = current?.rarity ?? rarityStyle("base");
  // A secret wears the prism ring and never an edition frame; a roster card
  // wears whatever Postgres minted, and standard until that is known.
  const edition: Edition | null = onSecret ? null : (current?.edition ?? null);
  editionRef.current = edition ?? "standard";
  rarityRef.current = rarity;
  twoBeatRef.current = earnsTheBeat({
    onSecret,
    tier: rarity.tier,
    edition,
    secretTier: secret?.tier,
  });
  const name = onSecret ? (secret?.name ?? "Secret") : (ep?.participant?.name ?? "—");
  const showStats = isRevealed && settled;
  const outcome = current?.outcome ?? "duplicate";
  const isDupe = outcome === "duplicate";

  // A position, not a title: the card is the interface, and "CARD 1 OF 3" above
  // it is a web page explaining itself. A secret keeps the same position — that
  // it is a secret is the card's news to break, not the heading's.
  const heading = `${shownIndex + 1} / ${slots.length}`;

  /**
   * The number the ribbon prints for whatever is on the mark.
   *
   * Null rather than 1 when the route has not answered: a stand that assumed
   * would stamp NEW on a card it knows nothing about, which is the one mistake
   * this ribbon must never make.
   */
  const standCopies = current?.copies ?? null;
  const climbed = current && outcome === "upgrade" ? upgradeLabel(current.slot) : null;

  return (
    // The camera shakes when a secret lands, and the *scene* is what shakes —
    // moving the card alone reads as the card wobbling, where moving everything
    // reads as something having hit hard enough to jolt the room. A few pixels
    // is plenty; past about five it stops being an impact and becomes an
    // earthquake, on a phone somebody is holding at arm's length.
    <div className="relative flex flex-col items-center gap-3">
      {/* Everything else on the page steps back for a secret. The room going
          dark *is* the tell — and it is the only one: the pack gave nothing
          away, so this is the first the person hears of it. */}
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

      {/* The secret landing.
          Blackout first, so the flash has something to be brighter than, then
          white through the secret's own colour. This is the frame the whole
          sequence has been building to and it is allowed to be the loudest thing
          the app does. */}
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
                background: `radial-gradient(70% 50% at 50% 44%, oklch(1 0 0 / 92%) 0%, ${rarity.accent} 42%, transparent 78%)`,
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.95, 0] }}
              transition={{ duration: 0.34, times: [0, 0.18, 1], ease: "easeOut" }}
            />
          </motion.div>
        )}
      </AnimatePresence>

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
              "font-display text-label font-black uppercase tracking-[0.08em]",
              !onSecret && "text-muted-foreground/70",
            )}
            style={{ color: onSecret ? rarity.accent : undefined }}
          >
            {heading}
          </div>
          {/* Kept in the tree at every step — it is what a screen reader and the
              e2e suite both read to know what the card wants — but dimmed to the
              edge of legibility once there is a card to look at instead. */}
          <p className="mt-1 h-5 text-meta leading-snug text-muted-foreground/70">
            {peeking
              ? ""
              : onSecret
                ? isRevealed
                  ? "Swipe for the next card · tap for the back"
                  : "Not on the roster. Yours for good."
                : isRevealed
                  ? "Swipe for the next card · tap for the back"
                  : "Tap the card to turn it"}
          </p>
          {peeking && (
            <p
              className="mt-1 text-label font-bold uppercase tracking-[0.08em]"
              style={{ color: rarity.accent }}
            >
              {/* The hold is only ever spent on a card worth it — see peekMs —
                  so the line under it can say why. */}
              {onSecret
                ? "Something else…"
                : outcome === "upgrade"
                  ? "Better than yours…"
                  : "New card…"}
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
          {!reduced && <StandDeck count={behind} art={universalBack} width={slot?.width ?? 0} />}

          {/* `mode="wait"` serialises the two mounts, so the card leaving and the
              card arriving never share the mark. */}
          <AnimatePresence mode="wait">
            {current && (
              <motion.div
                key={shownKey}
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
                <motion.div
                  // The layout id is what carries this card into its column when the
                  // sequence ends. On a wrapper, never on HoloCard itself, whose
                  // subtree is preserve-3d and projects badly.
                  layoutId={`pack-card-${current.slot.id}`}
                  animate={onSecret && peeking && !reduced ? { scale: 1.06 } : { scale: 1 }}
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
                    // looking at is a notification badge, not anticipation. This
                    // ring is the first thing that says "secret" — the pack's own
                    // backs are identical, so the room going dark and the edge
                    // starting to breathe are the whole reveal that one is here.
                    onSecret && !isRevealed && "secret-seal",
                    // A wink, not a parade. An upgraded copy is not a plain
                    // duplicate and does not shimmer like one.
                    onSecret && isRevealed && isDupe && "secret-dupe-shimmer",
                    peeking && !onSecret && !reduced && "animate-pulse",
                  )}
                  style={standStyle({ peeking, onSecret, isRevealed, rarity })}
                >
                  <HoloCard
                    edition={edition ?? "standard"}
                    // Mounted while the card is still face-down, so the art is
                    // decoded before the turn rather than during it. The front face
                    // is backface-hidden and explicitly `invisible` until the flip
                    // passes edge-on, so nothing shows through early.
                    frontUrl={onSecret ? (secret?.artUrl ?? null) : (cards?.[ep?.id ?? ""]?.front ?? null)} // prettier-ignore
                    backUrl={
                      showStats
                        ? onSecret
                          ? universalBack
                          : (cards?.[ep?.id ?? ""]?.back ?? null)
                        : universalBack
                    }
                    name={name}
                    rarity={rarity}
                    tilt="hero"
                    flipMs={onSecret ? SECRET_FLIP_MS : FLIP_MS}
                    // A held pull sweeps when it blooms rather than when it
                    // lands: fired under the scrim, the sweep would be spent on
                    // a card nobody can see.
                    shineDelayMs={
                      beat === "none"
                        ? undefined
                        : Math.round((onSecret ? SECRET_FLIP_MS : FLIP_MS) * FACE_LANDS_AT) +
                          BEAT_MS
                    }
                    faceDown={!isRevealed}
                    flipped={isRevealed ? flipped : false}
                    onFlippedChange={isRevealed ? setFlipped : undefined}
                    backContent={
                      showStats ? (
                        onSecret && secret ? (
                          <SecretBackPanel card={secret} rarity={rarity} />
                        ) : ep ? (
                          <CardBackPanel
                            ep={ep}
                            bundle={bundle}
                            rarity={rarity}
                            edition={edition ?? "standard"}
                          />
                        ) : (
                          <SealedBack />
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
                    // sequence. A card holds face-down for 900ms (1600ms for a
                    // secret) before it turns, and every tap in that window used to
                    // start another ceremony over the same card.
                    onClick={isRevealed || peeking || busy ? undefined : () => onReveal(shownIndex)}
                    // A horizontal throw is the stand's own gesture now — it means
                    // "next card", read by the wrapper above — so the card must not
                    // also answer to it. Same split as the player detail page.
                    flickToFlip={false}
                  />
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

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
              onLanded={land}
            />
          )}
        </div>

        {/* Reserved height, so turning a card never shunts the dots below it. */}
        <div className="flex min-h-12 flex-col items-center justify-start gap-0.5 text-center">
          <AnimatePresence>
            {isRevealed && current && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                <div className="font-display text-sm font-black uppercase leading-tight tracking-wide">
                  {name}
                </div>
                {onSecret ? (
                  <>
                    {/* The pips ride even on a duplicate: the copy in front of
                        you still rolled a level, and hiding it here would make
                        the one moment the level is decided the one place it is
                        not shown.

                        `namesLevel` follows the caption below, which is the only
                        other thing here that says the level out loud — and on a
                        plain duplicate it is replaced by a line that never names
                        it. Without this the pips would announce "Level 5 of 5"
                        and a screen reader would never hear "Mythic" at all. */}
                    <LevelPips tier={secret?.tier} namesLevel={isDupe} className="mt-0.5" />
                    <div
                      className="text-label font-bold uppercase tracking-[0.08em]"
                      style={{ color: isDupe ? undefined : secretTierStyle(secret?.tier).accent }}
                    >
                      {/* An upgrade keeps the level line: the level is the news. */}
                      {isDupe
                        ? "Already yours — this one's just showing off"
                        : secretTierCaption(secret?.tier)}
                    </div>
                    {/* The point of the dupe economy, said at the only moment it
                        lands: the sting is now something worth selling. WORTH,
                        not paid — nothing is credited on a pull any more, so
                        "+N dust" here would be a lie. */}
                    {current.sellValue ? (
                      <div className="text-label font-black uppercase tracking-[0.08em] text-primary">
                        Sell for {current.sellValue}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    {/* A special finish takes this line in its own metal and the
                        tier drops to the muted one beneath — see cardBadge.
                        Nothing extra on a standard finish, which is seven pulls
                        in ten. */}
                    {(() => {
                      const badge = cardBadge(
                        { label: rarity.label, reason: "", accent: rarity.accent },
                        edition,
                      );
                      return (
                        <div
                          className="truncate text-meta font-semibold uppercase tracking-[0.08em]"
                          style={{ color: badge.color }}
                        >
                          {badge.headline}
                        </div>
                      );
                    })()}
                    {ep && packedByLabel(pullCounts?.[ep.id]) && (
                      <div className="text-meta font-semibold text-muted-foreground">
                        {packedByLabel(pullCounts?.[ep.id])}
                      </div>
                    )}
                    {/* The same offer a duplicate secret gets, in the same words,
                        because it is the same ledger. The route only prices a
                        card when it is a spare and dust is on, so reaching it at
                        all is the decision. */}
                    {current.sellValue ? (
                      <div className="text-label font-black uppercase tracking-[0.08em] text-primary">
                        Sell for {current.sellValue}
                      </div>
                    ) : null}
                  </>
                )}
              </motion.div>
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
