import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, type Variants } from "motion/react";
import { PackWrapper } from "@/components/pack-wrapper";
import { PackCardBack } from "@/components/pack-card-back";
import { playPackOpen, playPackBurst, playDeckGather } from "@/lib/card-sfx";
import {
  CEREMONY,
  CEREMONY_MS,
  CEREMONY_START,
  CEREMONY_BASIS,
  ceremonyReached,
  deckTransform,
  fanTransform,
  riseTransform,
  type CeremonyPhase,
} from "@/lib/pack-ceremony";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import type { ImageUrlSet } from "@/lib/media.functions";

/**
 * How long after the ceremony starts a tap is allowed to end it.
 *
 * A rip commits mid-drag, with a finger still on the screen. The pointerup that
 * ends that drag cannot reach the skip — it is not a pointerdown — but a fast
 * double-tap during the drag can, and skipping a ceremony somebody has not seen a
 * single frame of is worse than a dead zone nobody notices.
 */
const SKIP_DEAD_MS = 140;

/** How wide a flying card is, against the pack. Roughly the printed proportion. */
const CARD_W = 0.62;

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
  onTear,
  onDone,
}: {
  seed: string;
  artUrl: ImageUrlSet | null;
  packSize: number;
  year: string;
  /**
   * How many cards fly out.
   *
   * The three in the pack, and deliberately not the daily secret. At the moment
   * the rip commits the secret has not been pulled — it is `pending` at best and
   * `hidden` for a guest whose session has not minted yet — so a fourth back here
   * would be a coin flip. More to the point the stand goes out of its way to keep
   * the fourth card off the screen until the last step, and a fourth foil back in
   * the fan telegraphs it two seconds early.
   */
  slots: number;
  /**
   * The ceremony has begun. Deal the pack now, so the network gets a head start.
   *
   * Returns whether it actually dealt one. It refuses on an empty pack — there is
   * a beat on arrival where the collection has not been reconciled yet and there
   * is nothing to deal from — and a ceremony over a pack that does not exist would
   * play to an empty stage and then latch this component shut for good.
   */
  onTear: () => boolean;
  /** The ceremony is over, by clock or by tap. */
  onDone: () => void;
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

  function finish() {
    if (doneRef.current) return;
    doneRef.current = true;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    onDoneRef.current();
  }

  function skip() {
    if (performance.now() - startedAt.current < SKIP_DEAD_MS) return;
    finish();
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
      finish();
      return;
    }

    // Measured rather than assumed, once, before anything moves.
    const width = boxRef.current?.getBoundingClientRect().width ?? 0;
    if (width > 0) setScale(width / CEREMONY_BASIS);

    setPhase("rip");
    for (const step of CEREMONY.slice(1)) {
      timers.current.push(setTimeout(() => setPhase(step.phase), CEREMONY_START[step.phase]));
    }
    timers.current.push(setTimeout(finish, CEREMONY_MS));

    // Each sound sits on the thing it is the sound of. The pack coming apart is
    // the strip letting go; the burst is the cards actually moving, which is 620ms
    // later — played at `peel` it was a whoosh for something still sitting inside
    // the wrapper.
    timers.current.push(setTimeout(playPackOpen, CEREMONY_START.peel));
    timers.current.push(setTimeout(playPackBurst, CEREMONY_START.launch));
    timers.current.push(setTimeout(playDeckGather, CEREMONY_START.collapse));
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
    if (phase === "rip") skipRef.current?.focus({ preventScroll: true });
  }, [phase]);

  // The preference can be flipped while the ceremony is running — the whole
  // reason usePrefersReducedMotion is a live subscription. Half a production is
  // worse than none, so cut to the end rather than freezing where it stands.
  useEffect(() => {
    // `finish` is re-created every render and is idempotent by way of doneRef, so
    // it is deliberately not a dependency — listing it would re-run this on every
    // render instead of on the preference actually changing.
    if (reduced && begunRef.current) finish();
  }, [reduced]);

  // Which target the cards are animating toward. Four, not seven: the phases are
  // finer than the cards need, and springs cover the ground between them.
  //
  // `rise` and `fan` are two moves rather than one long spring out of the pack,
  // because cards that come *out* and then *open* read as a pack being emptied,
  // where a single move reads as a fan that happened to start small.
  function cardTarget(at: CeremonyPhase | null): "mouth" | "rise" | "fan" | "deck" {
    if (at == null) return "mouth";
    if (ceremonyReached("collapse", at)) return "deck";
    if (ceremonyReached("fan", at)) return "fan";
    if (ceremonyReached("launch", at)) return "rise";
    return "mouth";
  }
  const target = cardTarget(phase);
  // A fan that hangs perfectly still for a quarter of a second reads as a freeze
  // rather than as a pause, so it breathes while it is being looked at.
  const hovering = target === "fan";

  /**
   * Paint order, which the fan cannot get from depth.
   *
   * The mouth clip is a grouping property, so it flattens this subtree and the
   * cards' `z` stops sorting them — left to DOM order, the rightmost card lands on
   * top and the arc reads as a cascade leaning one way rather than as a hand held
   * up. In the fan the middle card is the one nearest the viewer; everywhere else
   * it is a stack, and the top of a stack is the card the stand is about to show.
   */
  function layer(i: number): number {
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
      return {
        x: t.x * scale,
        y: t.y * scale,
        z: t.z,
        rotateX: 8,
        rotateZ: t.rotate,
        scale: 0.78,
        opacity: 1,
        transition: { type: "spring", stiffness: 200, damping: 22, delay: i * 0.055 },
      };
    },
    fan: (i: number) => {
      const t = fanTransform(i, slots);
      return {
        x: t.x * scale,
        y: t.y * scale,
        z: t.z,
        rotateX: -10,
        rotateZ: t.rotate,
        scale: 0.8,
        opacity: 1,
        transition: { type: "spring", stiffness: 190, damping: 21, delay: i * 0.06 },
      };
    },
    deck: (i: number) => {
      const t = deckTransform(i, slots);
      return {
        x: t.x * scale,
        y: t.y * scale,
        z: t.z,
        rotateX: 0,
        rotateZ: t.rotate,
        scale: 0.94,
        opacity: 1,
        // Card 0 goes first and unstaggered. It is the one the stand mounts over,
        // so it is the one that has to be *settled* when the handoff comes — under
        // the old reverse stagger it started last, 90ms into a phase 340ms long,
        // and was still travelling when PackStand took the screen. Paint order is
        // `layer()`'s job, not the stagger's, so nothing is lost by leading with
        // it.
        transition: {
          type: "spring",
          stiffness: 260,
          damping: 30,
          delay: i * 0.04,
        },
      };
    },
  };

  return (
    <>
      {/* Everything else on the page steps back, the same way it does for the
          secret's step on the stand. Fixed, and a sibling of the scene rather than
          an ancestor of it: backdrop-filter is a grouping property, and one over
          the pack would flatten the 3D the shards and the fan are built on. */}
      <AnimatePresence>
        {phase != null && !reduced && (
          <motion.div
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.28 }}
            className="fixed inset-0 z-0 bg-background/80 backdrop-blur-sm"
          />
        )}
      </AnimatePresence>

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
                  boxShadow:
                    "0 22px 36px -14px oklch(0 0 0 / 72%), 0 0 22px -8px oklch(0.82 0.14 210 / 45%)",
                }}
                className="rounded-xl border border-primary/30"
              >
                {/* Nested, so the breath composes with the fan transform rather
                    than overwriting it. */}
                <motion.div
                  className="h-full w-full"
                  animate={
                    hovering ? { y: [0, -5, 0], rotateY: [-2.5, 2.5, -2.5] } : { y: 0, rotateY: 0 }
                  }
                  transition={{
                    duration: 2.4,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: i * 0.3,
                  }}
                >
                  <PackCardBack art={artUrl} />
                </motion.div>
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
