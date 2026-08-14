import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { HoloCard } from "@/components/holo-card";
import { SealedBack } from "@/components/pack-card-back";
import { CardBackPanel } from "@/components/card-back-panel";
import { SecretBackPanel } from "@/components/secret-back-panel";
import { rarityStyle, type Rarity } from "@/lib/card-rarity";
import { cardBadge, type Edition } from "@/lib/card-edition";
import { swipeDirection } from "@/lib/zoom";
import { StandDeck, StandEntrance } from "@/components/stand-entrance";
import { RevealAmbience } from "@/components/reveal-ambience";
import { ambienceStrength } from "@/lib/reveal-ambience";
import { burst } from "@/lib/card-confetti";
import { cue } from "@/lib/card-sfx";
import { canFly, type PackHandoff, type SlotRect } from "@/lib/pack-handoff";
import type { SecretCardView } from "@/lib/secret-cards";
import { secretTierCaption, secretTierStyle } from "@/lib/secret-rarity";
import { secretTakesTheStand, type SecretSlot } from "@/lib/pack";
import {
  secretOwnsStage,
  stageCard,
  standPhaseNext,
  standPhaseTimer,
  STAND_BEAT,
  type StandEvent,
  type StandPhase,
} from "@/lib/stand-phase";
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

/**
 * How long the secret's impact lasts.
 *
 * Short. A flash and a shake are punctuation, and anything long enough to watch
 * stops being an impact and becomes an effect — the confetti afterwards is what
 * carries the celebration.
 */
const SLAM_MS = 460;

/**
 * How long the last roster card takes to leave, on its way to the secret.
 *
 * Authored rather than emergent, because the sequence waits on it: `clearing`
 * ends when this exit reports in, so its length has to be a number rather than
 * whatever a spring happens to settle at. Long enough to read as the card being
 * taken off the stand, short enough that the bare beat after it is still the
 * pause somebody notices.
 */
const HANDOVER_EXIT_MS = 260;

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
  editions = {},
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
  onSecretStaged,
  onReveal,
  onRevealSecret,
  onAdvance,
}: {
  pack: StandParticipant[];
  bundle: StatsBundle | null | undefined;
  cursor: number;
  cards: Record<string, CardUrls> | undefined;
  rarities: Map<string, Rarity>;
  /**
   * The finish on each card in the pack, by event_participant id. Defaults to an
   * empty map so a caller that has none — and every existing test — keeps
   * rendering standard cards.
   *
   * Never consulted on the secret's step: a secret carries the prism ring and no
   * edition frame, the reciprocal of the rule that no earned tier wears the ring.
   */
  editions?: Record<string, Edition>;
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
  /**
   * The secret is on the stand and may be turned.
   *
   * Fired when the phase machine finishes the handover — the last roster card
   * genuinely unmounted, the bare beat spent. The automatic run needs this
   * because the handover ends on an animation callback rather than on a clock,
   * so any fixed delay guessed against it is a race the run can lose silently:
   * it would turn a card that is not there yet and finish without ever showing
   * the one it exists to show.
   */
  onSecretStaged?: () => void;
  onReveal: (i: number) => void;
  onRevealSecret: () => void;
  onAdvance: () => void;
}) {
  const reduced = usePrefersReducedMotion();
  /**
   * The cursor has walked onto the secret's slot.
   *
   * Where the sequence *is*, which is not the same as what is on screen — see
   * `onSecret` below. Only the fake ending reads this one.
   */
  const atSecret = cursor >= pack.length;

  /**
   * Where the stand is between the last roster card and the secret.
   *
   * The rules live in `src/lib/stand-phase.ts`, and the note at the top of that
   * file is the whole history: this used to be a `finale` string set from a
   * passive effect with `secretSlot` in its dependency list and no latch, which
   * both lagged the cursor by a commit and replayed the fake ending every time
   * the slot moved — putting the last roster card back on screen over the
   * secret. Neither is expressible now.
   *
   * Mounting straight onto the secret's slot is a reload rather than a step:
   * somebody coming back to a card they already knew about. They get the secret
   * outright — no pretence, and no bare stage to sit through for a handover that
   * never happened, because there is no roster card here to clear.
   */
  const [phase, setPhase] = useState<StandPhase>(() => (atSecret ? "secret" : "roster"));
  const send = (ev: StandEvent) => setPhase((at) => standPhaseNext(at, ev));

  /**
   * Whether this run actually walked to the secret's slot.
   *
   * Only a run that did has earned the twist. Written on every render with a
   * roster card on the stand rather than only on the step off one, so a stand
   * that mounts on a roster card and is stepped forward once still counts.
   */
  const cameFromRosterRef = useRef(false);
  if (!atSecret) cameFromRosterRef.current = true;

  /**
   * The phase, reconciled during render rather than from an effect.
   *
   * `atSecret` is computed in render, so a phase derived from it in a passive
   * effect is a commit behind — and for that commit the old value said the
   * secret owned the stage, which mounted its scrim, swapped the card key and
   * leaked the payoff heading before taking it all back. Adjusting state during
   * render is React's own answer to this, and the first commit with `atSecret`
   * true already carries the right phase.
   */
  const lastAtSecret = useRef(atSecret);
  if (lastAtSecret.current !== atSecret) {
    lastAtSecret.current = atSecret;
    if (!atSecret) {
      setPhase("roster");
    } else {
      // A pull that failed, an empty set, or a guest who never claimed all fall
      // straight through to the columns, and a fake ending followed by nothing
      // at all is far worse than no fake ending. `busy` is the automatic run:
      // somebody who pressed "Reveal all" has said they want to get through
      // this, and it would otherwise turn the secret over while the screen still
      // said the pack was finished.
      const pretend =
        secretTakesTheStand(secretSlot) && cameFromRosterRef.current && !reduced && !busy;
      setPhase(standPhaseNext("roster", { type: "atSecret", pretend }));
    }
  }

  // One timer at a time, owned by the phase that needs it. The array this
  // replaces outlived its own phase whenever the effect re-ran.
  useEffect(() => {
    const armed = standPhaseTimer(phase, reduced);
    if (!armed) return;
    // `setPhase` directly rather than `send`: that helper is re-created every
    // render, and depending on it would re-arm this timer on every render
    // instead of on the phase actually changing — which is a beat that never
    // finishes.
    const t = setTimeout(() => setPhase((at) => standPhaseNext(at, armed.event)), armed.ms);
    return () => clearTimeout(t);
  }, [phase, reduced]);

  // The sound of the pack turning out not to be over, on the frame it does.
  useEffect(() => {
    if (phase === "glitch") cue("fakeEnding");
  }, [phase]);

  // Told once per arrival, on the phase and nothing else. Held through a ref
  // because the route re-creates the callback every render, and depending on it
  // would announce the same arrival again on every one of them.
  const stagedRef = useRef(onSecretStaged);
  stagedRef.current = onSecretStaged;
  useEffect(() => {
    if (phase === "secret") stagedRef.current?.();
  }, [phase]);

  /** Which card, if any, the stage is showing. Null is bare, on purpose. */
  const onStage = stageCard(phase);
  // The pack is behaving as though it is finished, or is between cards. Nothing
  // about the fourth card may be on screen — not its heading, not its dot, not
  // its glow. Wider than the old `pretending`, which stopped at the glitch and
  // so let the whole secret presentation light up over a card still exiting.
  const pretending = atSecret && !secretOwnsStage(phase);

  /**
   * The secret is what the screen is actually showing.
   *
   * False through the fake ending *and* through the clearing beat after it, even
   * though the cursor has already walked onto the secret's slot. While the pack
   * is pretending to be finished, the card on the stand is the last roster card,
   * exactly as it was left — that is what a finished pack looks like, and it is
   * the only version of the pretence that holds up. While the stage is being
   * cleared there is no card at all, which is the point: nothing the secret
   * wears may come up until the roster card has genuinely unmounted.
   */
  const onSecret = secretOwnsStage(phase);
  /** Which roster card is on the stand. Clamped, because the cursor may be past it. */
  const shownIndex = Math.min(cursor, pack.length - 1);
  const ep = onStage === "roster" ? pack[shownIndex] : null;
  const isRevealed = onSecret
    ? secretRevealed
    : onStage === "roster" && revealed.includes(shownIndex);
  /**
   * What is on the stand, as an identity rather than a position.
   *
   * The cursor moves onto the secret's slot before the screen does, so anything
   * that must happen once per *card* — resetting the flip, firing the landing
   * burst — has to key on this rather than on `cursor`, or it fires a second time
   * for the roster card still being shown during the pretence.
   *
   * The bare stage gets an identity of its own rather than borrowing the card
   * that just left, so the per-card effects reset across it exactly once.
   */
  const shownKey =
    onStage === "secret"
      ? "secret"
      : onStage === "roster"
        ? (ep?.id ?? String(shownIndex))
        : "bare";

  /**
   * How many cards are still waiting behind the one on the stand.
   *
   * Counted from the card being *shown*, not from the cursor, so the pretence
   * still has the secret stacked behind the last roster card rather than an empty
   * mark. Goes negative on the secret's own step — nothing is behind the last
   * card — and StandDeck reads that as "draw nothing".
   */
  const behind =
    pack.length - shownIndex - 1 + (secretTakesTheStand(secretSlot) && !onSecret ? 1 : 0);

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

  // Keyed on the card being shown rather than on the cursor. The cursor moves
  // onto the secret's slot before the screen does, and resetting there would
  // clear the last roster card's flip mid-pretence — then *not* reset again when
  // the secret genuinely arrives, so its stats panel would swap in during the
  // flip instead of after it.
  useEffect(() => {
    setSettled(false);
    setFlipped(false);
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
  /**
   * The secret's landing, which has to be the loudest thing in the app.
   *
   * The confetti was doing more work than the reveal itself, which is exactly the
   * wrong way round: the confetti is the lap of honour and the *impact* is the
   * event. This is the impact — a blackout, a flash and a shake, all inside the
   * ~200ms either side of the face arriving.
   */
  const [slam, setSlam] = useState(false);
  useEffect(() => {
    if (reduced || !isRevealed) return;
    // Once per card. `settled` flips back and forth across a step, and the
    // secret's own step re-runs this on a cursor that has not moved.
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
    }, ms * 0.86);
    return () => clearTimeout(t);
    // `rarity` is read through a ref so a bundle arriving mid-flip cannot
    // re-schedule the burst and fire it twice.
  }, [isRevealed, onSecret, reduced, shownKey]);

  // The card is mid-ceremony: turned over already in everything but appearance.
  const holding = onSecret ? secretPeeking : peeking;
  const canAdvance = isRevealed && !busy && !holding && !pretending;

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
  // Standard on the secret's step, always: a secret wears the prism ring and
  // never an edition frame.
  const edition = onSecret ? "standard" : (editions[ep?.id ?? ""] ?? "standard");
  editionRef.current = edition;
  rarityRef.current = rarity;
  const name = onSecret ? (secret?.name ?? "Secret") : (ep?.participant?.name ?? "—");
  const showStats = isRevealed && settled;

  // The secret keeps its words — it is the one step whose heading is the event.
  // A roster card gets a position, not a title: the card is the interface, and
  // "CARD 1 OF 3" above it is a web page explaining itself.
  //
  // While the pack is pretending to be over it says so, and says nothing about a
  // fourth card. "One More Card" is the payoff line and must not arrive early —
  // which used to mean "not before the glitch" and now means "not before the
  // card is actually there". Over the bare stage it says nothing at all: a
  // non-breaking space, so the element keeps its height and its test id rather
  // than the column jumping while nothing is on the mark.
  const heading =
    onStage === null
      ? " "
      : pretending
        ? "Pack Complete"
        : onSecret
          ? "One More Card"
          : `${shownIndex + 1} / ${pack.length}`;

  return (
    // The camera shakes when the secret lands, and the *scene* is what shakes —
    // moving the card alone reads as the card wobbling, where moving everything
    // reads as something having hit hard enough to jolt the room. A few pixels
    // is plenty; past about five it stops being an impact and becomes an
    // earthquake, on a phone somebody is holding at arm's length.
    <div className="relative flex flex-col items-center gap-3">
      {/* Everything else on the page steps back for the fourth card — but not
          while the pack is still pretending to be finished. The room going dark
          *is* the tell. */}
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
                background: `radial-gradient(70% 50% at 50% 44%, oklch(1 0 0 / 92%) 0%, ${secretRarity.accent} 42%, transparent 78%)`,
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.95, 0] }}
              transition={{ duration: 0.34, times: [0, 0.18, 1], ease: "easeOut" }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* The moment the pack stops being over, and the dark it leaves behind.
          One flicker of the whole scene, then the room darkening and the
          secret's own colour leaking up from behind the card that is still
          sitting there. Everything the fourth card wears — its heading, its dot,
          its bezel glow — arrives after this, not before.

          Held through `clearing` and `empty` rather than exiting with the
          glitch. Those two phases are the beat where the last roster card leaves
          and nothing has replaced it yet, and a room that snapped back to full
          brightness for it would read as the sequence having ended rather than
          as it holding its breath. Only the flicker belongs to `glitch`; the
          dark belongs to all three. */}
      <AnimatePresence>
        {(phase === "glitch" || phase === "clearing" || phase === "empty") && (
          <motion.div
            aria-hidden
            className="pointer-events-none fixed inset-0 z-0"
            initial={{ opacity: 0 }}
            // The flicker is one-shot and belongs to the phase that earns it. By
            // `clearing` the same element is simply the dark, held steady.
            animate={phase === "glitch" ? { opacity: [0, 1, 0.35, 1] } : { opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={
              phase === "glitch"
                ? { duration: STAND_BEAT.glitch / 1000, times: [0, 0.08, 0.16, 1] }
                : { duration: 0.2 }
            }
          >
            <div className="absolute inset-0 bg-black/70" />
            <motion.div
              className="absolute inset-0"
              style={{
                background: `radial-gradient(46% 34% at 50% 46%, ${secretRarity.accent} 0%, transparent 72%)`,
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.55 }}
              transition={{ duration: STAND_BEAT.glitch / 1000, ease: "easeIn" }}
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
        // Silent while the pack is pretending to be over. A secret-coloured wall
        // behind a screen that says "Pack Complete" gives the whole thing away.
        anticipating={holding && !pretending}
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
            {/* Nothing to say over a bare stage — there is no card to tap. */}
            {onStage === null || secretPeeking || (peeking && !onSecret)
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
          {/* What is left of the pack, waiting behind this card. Gone with the
              card itself over the bare stage — a stack of backs on an empty mark
              is the sequence still holding cards it has just been shown to have
              put down. */}
          {!reduced && onStage !== null && (
            <StandDeck count={behind} art={universalBack} width={slot?.width ?? 0} />
          )}

          {/* `mode="wait"` serialises the two mounts, and `onExitComplete` is
              what the phase machine waits on: the roster card is genuinely
              unmounted before `empty` begins, and the secret cannot arrive until
              after that. So the phase and the DOM cannot disagree — which is the
              whole point, since a phase that ran ahead of the mount is how the
              heading ended up announcing the fourth card over the third one.

              A duplicate `cardExited` from the timer behind this is a no-op by
              design. */}
          <AnimatePresence mode="wait" onExitComplete={() => send({ type: "cardExited" })}>
            {onStage !== null && (
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
                // A tween on the handover, a spring everywhere else — and the
                // difference is load-bearing rather than taste.
                //
                // The phase machine waits on this exit finishing, so how long it
                // takes has to be a number somebody chose. A spring's settle is
                // emergent: ~400ms for these constants, but not a figure you can
                // write down, and anything watching for it is guessing. The step
                // between two roster cards is watching for nothing, so it keeps the
                // spring it has always had.
                //
                // The exiting element carries the props from its last render, and
                // by then the cursor is already on the secret's slot — which is
                // exactly what `atSecret` is, and why it can select the transition
                // the exit will use.
                transition={
                  atSecret
                    ? { duration: reduced ? 0 : HANDOVER_EXIT_MS / 1000, ease: [0.4, 0, 1, 1] }
                    : { type: "spring", stiffness: 240, damping: 26 }
                }
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
                      onSecret && !isRevealed && !pretending && "secret-seal",
                      onSecret && isRevealed && secretDuplicate && "secret-dupe-shimmer",
                      peeking && !onSecret && !reduced && "animate-pulse",
                    )}
                    style={standStyle({ peeking, onSecret, isRevealed, rarity, secretRarity })}
                  >
                    <HoloCard
                      edition={edition}
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
                            <CardBackPanel
                              ep={ep!}
                              bundle={bundle}
                              rarity={rarity}
                              edition={edition}
                            />
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
                            : () => onReveal(shownIndex)
                      }
                      // A horizontal throw is the stand's own gesture now — it means
                      // "next card", read by the wrapper above — so the card must not
                      // also answer to it. Same split as the player detail page.
                      flickToFlip={false}
                    />
                  </motion.div>
                )}
              </motion.div>
            )}
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
                    style={{
                      color: secretDuplicate
                        ? undefined
                        : secretTierStyle(secret?.tier).accent,
                    }}
                  >
                    {secretDuplicate
                      ? "Already yours — this one's just showing off"
                      : secretTierCaption(secret?.tier)}
                  </div>
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
                        <>
                          <div
                            className="text-[10px] font-bold uppercase tracking-[0.2em]"
                            style={{ color: badge.color }}
                          >
                            {badge.headline}
                          </div>
                        </>
                      );
                    })()}
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

        {/* The dot arrives, rather than having been there all along.
            A fourth dot sitting under three roster cards is the sequence telling
            you there is a fourth card before it has earned the right to — and it
            is the reason the old "One More Card" heading was never a surprise.
            So the total counts only what has been admitted to so far. */}
        <StepDots
          total={
            pack.length + (secretSlot === "hidden" || secretSlot === "gated" || pretending ? 0 : 1)
          }
          at={shownIndex}
          accent={onSecret && !pretending ? secretRarity.accent : "oklch(0.82 0.14 210)"}
        />
      </motion.div>
    </div>
  );
}
