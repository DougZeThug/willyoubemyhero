import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { animate, motion, useMotionValue, useTransform, type MotionValue } from "motion/react";
import { Sparkles } from "lucide-react";
import { playTearTick } from "@/lib/card-sfx";
import { seededRng } from "@/lib/format";
import { TEAR, tearProgress } from "@/lib/pack";
import { CEREMONY, ceremonyReached, type CeremonyPhase } from "@/lib/pack-ceremony";
import {
  bodyClipAt,
  coreClipAt,
  mouthClip,
  segmentClipAt,
  segmentLift,
  segmentPose,
  SEGMENT_FLIGHT,
  ripWaypoints,
  RIP_TIMES,
  tearEdge,
  TEAR_SEGMENTS,
  type TearPoint,
} from "@/lib/pack-tear";
import { urlFromSet } from "@/lib/media";
import type { ImageUrlSet } from "@/lib/media";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

/** How often a crinkle fires across the rip, as a fraction of the travel. */
const TICK_EVERY = 0.12;

/**
 * Whether the pack's printed art is on screen yet, asked once for the whole pack.
 *
 * Every layer of the wrapper draws the same picture through a different clip, and
 * each one used to own its own `loaded` flag and its own 300ms fade. That is fine
 * while nothing is moving and wrong the moment the pack comes apart: the layers
 * are supposed to be one continuous image right up to the point they separate,
 * and layers that decide independently when to stop showing the fallback
 * lettering are not. A freshly mounted layer could also flash the lettering for a
 * frame on the exact frame it detached.
 *
 * So the answer is decided here, once, and handed down. Nothing in the wrapper
 * mounts a face mid-ceremony either — every layer exists from the first render —
 * but this is what makes that safe rather than merely true today.
 *
 * The lettering hides on `ready`, never on "an art URL exists". A cached image
 * completes before React attaches onLoad, and an expired signed URL never
 * completes at all — both used to leave a blank foil with the caption already
 * hidden, which is what "the universal back isn't showing" looked like.
 */
function useArtReady(art: string | null) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  // Runs on mount too, so an image the browser already had decoded — which fires
  // its load event before the handler exists — still reports itself.
  const settle = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) setReady(true);
  }, []);
  return {
    /** True once the art is genuinely painted, on every layer at once. */
    ready: !!art && !failed && ready,
    /** Whether to put an `<img>` in the tree at all. */
    showArt: !!art && !failed,
    settle,
    onLoad: () => setReady(true),
    onError: () => setFailed(true),
  };
}

type ArtState = ReturnType<typeof useArtReady>;

/**
 * The printed face of the pack, drawn once per layer.
 *
 * The wax foil underneath is the designed fallback, not a spinner: a slow network
 * gets a beautiful pack rather than a grey box, and an event with no uploaded back
 * gets the same thing permanently.
 */
function PackFace({
  art,
  state,
  size,
  year,
}: {
  art: string | null;
  state: ArtState;
  size: number;
  year: string;
}) {
  return (
    <div className="wax-foil absolute inset-0">
      {state.showArt && (
        <img
          ref={state.settle}
          src={art!}
          alt=""
          aria-hidden
          crossOrigin="anonymous"
          draggable={false}
          onLoad={state.onLoad}
          onError={state.onError}
          // No fade. Every layer flips together off one flag now, and a
          // transition on each of them is a chance for them to disagree for
          // 300ms — which over a pack that is coming apart is the one thing the
          // shared flag exists to prevent.
          className={cn(
            "absolute inset-0 h-full w-full object-cover",
            state.ready ? "opacity-100" : "opacity-0",
          )}
        />
      )}
      <div
        className={cn(
          "relative flex h-full flex-col items-center justify-center gap-2 p-6 text-center",
          // The lettering is the pack's identity until real art is actually on
          // screen. Over a loaded back it is a caption nobody asked for.
          state.ready && "hidden",
        )}
      >
        <Sparkles className="h-8 w-8 text-primary" />
        <div className="font-display text-xs font-black uppercase tracking-[0.35em] text-primary/90">
          Will YOU Be My Hero?
        </div>
        <div className="font-display text-3xl font-black uppercase leading-none">Draft Combine</div>
        <div className="font-display text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
          {size} cards · {year}
        </div>
      </div>
    </div>
  );
}

/**
 * One piece of the torn strip, from sealed through to gone.
 *
 * The same element for the whole ceremony, which is the point. The strip used to
 * be played by three elements in turn — one under the finger, one that finished
 * the rip, and three shards that flew — and each swap mounted a fresh copy of the
 * pack artwork on the exact frame the piece was supposed to be coming apart. This
 * mounts once and never remounts.
 *
 * Four layers, because they are four different jobs and one transform cannot do
 * them all:
 *
 *   flight   x/y/rotate away, once the piece has let go outright
 *   bend     lean, lag and squeeze — how this piece disagrees with its neighbours
 *   curl     the torn edge rolling back, about this piece's own middle
 *   shape    the clip, which is what makes it a piece of the tear at all
 *
 * The clip is innermost on purpose. `clip-path` cuts an element in its own
 * coordinate space, so a clip above a transform would trim the piece back to the
 * pack's outline as soon as it moved; below it, the shape is cut first and the
 * ancestors are free to carry it off the top of the screen.
 */
function TearSegment({
  index,
  edge,
  front,
  seed,
  stripPct,
  bracing,
  flying,
  reduced,
  art,
  artState,
  packSize,
  year,
}: {
  index: number;
  edge: TearPoint[];
  /** 0..1 across the pack. Drives everything below without a React render. */
  front: MotionValue<number>;
  seed: string;
  stripPct: number;
  bracing: boolean;
  flying: boolean;
  reduced: boolean;
  art: string | null;
  artState: ArtState;
  packSize: number;
  year: string;
}) {
  const [from, to] = TEAR_SEGMENTS[index];
  const pose = useMemo(() => segmentPose(seed, index), [seed, index]);
  const flight = SEGMENT_FLIGHT[index];
  const last = TEAR_SEGMENTS.length - 1;

  // This piece pivots about its own middle, on the tear line — not about the
  // pack's centre, which would swing the whole strip through an arc it has no
  // business making.
  const origin = `${((edge[from].x + edge[to].x) / 2).toFixed(1)}% ${stripPct.toFixed(1)}%`;

  // Every one of these is a pure function of the front and nothing else. A
  // transformer that closed over `reduced` would only be re-evaluated the next
  // time the front moved, so flipping the preference mid-tear would leave the
  // old answer on screen — the preference is applied at the style below instead,
  // where it is read on every render.
  const shape = useTransform(front, (f) => segmentClipAt(edge, f, from, to));
  const lift = useTransform(front, (f) => segmentLift(f, index));
  const curl = useTransform(lift, (l) => -pose.curl * l);
  const lean = useTransform(lift, (l) => pose.lean * l);
  const rise = useTransform(lift, (l) => -(10 + pose.lag) * l);
  const squeeze = useTransform(lift, (l) => 1 + (pose.squeeze - 1) * l);
  // Nothing lifts under reduced motion, so the strip simply thins away instead.
  const fade = useTransform(front, (f) => 1 - f);

  // The upper corners easing outward while the pack is braced. Only the two end
  // pieces, and only a pixel and a half: this is the wrapper being stretched, and
  // anything you can actually measure reads as the pack inflating.
  const pull = !bracing || reduced ? 0 : index === 0 ? -1.5 : index === last ? 1.5 : 0;

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        transformOrigin: origin,
        transformStyle: "preserve-3d",
        // Only while it is actually in the air. A drop-shadow over a clipped
        // subtree is one of the more expensive things this screen can ask for,
        // and for the rest of the ceremony there is nothing to cast one.
        filter: flying ? "drop-shadow(0 8px 12px oklch(0 0 0 / 55%))" : undefined,
        willChange: flying ? "transform, opacity" : undefined,
      }}
      initial={false}
      animate={
        flying
          ? {
              x: flight.x,
              y: flight.y,
              // Overshoot on both rotation axes rather than a straight arc. That
              // overshoot is the entire difference between "flies off" and
              // "flutters".
              rotateZ: [0, flight.rz * 0.4, flight.rz * 1.25, flight.rz],
              rotateX: [0, flight.rx * 0.7, flight.rx * 1.3, flight.rx],
              scale: 0.92,
              opacity: [1, 1, 0],
            }
          : { x: pull, y: 0, rotateZ: 0, rotateX: 0, scale: 1, opacity: 1 }
      }
      transition={
        flying
          ? {
              duration: flight.sec,
              delay: index * 0.04,
              ease: [0.16, 0.8, 0.34, 1],
              rotateZ: { times: [0, 0.3, 0.7, 1] },
              rotateX: { times: [0, 0.3, 0.7, 1] },
              opacity: { times: [0, 0.6, 1] },
            }
          : { duration: 0.16, ease: "easeOut" }
      }
    >
      <motion.div
        className="absolute inset-0"
        style={{
          rotateZ: reduced ? 0 : lean,
          y: reduced ? 0 : rise,
          scaleX: reduced ? 1 : squeeze,
          transformOrigin: origin,
        }}
      >
        <motion.div
          className="absolute inset-0"
          style={{
            rotateX: reduced ? 0 : curl,
            transformOrigin: origin,
            transformStyle: "preserve-3d",
          }}
        >
          {/* Rounded as well as clipped, because this layer owns the pack's top
              corners now — it lives outside the box that used to round them, so
              that it can leave. */}
          <motion.div
            className="absolute inset-0 overflow-hidden rounded-2xl"
            style={{ clipPath: shape, opacity: reduced ? fade : 1 }}
          >
            <PackFace art={art} state={artState} size={packSize} year={year} />
          </motion.div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

/**
 * The sealed pack, and the rip that opens it.
 *
 * The gesture is horizontal travel along a perforation near the top, measured
 * from where the finger landed. The version before this compared the pointer's
 * absolute Y against the pack's own top edge, which meant a tap two thirds of the
 * way down opened the pack having travelled nowhere — there was no drag to fail.
 *
 * Once the rip commits the component stops being a control and becomes scenery:
 * `phase` is driven from outside by the ceremony clock, and everything that made
 * this a button is dropped. A pack you can no longer tear must not still announce
 * itself as "Tear the pack open" — and the e2e suite reads exactly that role to
 * mean "still sealed".
 */
export function PackWrapper({
  seed,
  artUrl,
  packSize,
  year,
  phase,
  onTear,
  children,
}: {
  /** Pack seed, so the ragged edge is stable for a given pack. */
  seed: string;
  artUrl: ImageUrlSet | null;
  packSize: number;
  year: string;
  /**
   * Null while the pack is still sealed and tearable; a ceremony phase once the
   * rip has committed.
   */
  phase: CeremonyPhase | null;
  onTear: () => void;
  /**
   * Whatever is coming out of the pack.
   *
   * Rendered here rather than beside the pack because only this component knows
   * where its own mouth is: the children are clipped to the tear line while they
   * are still inside, which is what makes them read as *emerging* rather than as
   * appearing on top.
   */
  children?: React.ReactNode;
}) {
  const packRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: number; x: number } | null>(null);
  const tickRef = useRef(0);
  const reduced = usePrefersReducedMotion();

  /**
   * How far the tear has actually got, 0..1 across the pack.
   *
   * A motion value rather than state, and that is the single most load-bearing
   * decision in this file. Every clip below is a function of it, and a clip is a
   * string: recomputing four of them through React on every pointermove would
   * re-render a subtree holding five copies of the pack artwork sixty times a
   * second. As a motion value the strings are written straight to `style` from
   * motion's own frame loop and React never hears about the drag at all.
   *
   * It is also the thing that makes the rip a rip. This used to be a boolean in
   * all but name — the tear line existed at full width from the first frame and
   * only a rigid rectangle moved — so there was nothing to travel.
   */
  const front = useMotionValue(0);
  /**
   * How far the rip had got when it committed.
   *
   * The ceremony carries the front the rest of the way from here. Zero on the
   * keyboard path, where nothing was dragged and the whole rip is the ceremony's
   * to play.
   */
  const committedAt = useRef(0);

  const stripPct = TEAR.stripH * 100;
  const edge = useMemo(() => tearEdge(seed, stripPct), [seed, stripPct]);
  const art = urlFromSet(artUrl);
  const artState = useArtReady(art);

  /**
   * The beams that escape the tear, as data.
   *
   * Seeded off the pack rather than random, so a re-render mid-ceremony cannot
   * re-roll them underneath the animation that is playing — the same reason the
   * tear edge and the card jitter are seeded.
   */
  const rays = useMemo(() => {
    const rng = seededRng(`${seed}:rays`);
    return Array.from({ length: 5 }, (_, i) => ({
      // Spread across the middle of the mouth, with a little slop, so they are
      // not a comb.
      at: 18 + i * 16 + (rng() * 2 - 1) * 5,
      w: 6 + rng() * 7,
      tilt: (i - 2) * 7 + (rng() * 2 - 1) * 4,
    }));
  }, [seed]);

  const sealed = phase == null;
  // The pack takes the strain before anything comes apart. Two phases of nothing
  // *moving* would be a dead start, so this is where the anticipation lives: a
  // squash, a seam that lights up under tension, the corners easing outward and
  // light already leaking at the point the tear will start from. It is also the
  // beat that makes the rip afterwards read as a release rather than as the first
  // thing that happens.
  const bracing = !sealed && !ceremonyReached("rip", phase);
  // The seam phase itself, not "seam or later". `ceremonyReached` is cumulative,
  // which is right for `shed` and `spilled` — those are one-way doors — and wrong
  // here: the seam is supposed to build, then be blown out by the rip it was
  // announcing. Asked cumulatively it stayed lit at full brightness through the
  // rip, the peel, the fan and the handoff, and the blow-out branch below was
  // unreachable.
  const seaming = phase === "seam";
  // The rip is travelling on its own, from wherever the finger stopped.
  const ripping = phase === "rip";
  // Separation. The front has reached the far edge, the strip is off, and this is
  // the frame the pack recoils on — one event, not two. The gesture alone never
  // gets here: the threshold is 60% of the drag, so left to itself the tear never
  // crosses the last 40% of the pack.
  const shed = !sealed && ceremonyReached("peel", phase);
  // The mouth stops holding on to what came out of it. Timed to the fan, which is
  // the beat the cards stop rising and start spreading — by then they are clear
  // of the pack and the clip has nothing left to hide.
  const spilled = !sealed && ceremonyReached("fan", phase);

  /**
   * The rip finishing on its own.
   *
   * Held exactly where the finger left it through both anticipation phases — the
   * wrapper is the thing under tension during `seam`, and it must not be quietly
   * finishing its own rip while the seam is still announcing one. Then released,
   * across `rip`, and only then.
   *
   * The shaping lives in `ripWaypoints`, where it can be checked: it has to be
   * non-decreasing from any commit point, and a fast swipe can commit anywhere
   * up to the far edge.
   */
  useEffect(() => {
    if (!ripping || reduced) return;
    const controls = animate(front, ripWaypoints(committedAt.current), {
      duration: CEREMONY.find((s) => s.phase === "rip")!.ms / 1000,
      times: [...RIP_TIMES],
      ease: "linear",
    });
    return () => controls.stop();
  }, [ripping, reduced, front]);

  // The front has to be at the far edge for the pieces to fly from, even on the
  // paths that never animated it there — reduced motion, or a phase jump.
  useEffect(() => {
    if (shed) front.set(1);
  }, [shed, front]);

  function end(e: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.id === e.pointerId && e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
    // Short of the threshold the foil springs shut. Losing the progress is the
    // point: a rip you did not finish is a pack you did not open. Animated rather
    // than snapped, because the wrapper is elastic now and elastic things recoil.
    animate(front, 0, { duration: 0.28, ease: [0.22, 1, 0.36, 1] });
  }

  /** Where the leading edge of the tear is, as a percentage across the pack. */
  const frontPct = useTransform(front, (f) => `${(f * 100).toFixed(1)}%`);
  /** The hint fades out as soon as the rip is genuinely under way. */
  const hintOpacity = useTransform(front, (f) => (f > 0.04 ? 0 : 1));
  /**
   * The exposed fibre, brightening as the tear opens over it.
   *
   * A function of the front alone, not of whether the pack is sealed. Torn stock
   * shows its bright core because it has been torn, and how far the tear has got
   * is the only thing that answers that — reading `sealed` here would also mean
   * the value went stale the moment the rip committed, since a transformer is
   * only re-evaluated when its input moves.
   */
  const coreShape = useTransform(front, (f) => coreClipAt(edge, f));
  const coreOpacity = useTransform(front, (f) => Math.min(0.2 + f * 0.6, 0.7));
  const bodyShape = useTransform(front, (f) => bodyClipAt(edge, f));
  /** Light at the leading edge, which only exists while there is one. */
  const frontLeak = useTransform(front, (f) => (f > 0.02 && f < 0.995 ? 1 : 0));

  return (
    <motion.div
      ref={packRef}
      // Dropped wholesale the instant the rip commits, rather than disabled. A
      // sealed pack is a button; an opening one is a short film.
      role={sealed ? "button" : undefined}
      tabIndex={sealed ? 0 : undefined}
      aria-label={sealed ? "Tear the pack open" : undefined}
      aria-hidden={sealed ? undefined : true}
      onKeyDown={
        sealed
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onTear();
              }
            }
          : undefined
      }
      onPointerDown={
        sealed
          ? (e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              dragRef.current = { id: e.pointerId, x: e.clientX };
              tickRef.current = 0;
            }
          : undefined
      }
      onPointerMove={
        sealed
          ? (e) => {
              const drag = dragRef.current;
              const rect = packRef.current?.getBoundingClientRect();
              if (!drag || drag.id !== e.pointerId || !rect) return;

              const p = tearProgress(drag.x, e.clientX, rect.width);
              // Straight onto the motion value: no setState, so no re-render, so
              // the five copies of the pack artwork below are not reconciled
              // sixty times a second while a thumb is moving.
              front.set(p);

              // One crinkle per step of the rip rather than one per pointermove,
              // which would fire sixty times a second and sound like static.
              const tick = Math.floor(p / TICK_EVERY);
              if (tick > tickRef.current) {
                tickRef.current = tick;
                playTearTick();
              }

              if (p >= TEAR.threshold) {
                dragRef.current = null;
                // Where the ceremony has to carry the tear on from.
                committedAt.current = p;
                // The capture used to be released by the pointerup landing on
                // `end()`. From here on this element has no handlers left, so
                // release it now or the capture outlives the gesture that took it
                // and the next tap anywhere on the page goes to a dead node.
                if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                }
                onTear();
              }
            }
          : undefined
      }
      onPointerUp={sealed ? end : undefined}
      onPointerCancel={sealed ? end : undefined}
      className={cn(
        // No overflow-hidden and no background: the torn pieces have to leave this
        // box, and the cards behind it have to be occluded by it in 3D rather than
        // clipped by it in 2D. Both live on the inner box below.
        // Card-shaped, not pack-shaped: the wax foil sits directly over the
        // universal back, and a 3/4 wrapper made the sealed pack a different
        // silhouette from the cards that come out of it.
        "hud-glow relative aspect-[5/7] mx-auto w-full max-w-[260px] rounded-2xl border border-primary/40",
        sealed && "cursor-grab touch-none active:cursor-grabbing",
      )}
      style={{
        transformOrigin: "50% 100%",
        transformStyle: "preserve-3d",
      }}
      initial={false}
      // The squash is the anticipation: a pack braced against the pull, wider and
      // shorter for a moment, before it lets go. Origin at the bottom so it reads
      // as being pressed down onto the table rather than shrinking in place. Tiny
      // on purpose — 3% is under the threshold at which it reads as a wobble and
      // well over the one at which the eye notices something happened.
      //
      // `z: 0` keeps an explicit translateZ on the box, so the pieces inside it
      // inherit the scene camera rather than tumbling flat.
      //
      // The tremble under `seam` is the last thing before the break, and it is
      // deliberately sub-pixel-ish: under a pixel it is invisible, over two it is
      // a phone being shaken. And the kick on separation is the recoil — the pack
      // is holding something that has just let go of it.
      animate={
        reduced
          ? { z: 0, scaleX: 1, scaleY: 1, rotateX: 0, x: 0, y: 0 }
          : bracing
            ? {
                z: 0,
                scaleX: 1.02,
                scaleY: 0.97,
                rotateX: -4,
                x: seaming ? [0, -0.7, 0.6, -0.5, 0.4, 0] : 0,
                y: 0,
              }
            : shed
              ? { z: 0, scaleX: 1, scaleY: 1, rotateX: -4, x: 0, y: [0, 3, 0] }
              : { z: 0, scaleX: 1, scaleY: 1, rotateX: sealed ? 0 : -4, x: 0, y: 0 }
      }
      transition={{
        duration: bracing ? 0.12 : 0.3,
        ease: [0.22, 1, 0.36, 1],
        x: { duration: 0.32, ease: "linear" },
        y: { duration: 0.24, times: [0, 0.35, 1], ease: "easeOut" },
      }}
    >
      {/* Everything that belongs *inside* the pack. Clipped and rounded here so
          the root can let the torn pieces out.

          It dims once its cards are out. An emptied wrapper competing at full
          brightness with the fan in front of it is the difference between three
          cards being held up and three cards lying on a poster. */}
      <motion.div
        className="absolute inset-0 overflow-hidden rounded-2xl bg-background"
        initial={false}
        animate={{ opacity: spilled && !reduced ? 0.42 : 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        {/* The inside of the pack, exposed as the strip peels off it. Sits at the
            bottom of the stack so it is simply what is left once the foil moves. */}
        <div aria-hidden className="absolute inset-0 bg-black">
          <div
            className="absolute inset-x-0 top-0 bg-gradient-to-b from-primary/25 to-transparent"
            style={{ height: `${stripPct + 10}%` }}
          />
        </div>

        {/* The pack itself, which never moves — except to recoil as the strip goes
            the other way. Two halves separating is what sells it; one half moving
            alone reads as a slide.

            Its clip is the *same boundary function* the strip pieces use, so the
            two are complementary at every point of the rip and the artwork is one
            continuous image right up to the moment it comes apart. */}
        <motion.div
          aria-hidden
          className="absolute inset-0"
          style={{
            clipPath: bodyShape,
            // Bowing needs somewhere to bow from. Hinged at the bottom, where the
            // pack is still held, so the torn top edge is the end that opens
            // toward the viewer.
            transformOrigin: "50% 100%",
            transformStyle: "preserve-3d",
          }}
          initial={false}
          animate={
            shed && !reduced
              ? // The recoil. A wrapper that stayed flat while its top came off
                // read as two pieces sliding apart, and the version before this
                // eased to a resting pose, which is a slide with extra steps. The
                // overshoot is what makes it a release: the sides spring out, the
                // face bows toward the viewer, and both settle back short of
                // where they got to.
                {
                  y: [0, 8, 2],
                  scaleX: [1, 1.028, 1.004],
                  scaleY: [1, 0.982, 0.998],
                  rotateX: [0, 8, 4],
                }
              : { y: 0, scaleX: 1, scaleY: 1, rotateX: 0 }
          }
          transition={{ duration: 0.34, times: [0, 0.32, 1], ease: [0.16, 1, 0.3, 1] }}
        >
          <PackFace art={art} state={artState} size={packSize} year={year} />
        </motion.div>

        {/* The exposed fibre, revealed as the tear opens over it. Follows the
            front, so it appears along the rip rather than all at once. */}
        <motion.div
          aria-hidden
          className="absolute inset-0"
          style={{
            clipPath: coreShape,
            background: "oklch(0.95 0.02 240)",
            opacity: coreOpacity,
          }}
        />

        {/* The mouth: the dark of the open pack, spreading left to right behind
            the rip rather than appearing all at once. */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 h-12 -translate-y-1/2"
          style={{
            top: `${stripPct}%`,
            transformOrigin: "left center",
            background:
              "radial-gradient(ellipse at center, oklch(0 0 0 / 88%) 0%, transparent 72%)",
          }}
          initial={false}
          animate={{ scaleX: shed && !reduced ? 1 : 0, opacity: shed ? 1 : 0 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
        />

        {/* The seam, under tension.

            This used to be a single pass of light fired once the strip had already
            gone — a label on a rip that had happened. It is worth far more as the
            thing that happens *first*: the tear line lights up and thickens while
            the pack is still sealed, so the eye is looking at exactly the right
            twenty pixels when they come apart. It bows while it builds, because a
            straight line under tension is a line nothing is pulling on. */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -translate-y-1/2"
          style={{
            top: `${stripPct}%`,
            background:
              "linear-gradient(90deg, transparent, oklch(0.92 0.16 205 / 95%), transparent)",
          }}
          initial={false}
          animate={
            reduced
              ? { opacity: 0, y: 0 }
              : seaming
                ? // Built, not flashed. It grows out from the middle of the seam
                  // and brightens, and it is still there when the strip lets go.
                  { opacity: [0, 0.9], scaleX: [0.25, 1], height: [1, 3], y: [0, -1.6, 0] }
                : bracing
                  ? { opacity: 0, scaleX: 0.25, height: 1, y: 0 }
                  : // Blown out by the rip it was announcing.
                    { opacity: [0.9, 0], scaleX: 1, height: 2, y: 0 }
          }
          transition={{
            duration: seaming ? 0.18 : 0.24,
            ease: "easeOut",
            y: { duration: 0.32, times: [0, 0.5, 1], ease: "easeInOut" },
          }}
        />

        {/* Light already getting out, before anything has come apart.

            Small, and pinned to the left end where the tear begins. This is the
            detail that makes the anticipation read as *pressure* rather than as a
            pack sitting still with a glowing line on it: there is something bright
            inside, and the seam is starting to fail. */}
        {!reduced && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute"
            style={{
              left: "2%",
              top: `${stripPct}%`,
              width: "26%",
              height: "14%",
              transform: "translateY(-50%)",
              mixBlendMode: "screen",
              background:
                "radial-gradient(60% 100% at 20% 50%, oklch(1 0 0 / 70%) 0%, oklch(0.9 0.13 205 / 40%) 45%, transparent 75%)",
              filter: "blur(4px)",
            }}
            initial={false}
            animate={{ opacity: bracing ? [0, 0.34] : 0 }}
            transition={{ duration: 0.42, ease: "easeIn" }}
          />
        )}

        {/* Light escaping the pack.
            Clipped to the tear line itself, so it is genuinely coming out of the
            opening rather than being a bright rectangle laid over it. Screen
            blend, because this is light rather than paint.

            It used to be a single 250ms flash, which is the whole of the light
            this ceremony had. A flash reads as a camera going off; light coming
            out of a pack should swell while the pieces leave and then be
            occluded by the cards climbing through it. So it now runs the length
            of peel-into-launch, and holds a floor of brightness until the fan
            takes over the screen. */}
        {!reduced && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ clipPath: mouthClip(edge, 0), mixBlendMode: "screen" }}
            initial={false}
            animate={{ opacity: shed && !spilled ? [0, 1, 0.72, 0.5] : 0 }}
            transition={{ duration: 1.1, times: [0, 0.22, 0.55, 1], ease: "easeOut" }}
          >
            <div
              className="absolute inset-x-0"
              style={{
                top: `${stripPct - 14}%`,
                height: "42%",
                background:
                  "radial-gradient(60% 100% at 50% 100%, oklch(1 0 0 / 92%) 0%, oklch(0.88 0.13 205 / 62%) 38%, transparent 72%)",
              }}
            />
          </motion.div>
        )}

        {/* God rays out of the tear.

            The mouth glow above says "it is bright in there"; these say the light
            has somewhere to go. Beams, clipped to the same tear line so they are
            unmistakably coming out of the opening, seeded off the pack so two
            people opening the same one see the same shape — the same rule the
            ragged edge follows. Screen blend and low opacity: this is haze, and
            haze that can be individually pointed at has gone too far. */}
        {!reduced && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ clipPath: mouthClip(edge, 0), mixBlendMode: "screen" }}
            initial={false}
            animate={{ opacity: shed && !spilled ? [0, 0.9, 0.55, 0] : 0 }}
            transition={{ duration: 1.2, times: [0, 0.25, 0.6, 1], ease: "easeOut" }}
          >
            {rays.map((ray, i) => (
              <motion.div
                key={i}
                className="absolute origin-bottom"
                style={{
                  left: `${ray.at}%`,
                  top: `${stripPct - 46}%`,
                  height: "46%",
                  width: `${ray.w}%`,
                  transform: `translateX(-50%) rotate(${ray.tilt}deg)`,
                  background:
                    "linear-gradient(to top, oklch(0.95 0.12 205 / 55%), transparent 82%)",
                  filter: "blur(6px)",
                }}
                initial={false}
                animate={shed && !spilled ? { scaleY: [0.3, 1, 0.86] } : { scaleY: 0.3 }}
                transition={{ duration: 1.2, ease: "easeOut", delay: i * 0.045 }}
              />
            ))}
          </motion.div>
        )}

        {/* The perforation, and the tab that says which end to start from. Fades
            out once the rip is under way — a dotted line across a tear you are
            already making is just a label over the thing it describes. Faded
            rather than unmounted, because unmounting it would need the drag to go
            through React. */}
        {sealed && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 flex items-center gap-2 px-3"
            style={{ top: `${stripPct}%`, transform: "translateY(-50%)", opacity: hintOpacity }}
          >
            <div className="tear-hint rounded-sm bg-primary/90 px-1.5 py-0.5 font-display text-[8px] font-black uppercase tracking-[0.2em] text-background">
              Rip
            </div>
            <div className="h-px flex-1 border-t border-dashed border-white/60" />
          </motion.div>
        )}

        {/* The tear point itself: where the material is giving way right now.

            It used to be a flat blurred dot laid over the pack, which read as a
            cursor. Clipped to the mouth and blended as light, it reads as the
            inside of the pack showing through the exact few pixels that have just
            parted — and because it tracks the front rather than a state variable,
            it is genuinely at the tear rather than a frame behind it. */}
        {!reduced && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ clipPath: mouthClip(edge, 0), mixBlendMode: "screen", opacity: frontLeak }}
          >
            <motion.div
              className="absolute h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                top: `${stripPct}%`,
                left: frontPct,
                background:
                  "radial-gradient(circle, oklch(1 0 0 / 85%) 0%, oklch(0.9 0.14 205 / 45%) 40%, transparent 70%)",
                filter: "blur(3px)",
              }}
            />
          </motion.div>
        )}
      </motion.div>

      {/* What is coming out. Outside the clipped box so it can leave the pack, and
          cut by the tear line until it has — the clip is what makes a card read as
          coming *out of* the pack rather than as appearing over it. */}
      {children ? (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          initial={false}
          animate={{ clipPath: mouthClip(edge, spilled || reduced ? 1 : 0) }}
          transition={{ duration: 0.62, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Its own camera. The clip above is a grouping property, so it flattens
              this subtree out of the pack's 3D context and the perspective from
              further up never reaches the cards. */}
          <div className="absolute inset-0" style={{ perspective: "1000px" }}>
            {children}
          </div>
        </motion.div>
      ) : null}

      {/* The strip: four pieces that peel behind the tear and then leave.

          Outside the clipped box, because a piece that has let go rotates clean
          off the top of the pack and clipped that reads as it blinking out of
          existence rather than peeling. They are mounted from the first frame and
          never remounted — while the front is at zero they have no area at all,
          so at rest the pack is one uninterrupted image with four invisible
          layers sitting on top of it. */}
      {TEAR_SEGMENTS.map((_, i) => (
        <TearSegment
          key={i}
          index={i}
          edge={edge}
          front={front}
          seed={seed}
          stripPct={stripPct}
          bracing={bracing}
          flying={shed && !reduced}
          reduced={reduced}
          art={art}
          artState={artState}
          packSize={packSize}
          year={year}
        />
      ))}
    </motion.div>
  );
}
