import { useEffect, useMemo, useRef, useState } from "react";
import { motion, type Variants } from "motion/react";
import { PackWrapper } from "@/components/pack-wrapper";
import { PackCardBack } from "@/components/pack-card-back";
import { cue } from "@/lib/card-sfx";
import {
  CEREMONY,
  CEREMONY_MS,
  CEREMONY_START,
  CEREMONY_BASIS,
  ceremonyReached,
  deckTransform,
  fanTransform,
  packJitter,
  riseTransform,
  type CeremonyPhase,
} from "@/lib/pack-ceremony";
import { SECRET_RARITY } from "@/lib/secret-cards";
import type { PackHandoff } from "@/lib/pack-handoff";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";
import type { ImageUrlSet } from "@/lib/media";

/**
 * How long after the ceremony starts a tap is allowed to end it.
 *
 * A rip commits mid-drag, with a finger still on the screen. The pointerup that
 * ends that drag cannot reach the skip — it is not a pointerdown — but a fast
 * double-tap during the drag can, and skipping a ceremony somebody has not seen a
 * single frame of is worse than a dead zone nobody notices.
 */
const SKIP_DEAD_MS = 90;

/** How wide a flying card is, against the pack. Roughly the printed proportion. */
const CARD_W = 0.62;

/**
 * The pause the secret takes before following the roster out, in seconds.
 *
 * Long enough to read as a separate arrival and short enough that the fan still
 * lands inside the phase it has. Sized against `launch`, so it moved with the
 * timeline: at 0.35s it was over half of the phase it has to fit inside. The
 * stand is where the secret's real ceremony happens — a 1600ms hold, a riser and
 * a flip twice the house length — so this is only the hint that there is a fourth
 * card, not the payoff.
 */
const SECRET_BEAT = 0.16;

/**
 * How far apart the cards leave, in seconds per card.
 *
 * Every one of these is a fraction of the phase it plays inside, which is the
 * only thing that keeps them honest: a stagger quoted in absolute seconds silently
 * outruns its phase the moment the timeline is retuned, and a card still waiting
 * to start when its phase ends simply teleports to the next mark. Four cards is
 * the most the pack ever holds, so the last one has to be moving by `3 * step`.
 */
const RISE_STEP = 0.06;
const FAN_STEP = 0.065;
const DECK_STEP = 0.04;

/**
 * The pack opening: the rest of the rip, and the cards coming out of it.
 *
 * Owns the clock. Both halves of the ceremony — the strip letting go and the
 * cards leaving — run off one schedule, because they are one event; two
 * components each reading their own timer would mean lifting a beat into the
 * route, which already carries more load-bearing state than it should.
 *
 * The whole thing is skipped outright under reduced motion: the rip still deals
 * the pack, `onDone` fires in the same tick, and the route steps to the stand —
 * which is exactly what the screen did before the ceremony existed.
 */
export function PackOpening({
  seed,
  artUrl,
  packSize,
  year,
  slots,
  secret = false,
  onTear,
  onDone,
}: {
  seed: string;
  artUrl: ImageUrlSet | null;
  packSize: number;
  year: string;
  /**
   * How many cards fly out. The roster cards dealt, plus the secret when one is
   * coming — see `secret`.
   */
  slots: number;
  /**
   * The last slot is the daily secret rather than a roster card.
   *
   * It comes forward in the fan wearing the rainbow bezel, and that is the *only*
   * thing the ceremony gives away about it: the face is the same universal back
   * every other card in the fan is showing, so which secret it is stays for the
   * stand. The pack is genuinely four cards on a day with a drop in it, and a fan
   * of three was quietly under-counting it.
   */
  secret?: boolean;
  /**
   * The ceremony has begun. Deal the pack now, so the network gets a head start.
   *
   * Returns whether it actually dealt one. It refuses on an empty pack — there is
   * a beat on arrival where the collection has not been reconciled yet and there
   * is nothing to deal from — and a ceremony over a pack that does not exist would
   * play to an empty stage and then latch this component shut for good.
   */
  onTear: () => boolean;
  /**
   * The ceremony is over, by clock or by tap.
   *
   * `from` is where the deck actually was when it let go, so the stand can pick
   * the cards up rather than fade a different card in at a different size. Null
   * when there is nothing to pick up: a skip, reduced motion, or a browser that
   * measures everything as zero.
   */
  onDone: (from: PackHandoff | null) => void;
}) {
  const reduced = usePrefersReducedMotion();
  const [phase, setPhase] = useState<CeremonyPhase | null>(null);
  const startedAt = useRef(0);
  const begunRef = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const doneRef = useRef(false);
  // Read by the skip handler and by every timer, none of which can see fresh
  // props once they are scheduled.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  // The pack is measured rather than assumed. Every offset in pack-ceremony.ts is
  // expressed against a 320px pack, and a phone in a case renders it narrower —
  // scaling here keeps the fan inside the pack's own column, which matters
  // because `html, body` carry `overflow-x: hidden` and a card that escapes the
  // viewport is silently clipped rather than scrollable.
  const boxRef = useRef<HTMLDivElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const [scale, setScale] = useState(1);
  // The flying cards themselves, so the deck can be measured as it is handed on.
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  /**
   * Where the deck actually is, in viewport pixels, at the moment it lets go.
   *
   * Measured rather than derived from `deckTransform`. These cards sit inside a
   * clipped, flattened subtree, under a rotated pack, under two perspectives, at
   * a scale taken off a measured pack width — the browser has already done that
   * sum, and redoing it in the component that catches them could only ever be
   * subtly wrong. `clip-path` clips paint and not boxes, so the rect is exact
   * even while the card is visually cut by the mouth.
   *
   * The width comes from card 0 for every card: `getBoundingClientRect` answers
   * with the axis-aligned box of a *rotated* element, and card 0 is the only one
   * the deck deliberately leaves square.
   */
  function readDeck(): PackHandoff | null {
    const boxes = cardRefs.current.slice(0, slots).map((el) => el?.getBoundingClientRect());
    const front = boxes[0];
    // No cards at all (skipped, or reduced motion), or a browser that measures
    // everything as zero. Both mean there is nothing to hand over.
    if (!front || front.width === 0 || boxes.some((b) => !b)) return null;
    return {
      w: front.width,
      cards: boxes.map((b) => ({ cx: b!.left + b!.width / 2, cy: b!.top + b!.height / 2 })),
    };
  }

  /**
   * End the ceremony.
   *
   * `hand` is whether the stand should catch the deck. It is false for a skip —
   * the rects are perfectly valid mid-flight and flying them would look good, but
   * skip is a cut, and making it cost another 300ms defeats the point of it.
   */
  function finish(hand: boolean) {
    if (doneRef.current) return;
    doneRef.current = true;
    // Measured before the timers are dropped and before anything unmounts; after
    // `onDone` this component is gone and there is nothing left to read.
    const from = hand ? readDeck() : null;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    onDoneRef.current(from);
  }

  function skip() {
    if (performance.now() - startedAt.current < SKIP_DEAD_MS) return;
    finish(false);
  }

  /**
   * The rip has committed. Deal the pack, then run the clock.
   *
   * Driven by setTimeout rather than by motion's own completion callbacks: one
   * clock is far easier to reason about than seven racing springs, and motion
   * does not tick in jsdom, which would make the whole thing untestable.
   */
  function begin() {
    // A pack is torn once. Enter held down repeats the keydown, and a pointer can
    // cross the threshold on more than one move before React re-renders with the
    // handlers already gone.
    if (begunRef.current) return;
    // Always, and first. Dealing the pack is what the tear *is*; the ceremony is
    // only how it looks — and if there is nothing to deal there is nothing to
    // open, so the pack stays sealed and tearable for the next attempt.
    if (!onTear()) return;
    begunRef.current = true;
    startedAt.current = performance.now();

    if (reduced) {
      finish(false);
      return;
    }

    // Measured rather than assumed, once, before anything moves.
    const width = boxRef.current?.getBoundingClientRect().width ?? 0;
    if (width > 0) setScale(width / CEREMONY_BASIS);

    setPhase(CEREMONY[0].phase);
    for (const step of CEREMONY.slice(1)) {
      timers.current.push(setTimeout(() => setPhase(step.phase), CEREMONY_START[step.phase]));
    }
    // Wrapped, not passed bare: setTimeout hands the callback its timer id as
    // the first argument, so `setTimeout(finish, ...)` would call finish(<id>)
    // — truthy, but not the deliberate `true` this reads as.
    timers.current.push(setTimeout(() => finish(true), CEREMONY_MS));

    // Each sound sits on the thing it is the sound of, and every one of them is
    // named for that thing rather than for how it is made. The pack coming apart
    // is the strip letting go; the burst is the cards actually moving, which is a
    // phase later — played at `peel` it was a whoosh for something still sitting
    // inside the wrapper.
    //
    // The first two are new, and they are why the opening no longer starts in
    // silence: the pack is handled, then the seam is heard tightening, before
    // anything is heard tearing.
    cue("packHandle");
    timers.current.push(setTimeout(() => cue("seamTension"), CEREMONY_START.seam));
    timers.current.push(setTimeout(() => cue("packOpen"), CEREMONY_START.rip));
    timers.current.push(setTimeout(() => cue("packBurst"), CEREMONY_START.launch));
    timers.current.push(setTimeout(() => cue("deckGather"), CEREMONY_START.handoff));
  }

  // A ceremony that outlives its screen would call back into a route that has
  // moved on. Nothing else here needs a mount effect: the clock starts on a
  // gesture, not on being rendered.
  useEffect(() => {
    const pending = timers;
    return () => pending.current.forEach(clearTimeout);
  }, []);

  /**
   * Move focus off the pack and onto the skip control.
   *
   * The pack was focused — Enter on it is how a keyboard opens one — and the
   * moment the rip commits it stops being a button and goes aria-hidden. Focus
   * left sitting inside a hidden subtree is both an a11y violation and, in
   * practice, focus silently landing back on the body. Skip is also the only
   * thing there is left to do here, so this is where it belongs.
   */
  useEffect(() => {
    if (phase === CEREMONY[0].phase) skipRef.current?.focus({ preventScroll: true });
  }, [phase]);

  // The preference can be flipped while the ceremony is running — the whole
  // reason usePrefersReducedMotion is a live subscription. Half a production is
  // worse than none, so cut to the end rather than freezing where it stands.
  useEffect(() => {
    // `finish` is re-created every render and is idempotent by way of doneRef, so
    // it is deliberately not a dependency — listing it would re-run this on every
    // render instead of on the preference actually changing.
    if (reduced && begunRef.current) finish(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  // Which target the cards are animating toward. Four, not seven: the phases are
  // finer than the cards need, and springs cover the ground between them.
  //
  // `rise` and `fan` are two moves rather than one long spring out of the pack,
  // because cards that come *out* and then *open* read as a pack being emptied,
  // where a single move reads as a fan that happened to start small.
  function cardTarget(at: CeremonyPhase | null): "mouth" | "rise" | "fan" | "deck" {
    if (at == null) return "mouth";
    if (ceremonyReached("handoff", at)) return "deck";
    if (ceremonyReached("fan", at)) return "fan";
    if (ceremonyReached("launch", at)) return "rise";
    return "mouth";
  }
  const target = cardTarget(phase);
  // A fan that hangs perfectly still for a quarter of a second reads as a freeze
  // rather than as a pause, so it breathes while it is being looked at.
  const hovering = target === "fan";

  /** Whether slot `i` is the daily secret. Always the last one, as on the stand. */
  const isSecret = (i: number) => secret && i === slots - 1;

  const jitter = useMemo(() => packJitter(seed, slots), [seed, slots]);

  /**
   * The shadow a card at depth `i` casts, and the glow it carries.
   *
   * Derived rather than fixed. Every card sharing one shadow is the thing that
   * most makes a stack read as a printed picture of a stack: a card further back
   * is further from whatever it is casting onto, so its shadow is larger, softer
   * and fainter, and its own edge light is dimmer for being behind the one in
   * front of it.
   */
  function cardShadow(i: number): string {
    const back = Math.min(i, 3);
    const drop = `0 ${22 + back * 4}px ${36 + back * 10}px -14px oklch(0 0 0 / ${72 - back * 12}%)`;
    if (isSecret(i)) return `${drop}, 0 0 34px -6px ${SECRET_RARITY.border}`;
    return `${drop}, 0 0 ${22 - back * 4}px -8px oklch(0.82 0.14 210 / ${45 - back * 9}%)`;
  }

  /**
   * Paint order, as a tiebreaker for cards at equal depth.
   *
   * The real sorting is `z` — the perspective on the container makes this a 3D
   * rendering context, where the browser orders by computed depth. But the fan is
   * an arc, so its two outermost cards sit at exactly the same depth as each other
   * and fall back to DOM order, which is how the rightmost one ended up on top and
   * the arc read as a cascade leaning one way. This settles those ties the same way
   * the depths do, so the two never disagree.
   *
   * In the fan that means the middle card, or the secret when there is one, because
   * being held out in front of the others is most of what marks it as different.
   * Everywhere else it is a stack, and the top of a stack is the card the stand is
   * about to show — which leaves the secret at the *back* of the deck, exactly
   * where it belongs, since the stand turns it last.
   */
  function layer(i: number): number {
    if (target === "fan" && isSecret(i)) return (slots + 1) * 10;
    const from = target === "fan" ? Math.abs(i - (slots - 1) / 2) : i;
    return Math.round((slots - from) * 10);
  }

  /**
   * The cards, in four positions.
   *
   * Fully opaque throughout, with no fade anywhere: they are hidden while they are
   * inside the pack because the pack clips them to its own tear line, which is a
   * far better reason for a card not to be visible than it being see-through. A
   * card you can read the pack through is the single thing that most gives away
   * that this is a div and not a card.
   */
  const CARD: Variants = {
    // Lying flat and deep inside the pack, edge-on to the camera and entirely
    // below the tear line, so the mouth clip hides it completely.
    mouth: { x: 0, y: 66 * scale, z: -60, rotateX: 64, rotateZ: 0, scale: 0.62, opacity: 1 },
    rise: (i: number) => {
      const t = riseTransform(i, slots);
      const j = jitter[i];
      return {
        x: t.x * scale,
        y: t.y * scale,
        z: t.z,
        rotateX: 8,
        rotateZ: t.rotate + j.rotate,
        scale: 0.78 * t.scale,
        opacity: 1,
        // The secret waits a beat behind the roster, so it leaves the pack on its
        // own rather than in the crowd. It is already last in the order; this is
        // the gap that makes that legible at speed.
        transition: {
          type: "spring",
          // Softer than a snap. A spring that arrives in 200ms and then waits out
          // the rest of its phase reads as a jump followed by a freeze; this one
          // is still travelling when the eye gets to it.
          stiffness: 160 * j.stiffness,
          damping: 21 * j.damping,
          delay: i * RISE_STEP + (isSecret(i) ? SECRET_BEAT : 0),
        },
      };
    },
    fan: (i: number) => {
      const t = fanTransform(i, slots);
      const j = jitter[i];
      return {
        x: t.x * scale,
        y: t.y * scale,
        // Brought properly forward, in depth rather than in paint order. The
        // perspective on the container makes this a 3D rendering context, and in
        // one of those the browser sorts by computed depth and ignores z-index
        // outright — so `layer()` alone left the secret sharing the *back* of the
        // fan with the far roster card, which is the opposite of the point.
        z: isSecret(i) ? t.z + 60 : t.z,
        // Each card leans its own way out of the plane, not just around it. A fan
        // where every card shares one rotateX is four cutouts on one sheet of
        // glass; a couple of degrees of disagreement is what makes them separate
        // objects.
        rotateX: -10 + j.rotate * 0.9,
        rotateZ: t.rotate + j.rotate,
        // Same nominal size as the rest. Being 60 closer to the camera already
        // renders it about 6% bigger, and stacking an explicit scale on top of
        // that took it to 14% — large enough to read as a different card rather
        // than a nearer one, and wide enough to crowd the edge of a phone.
        scale: 0.8 * t.scale,
        opacity: 1,
        transition: {
          type: "spring",
          stiffness: 150 * j.stiffness,
          damping: 20 * j.damping,
          delay: i * FAN_STEP + (isSecret(i) ? SECRET_BEAT : 0),
        },
      };
    },
    deck: (i: number) => {
      const t = deckTransform(i, slots);
      const j = jitter[i];
      // Card 0 keeps the geometry's own angle exactly. It is the card the stand
      // takes over, and two degrees of charm on it is two degrees of jump at the
      // handoff — the one place in this sequence where being tidy matters more
      // than looking handled.
      const wonk = i === 0 ? 0 : j.rotate;
      return {
        x: t.x * scale,
        y: t.y * scale,
        z: t.z,
        rotateX: 0,
        rotateZ: t.rotate + wonk,
        scale: 0.94 * t.scale,
        opacity: 1,
        // Card 0 goes first and unstaggered. It is the one the stand mounts over,
        // so it is the one that has to be *settled* when the handoff comes — under
        // the old reverse stagger it started last and was still travelling when
        // PackStand took the screen. Paint order is `layer()`'s job, not the
        // stagger's, so nothing is lost by leading with it.
        transition: {
          type: "spring",
          stiffness: 210,
          damping: 28,
          delay: i * DECK_STEP,
        },
      };
    },
  };

  return (
    <>
      {/* The dark room this is played in belongs to PresentationStage, mounted by
          the route — it has to dim the app shell too, which is this component's
          grandparent, and it must stay a sibling of the scene rather than an
          ancestor: backdrop-filter is a grouping property, and one over the pack
          would flatten the 3D the shards and the fan are built on. */}
      <div
        ref={boxRef}
        className="relative z-10 w-full max-w-xs [perspective:1200px] [transform-style:preserve-3d]"
        // pointerdown, not click: on a phone a click is 300ms of waiting, and the
        // gesture this is interrupting was itself a pointer drag.
        onPointerDown={phase != null ? skip : undefined}
      >
        <PackWrapper
          seed={seed}
          artUrl={artUrl}
          packSize={packSize}
          year={year}
          phase={phase}
          onTear={begin}
        >
          {phase != null &&
            !reduced &&
            Array.from({ length: slots }, (_, i) => (
              <motion.div
                key={i}
                ref={(el) => {
                  cardRefs.current[i] = el;
                }}
                data-testid="opening-card"
                custom={i}
                variants={CARD}
                initial="mouth"
                animate={target}
                // Percentages of the pack rather than Tailwind's translate
                // utilities, so motion owns `transform` outright instead of
                // fighting a class for it.
                style={{
                  position: "absolute",
                  left: `${((1 - CARD_W) / 2) * 100}%`,
                  top: "26%",
                  width: `${CARD_W * 100}%`,
                  aspectRatio: "5 / 7",
                  zIndex: layer(i),
                  transformStyle: "preserve-3d",
                  // The secret's own green rather than the app's cyan, and a
                  // deeper one — the same colour it wears on the stand and in the
                  // vault, so it is recognisable before it is readable. Always
                  // the default green, never the card's own foil: the sealed
                  // slot must not leak which look is inside before the reveal.
                  boxShadow: cardShadow(i),
                  borderColor: isSecret(i) ? SECRET_RARITY.border : undefined,
                }}
                className={cn("rounded-xl border", !isSecret(i) && "border-primary/30")}
              >
                {/* Nested, so the breath composes with the fan transform rather
                    than overwriting it.

                    Each card breathes by its own amount and on its own clock. A
                    shared amplitude made the whole fan rise and fall as one
                    object, which reads as a panel being animated rather than as
                    four cards being held. */}
                <motion.div
                  className="h-full w-full"
                  animate={
                    hovering
                      ? {
                          y: [0, -5 * jitter[i].breath, 0],
                          rotateY: [
                            -2.5 * jitter[i].breath,
                            2.5 * jitter[i].breath,
                            -2.5 * jitter[i].breath,
                          ],
                        }
                      : { y: 0, rotateY: 0 }
                  }
                  transition={{
                    duration: 2.4 * jitter[i].breath,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: i * 0.3,
                  }}
                >
                  <PackCardBack art={artUrl} />
                </motion.div>

                {/* The rainbow bezel, the one thing that says "secret" across this
                    whole app. Outside the breathing layer so it stays welded to the
                    card's edge, and the same `.holo-prism-edge` HoloCard mounts —
                    opaque chrome rather than a blend mode, which is the reason it
                    survives being looked at in a garden. */}
                {isSecret(i) && <div className="holo-prism-edge is-spinning" aria-hidden />}
              </motion.div>
            ))}
        </PackWrapper>
      </div>

      {phase != null && !reduced && (
        <>
          {/* The pack itself is hidden from the tree while it comes apart, so
              without this a screen reader is told only that a button vanished. */}
          <p role="status" className="sr-only">
            Opening your pack.
          </p>
          <button
            ref={skipRef}
            type="button"
            onClick={skip}
            // A plain button, with no `role` attribute of its own. The e2e suite
            // finds the card on the stand with `[role="button"][aria-pressed]`,
            // which is an attribute selector — a native button does not match it,
            // and neither do the aria-hidden divs above.
            className="relative z-10 rounded-full border border-white/10 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground outline-none hover:border-primary/50 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary"
          >
            Skip
          </button>
        </>
      )}
    </>
  );
}
