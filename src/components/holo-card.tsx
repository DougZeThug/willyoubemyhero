import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { initialsOf } from "@/lib/format";
import { playFlip } from "@/lib/card-sfx";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { urlFromSet, srcSetFromSet } from "@/lib/media";
import type { ImageUrlSet } from "@/lib/media";
import type { BorderFx, Rarity } from "@/lib/card-rarity";

/**
 * Standard trading card is 2.5in x 3.5in, and every card in the app is that
 * shape — full stop. The frame used to take its ratio from whatever the art
 * happened to be exported at, which left the vault grid with tiles of subtly
 * different heights. Off-ratio art is cropped to the frame by `object-cover`.
 */
const CARD_ASPECT = 5 / 7;

/**
 * How wide a card renders, for the browser's `srcSet` pick.
 *
 * Exported because src/lib/preload.ts has to hand the browser the identical
 * string: the candidate it warms is only the candidate the card requests if both
 * run the selection algorithm on the same inputs.
 */
export const CARD_SIZES = "(max-width: 640px) 90vw, 420px";
/** Vault tiles sit two-up on a phone, so 90vw would over-fetch by a factor of four. */
export const CARD_GRID_SIZES = "(max-width: 640px) 45vw, 220px";

/**
 * A map rather than `is-${fx}` so every class name exists verbatim in source —
 * grep finds them, and a BorderFx id that gains no CSS shows up here as a
 * hole instead of silently rendering an unstyled class.
 */
const BORDER_FX_CLASS: Record<BorderFx, string | undefined> = {
  spin: "is-spinning",
  pulse: "is-pulsing",
  shimmer: "is-shimmering",
  steady: undefined,
};

/**
 * Sizes to try, widest first. A stalled fetch used to leave a broken-image icon
 * and then, briefly, a permanent "no card art" placeholder — so instead of
 * giving up on the first error, drop to the next smaller (cheaper) rendition
 * and only show the placeholder once every size has failed.
 */
const SIZE_STEPS = ["large", "medium", "thumb"] as const;

function useSteppedImage(set: Parameters<typeof urlFromSet>[0], eager: boolean) {
  const start = eager ? 0 : 1;
  const [step, setStep] = useState(start);
  const key =
    typeof set === "string"
      ? set
      : [set?.large ?? "", set?.medium ?? "", set?.thumb ?? ""].join("|");
  // Any re-signed or replaced rendition is a fresh chance, not only `large`.
  useEffect(() => setStep(start), [key, start]);

  const failed = step >= SIZE_STEPS.length;
  const size = SIZE_STEPS[Math.min(step, SIZE_STEPS.length - 1)];
  return {
    failed,
    src: failed ? null : urlFromSet(set, size),
    // Once the browser rejects its selected srcset candidate, retry one exact
    // URL at a time. Keeping srcset here can make it select the same bad file
    // again even though `src` stepped down.
    srcSet: failed || step > start ? undefined : srcSetFromSet(set, size),
    onError: () => setStep((s) => s + 1),
  };
}

/**
 * How hard a card leans, and how close the camera stands to it.
 *
 * Two profiles, because the two places a card appears want opposite things. One
 * big card you can put a thumb on wants to move a lot and to own the gesture; a
 * thumbnail in a scrolling grid wants to stay out of the scroll's way entirely.
 *
 * maxTilt   Degrees at the edges of the card.
 * touchGain How much further a finger drag tilts the card than the same distance
 *           of mouse travel. A mouse sweeps the whole card and reaches the edges
 *           on its own; a thumb plants somewhere near the middle and wiggles maybe
 *           a centimetre. `hero` *lowers* this: it already starts from a landing
 *           lean and has a bigger maxTilt to spend, and 2.6 on top of both just
 *           saturates the clamp a few pixels into the drag.
 * baseGain  How far the point a finger lands on is pushed toward the edges before
 *           any drag at all. This is what makes press-and-hold do something.
 * persp     Perspective as a multiple of the card's own measured width, or null to
 *           leave the stylesheet's 1200px alone. The grid and the pack are null on
 *           purpose: nothing about them should change.
 * lift      translateZ in px while the card is engaged, so it pops off the page.
 * gyroSpan  Degrees of device roll that sweep the card corner to corner.
 * touchAct  touch-action for the scene. See styleVars for why this is all-or-nothing.
 */
const TILT = {
  calm: {
    maxTilt: 16,
    touchGain: 2.6,
    baseGain: 1,
    persp: null,
    lift: 0,
    gyroSpan: { x: 26, y: 24 },
    touchAct: "pan-y",
  },
  hero: {
    maxTilt: 22,
    touchGain: 2.1,
    baseGain: 1.35,
    persp: 1.7,
    lift: 16,
    gyroSpan: { x: 30, y: 28 },
    touchAct: "none",
  },
} as const;

export type TiltVariant = keyof typeof TILT;

/**
 * What counts as a flick rather than a tap or a lean.
 *
 * A card that already owns the whole touch gesture may as well answer to being
 * thrown over, the way you'd actually turn a card in your hand. Horizontal
 * travel is measured as a fraction of the card's own width so it means the same
 * thing on a thumbnail and on a hero card.
 */
const FLICK = {
  /** Minimum horizontal travel, as a fraction of card width. */
  dist: 0.22,
  /** Longer than this and it was a slow drag someone happened to end off-centre. */
  ms: 420,
  /** Horizontal travel must beat vertical by this much, so a scroll isn't a flick. */
  bias: 1.4,
} as const;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Long enough to read as a turn, short enough not to be in the way. */
const DEFAULT_FLIP_MS = 500;

export type HoloCardProps = {
  frontUrl: ImageUrlSet | string | null;
  backUrl: ImageUrlSet | string | null;
  name: string;
  rarity: Rarity;
  /** Stable id used to cache the measured aspect ratio between visits. */
  cacheKey?: string;
  /** Controlled flip state. Omit for an uncontrolled card. */
  flipped?: boolean;
  onFlippedChange?: (next: boolean) => void;
  /** Whether the card responds to pointer tilt. */
  interactive?: boolean;
  /**
   * Whether a finger drag tilts the card. Defaults on for full-size cards and off
   * for grid thumbnails, where claiming the gesture would fight the page scroll.
   */
  touchTilt?: boolean;
  /**
   * Whether a fast horizontal throw turns the card over. Off where the same
   * gesture means "next card" — the two full-size surfaces flip on tap instead.
   */
  flickToFlip?: boolean;
  /**
   * How loud the foil is. "subtle" halves it for small, mostly-non-interactive
   * cards like the vault grid, where a full-strength overlay swamps the artwork.
   */
  intensity?: "full" | "subtle";
  /**
   * How dramatic the 3D tilt is. "hero" is for the one full-size card a page is
   * built around: half again the lean, a camera at 1.7x the card's width instead
   * of 3.1x, a lift toward the viewer, and it claims the *entire* touch gesture —
   * the page will not scroll while a finger is on it.
   *
   * Deliberately its own prop rather than derived from `intensity`: the pack page
   * renders full-intensity cards two-up inside a scrolling grid, where claiming
   * the gesture would trap the scroll across half the screen.
   */
  tilt?: TiltVariant;
  /** Device-orientation tilt, enabled by the caller after a permission grant. */
  gyro?: boolean;
  /** Start face-down (shows the back) regardless of art availability. */
  faceDown?: boolean;
  /**
   * How long the turn takes. The default suits a card you flip to read the back
   * of; the pack's secret slows it right down, because that flip is the payoff
   * rather than a way of getting at the stats.
   */
  flipMs?: number;
  /** Rendered on the back face when there is no uploaded back artwork. */
  backContent?: React.ReactNode;
  className?: string;
  onClick?: () => void;
};

function HoloCardImpl({
  frontUrl,
  backUrl,
  name,
  rarity,
  cacheKey,
  flipped,
  onFlippedChange,
  interactive = true,
  touchTilt,
  flickToFlip = true,
  intensity = "full",
  tilt = "calm",
  gyro = false,
  faceDown = false,
  flipMs = DEFAULT_FLIP_MS,
  backContent,
  className,
  onClick,
}: HoloCardProps) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const tiltRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const perspRef = useRef(0);
  const pendingRef = useRef<{ px: number; py: number } | null>(null);
  const dragRef = useRef<{ id: number; px: number; py: number; at: number } | null>(null);
  // Set when a pointerup was a flick, and consumed by the click that follows it,
  // so throwing the card over doesn't also register as a tap and flip it twice.
  const flickedRef = useRef(false);
  const reduced = usePrefersReducedMotion();
  const titleId = useId();

  // A full-size card is meant to be handled; a thumbnail in a scrolling grid is not.
  const dragTilt = touchTilt ?? intensity === "full";
  const t = TILT[tilt];
  // The grid is the one place many cards mount at once, and it is the one place
  // the art is small enough that off-screen work is pure waste.
  const eager = intensity === "full";

  const imgSizes = eager ? CARD_SIZES : CARD_GRID_SIZES;
  const front = useSteppedImage(frontUrl, eager);
  const back = useSteppedImage(backUrl, eager);
  const frontSrc = front.src;
  const frontSrcSet = front.srcSet;
  const frontFailed = front.failed;
  const backSrc = back.src;
  const backSrcSet = back.srcSet;
  const backFailed = back.failed;

  const [uncontrolledFlip, setUncontrolledFlip] = useState(false);
  // The glare and sparkle layers are invisible until the card moves, and each one
  // is a blend-mode layer the compositor has to carry. Thirty cards' worth of them
  // at first paint is what makes the vault crawl on a phone, so they are not
  // mounted until the card is actually being handled.
  const [engaged, setEngaged] = useState(false);
  const isFlipped = flipped ?? uncontrolledFlip;
  const showBack = faceDown ? !isFlipped : isFlipped;
  // A generated back is just as flippable as uploaded back artwork.
  const canFlip = !!backUrl || !!backContent;

  // px/py are 0..1 across the card. Writing CSS variables directly keeps this
  // off React's render path entirely. `active` is 1 while the card is being
  // moved and 0 once it settles; every foil layer scales by it, so a card at
  // rest shows the artwork almost clean and only blooms when you tilt it.
  const applyTilt = useCallback(
    (px: number, py: number, active: number) => {
      const scene = sceneRef.current;
      const layer = tiltRef.current;
      const card = cardRef.current;
      if (!scene || !layer || !card) return;
      const rx = (0.5 - py) * 2 * t.maxTilt;
      const ry = (px - 0.5) * 2 * t.maxTilt;
      // Easing is switched on in the same style flush as the angle it belongs to.
      // A transition runs off the *after-change* style, so the return to flat eases
      // while every tracking frame stays instant — the card never lags the finger.
      // Keying it on `active` rather than clearing it on pointerdown is what keeps
      // the mouse path right too: hover re-entry never fires a pointerdown.
      layer.classList.toggle("holo-settle", active === 0);
      scene.style.setProperty("--holo-rx", `${rx.toFixed(2)}deg`);
      scene.style.setProperty("--holo-ry", `${ry.toFixed(2)}deg`);
      scene.style.setProperty("--holo-lift", `${(active * t.lift).toFixed(1)}px`);
      card.style.setProperty("--holo-active", `${active}`);
      card.style.setProperty("--holo-gx", `${(px * 100).toFixed(1)}%`);
      card.style.setProperty("--holo-gy", `${(py * 100).toFixed(1)}%`);
      card.style.setProperty("--holo-pos", `${(px * 100).toFixed(1)}%`);
      // Sparkle parallaxes at ~2x so glints crawl independently of the bands.
      card.style.setProperty("--holo-sparkle-x", `${(px * 200 - 50).toFixed(1)}%`);
      card.style.setProperty("--holo-sparkle-y", `${(py * 200 - 50).toFixed(1)}%`);
      // Rosette spin. The rosette is the only pattern whose texture radiates
      // rather than sweeps, so translating it with the finger is not enough — a
      // real diffraction pattern rotates as the viewing angle changes. Half a turn
      // across the width of the card. Unitless because @property types
      // --prism-angle as an <angle> and this one is multiplied by 1deg in CSS.
      card.style.setProperty("--holo-spin", `${(px * 180 - 90).toFixed(1)}`);
    },
    [t],
  );

  const schedule = useCallback(
    (px: number, py: number) => {
      pendingRef.current = { px, py };
      if (frameRef.current != null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const p = pendingRef.current;
        if (p) applyTilt(p.px, p.py, 1);
      });
    },
    [applyTilt],
  );

  // Recentre and fade the foil back out. The CSS opacity transition does the
  // easing, so there is nothing to animate here.
  const resetTilt = useCallback(() => {
    if (frameRef.current != null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    dragRef.current = null;
    applyTilt(0.5, 0.5, 0);
  }, [applyTilt]);

  useEffect(() => {
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  // Perspective only means anything relative to the card's own width, and that
  // width is whatever column the caller dropped it into. Taken off the rect
  // localPoint already measures and written only when it actually moves, so there
  // is no ResizeObserver on thirty grid cards for a number that changes when the
  // phone rotates and never otherwise.
  const syncPerspective = useCallback(
    (width: number) => {
      if (t.persp == null) return;
      const next = Math.round(width * t.persp);
      if (!next || Math.abs(next - perspRef.current) < 4) return;
      perspRef.current = next;
      sceneRef.current?.style.setProperty("--holo-perspective", `${next}px`);
    },
    [t.persp],
  );

  // One measurement at mount so the very first tilt already sits at the right
  // camera distance instead of popping from the 1200px default on the first frame.
  // The persp guard has to be out here, not just inside syncPerspective: measuring
  // is the expensive half, and a vault grid would otherwise force thirty layout
  // reads at mount to compute a value none of those cards use.
  useLayoutEffect(() => {
    if (t.persp == null) return;
    const w = sceneRef.current?.getBoundingClientRect().width;
    if (w) syncPerspective(w);
  }, [t.persp, syncPerspective]);

  // Device orientation, offset from the first reading so it works at any resting
  // angle — standing at the bar or lying on the couch.
  useEffect(() => {
    if (!gyro || reduced || typeof window === "undefined") return;
    setEngaged(true);
    // Nothing on the gyro path goes through localPoint, so without this the card
    // would tilt at the stylesheet's fallback camera distance.
    const w = sceneRef.current?.getBoundingClientRect().width;
    if (w) syncPerspective(w);
    let baseline: { beta: number; gamma: number } | null = null;
    const onOrient = (e: DeviceOrientationEvent) => {
      const { beta, gamma } = e;
      if (beta == null || gamma == null) return;
      if (!baseline) {
        baseline = { beta, gamma };
        return;
      }
      // A roll of gyroSpan degrees sweeps the card corner to corner. Wider than
      // that and normal handling reads as a dead card; narrower and it twitches.
      // The span widens along with maxTilt so the card gains throw without the one
      // input the user has no fine control over becoming jumpy.
      schedule(
        clamp01(0.5 + (gamma - baseline.gamma) / t.gyroSpan.x),
        clamp01(0.5 + (beta - baseline.beta) / t.gyroSpan.y),
      );
    };
    window.addEventListener("deviceorientation", onOrient);
    return () => {
      window.removeEventListener("deviceorientation", onOrient);
      // Switching "Tilt" back off used to leave the card cocked over with the foil
      // still lit. Now it eases home.
      resetTilt();
    };
  }, [gyro, reduced, schedule, resetTilt, syncPerspective, t]);

  function localPoint(e: React.PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    syncPerspective(r.width);
    return { px: (e.clientX - r.left) / r.width, py: (e.clientY - r.top) / r.height };
  }

  // The landing point sets the lean the instant you press; the drag adds amplified
  // displacement on top of it. Put a thumb on a corner and hold perfectly still and
  // the card should already be leaning away from you. That is the piece that was
  // missing — this arithmetic only ever ran on pointermove, so a press that did not
  // travel produced no tilt at all.
  function touchTarget(drag: { px: number; py: number }, px: number, py: number) {
    const baseX = 0.5 + (drag.px - 0.5) * t.baseGain;
    const baseY = 0.5 + (drag.py - 0.5) * t.baseGain;
    return {
      px: clamp01(baseX + (px - drag.px) * t.touchGain),
      py: clamp01(baseY + (py - drag.py) * t.touchGain),
    };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!interactive || reduced || e.pointerType === "mouse" || !dragTilt) return;
    const p = localPoint(e);
    if (!p) return;
    // A flick whose finger left past the card's edge may not produce a click at
    // all, which would leave the flag armed to swallow the next real tap.
    // Clearing it here bounds that to the gesture it belongs to.
    flickedRef.current = false;
    dragRef.current = { id: e.pointerId, px: p.px, py: p.py, at: Date.now() };
    // Capture so the tilt keeps tracking once the finger slides past the card's
    // edge, and so a drag that started here isn't handed off mid-gesture.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    // Mounted now, a frame before anything moves, so the overlays still get to
    // fade in rather than snapping on with the first tilt. This has to stay ahead
    // of the schedule() below: React flushes a discrete event's state before the
    // rAF runs, so the glare layer exists at --holo-active 0 and still gets its
    // 260ms ramp instead of blinking on at full strength.
    setEngaged(true);
    // Lean now, from wherever the thumb actually landed — no travel required.
    const target = touchTarget(p, p.px, p.py);
    schedule(target.px, target.py);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!interactive || reduced) return;
    const drag = dragRef.current;
    // Hover tilts on a mouse; touch and pen only tilt while a finger is down,
    // otherwise a stray move event would leave the card cocked over.
    if (e.pointerType !== "mouse" && (!drag || drag.id !== e.pointerId)) return;
    const p = localPoint(e);
    if (!p) return;
    setEngaged(true);
    if (drag) {
      const target = touchTarget(drag, p.px, p.py);
      schedule(target.px, target.py);
      return;
    }
    schedule(p.px, p.py);
  }

  // pointerup and pointercancel deliberately share this. Both should return the
  // card to flat, and both now do it eased rather than snapping. On a hero card a
  // cancel is rare once the gesture is owned outright — only a real system steal,
  // like an app switch or an incoming call — and on a grid card, easing home when
  // a scroll takes the gesture is a straight improvement over the old hard snap.
  function handlePointerEnd(e: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.id === e.pointerId && e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    resetTilt();
  }

  /**
   * A fast horizontal throw turns the card over.
   *
   * Only on pointerup — a pointercancel means the system took the gesture away
   * (an app switch, an incoming call), and finishing the flip on the way out
   * would be the card acting on an interaction the user abandoned.
   */
  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (drag && drag.id === e.pointerId && canFlip && flickToFlip) {
      const p = localPoint(e);
      if (p) {
        const dx = p.px - drag.px;
        const dy = p.py - drag.py;
        const flick =
          Math.abs(dx) >= FLICK.dist &&
          Math.abs(dx) >= Math.abs(dy) * FLICK.bias &&
          Date.now() - drag.at <= FLICK.ms;
        if (flick) {
          // Claimed before handlePointerEnd, whose resetTilt clears dragRef.
          flickedRef.current = true;
          // A caller that owns the tap owns the throw too. On the pack's reveal
          // stand, throwing the card over *is* the reveal — it has to run the
          // ceremony rather than silently turn the card behind its back.
          if (onClick) onClick();
          else toggleFlip();
        }
      }
    }
    handlePointerEnd(e);
  }

  function toggleFlip() {
    if (!canFlip) return;
    const next = !isFlipped;
    if (flipped === undefined) setUncontrolledFlip(next);
    onFlippedChange?.(next);
    playFlip();
  }

  function handleClick() {
    // A flick already turned the card; the click the browser synthesises after
    // that same pointerup would turn it straight back.
    if (flickedRef.current) {
      flickedRef.current = false;
      return;
    }
    onClick?.();
    if (!onClick) toggleFlip();
  }

  // A grid thumbnail gets half the foil of a full-bleed detail card: the same
  // overlay reads far heavier at small sizes, and nobody tilts a thumbnail.
  const scale = intensity === "subtle" ? 0.5 : 1;

  const styleVars = {
    "--holo-a": rarity.holoA,
    "--holo-b": rarity.holoB,
    "--holo-sparkle": reduced ? 0 : rarity.sparkle * scale,
    // Resting sheen, kept low so the artwork reads as the artist drew it...
    "--holo-rest": (reduced ? 0.04 : 0.095) * rarity.strength * scale,
    // ...and the bloom it gains on top of that at full tilt. A base card peaks
    // near the old flat 0.38, but only while moving and only inside the band.
    "--holo-gain": reduced ? 0 : 0.4 * rarity.strength * scale,
    // The midpoint of the flip, where the card is edge-on. holo-face lands its
    // visibility swap there, so a slower flip has to move it — left at the default
    // 250ms, a 1100ms turn swaps faces a third of the way in and WebKit shows the
    // away side mirrored through the card.
    "--holo-flip-half": `${Math.round(flipMs / 2)}ms`,
    aspectRatio: CARD_ASPECT,
    // "pan-y" for a card in a scrolling grid; "none" for a hero card, which owns
    // the whole gesture on both axes.
    //
    // touch-action is read once, when the gesture starts, off the hit element and
    // its ancestors, and that decision is final — once the compositor has committed
    // to a pan it does not hand it back, preventDefault is ignored from then on,
    // and our pointer stream dies with a pointercancel. So "pan-y" never meant
    // "scroll unless the card wants it". It meant the card never receives vertical
    // travel at all — rotateX is simply dead on touch — and the instant a thumb
    // drifts a few pixels down the browser cancels the pointer and the card snaps
    // flat mid-drag. That is the bug that reads as "holding it barely tilts".
    //
    // There is no adaptive middle ground worth having: changing touch-action
    // mid-gesture does nothing to the in-flight gesture, and re-capturing after a
    // pointercancel cannot reclaim a pan. The only alternative is "none" plus a JS
    // scroll proxy, which costs momentum and rubber-banding.
    touchAction: dragTilt && interactive && !reduced ? t.touchAct : undefined,
  } as React.CSSProperties;

  // A resting card only crawls if the tier earned it, and only at hero size —
  // the vault grid is the one place many cards mount at once, and a permanently
  // animating layer on each is the same cost `engaged` exists to avoid. It also
  // yields the moment the pointer's own band takes over.
  const idle = rarity.idle && tilt === "hero" && !reduced && !engaged;

  // A named variable rather than part of `Overlays`, because `Overlays` renders on
  // the front *and* on an uploaded back — inlining the ring there would mount two
  // of them on a secret card that has back art.
  const prismEdge = rarity.prismEdge ? (
    <div
      className={cn(
        "holo-prism-edge",
        tilt === "hero" && !reduced && BORDER_FX_CLASS[rarity.borderFx ?? "spin"],
      )}
      aria-hidden
    />
  ) : null;

  const Overlays = (
    <>
      <div className={cn("holo-foil", `holo-pattern-${rarity.pattern}`)} aria-hidden />
      {idle && <div className="holo-idle" aria-hidden />}
      {engaged && <div className="holo-glare" aria-hidden />}
      {engaged && rarity.sparkle > 0 && <div className="holo-sparkle" aria-hidden />}
      {prismEdge}
    </>
  );

  return (
    <div
      ref={sceneRef}
      className={cn("holo-scene relative w-full select-none", className)}
      style={styleVars}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerEnd}
      onPointerLeave={handlePointerEnd}
    >
      {/*
        Tilt and flip live on separate layers on purpose. The flip needs a ~500ms
        transition; the tilt must be instant or the card feels like it is dragging
        behind your finger. Sharing one element would force one duration on both.
      */}
      <div
        ref={tiltRef}
        className="h-full w-full [transform-style:preserve-3d]"
        style={{
          // translateZ leads: the lift is toward the viewer along the scene's Z,
          // not along the card's own normal after it has already rotated. It rides
          // the same transform the settle transition eases, so it costs nothing
          // extra — and it must not live on the flip layer below, whose 500ms
          // duration would smear the lift out and make the card feel gluey.
          transform:
            "translateZ(var(--holo-lift,0px)) rotateX(var(--holo-rx,0deg)) rotateY(var(--holo-ry,0deg))",
          // Gated to the hero card: thirty promoted layers is the exact cost the
          // rest of this file is written to avoid.
          willChange: tilt === "hero" ? "transform" : undefined,
        }}
      >
        <div
          ref={cardRef}
          role={canFlip || onClick ? "button" : undefined}
          tabIndex={canFlip || onClick ? 0 : undefined}
          aria-labelledby={titleId}
          aria-pressed={canFlip ? isFlipped : undefined}
          onClick={handleClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleClick();
            }
          }}
          className={cn(
            "relative h-full w-full rounded-xl border shadow-2xl outline-none",
            "transition-transform duration-500 ease-out [transform-style:preserve-3d]",
            "focus-visible:ring-2 focus-visible:ring-primary",
            (canFlip || onClick) && "cursor-pointer",
          )}
          style={{
            borderColor: rarity.border,
            transform: `rotateY(${showBack ? 180 : 0}deg)`,
            transitionDuration: reduced ? "0ms" : `${flipMs}ms`,
            boxShadow: `0 0 28px -6px ${rarity.border}`,
          }}
        >
          <span id={titleId} className="sr-only">
            {name} — {rarity.label} card{canFlip ? ", press to flip" : ""}
          </span>

          {/* Front. `invisible` rather than backface-visibility alone — see the
              note on .holo-face; WebKit shows the away side through the card. */}
          <div className={cn("holo-face", canFlip && showBack && "invisible")}>
            {frontSrc && !frontFailed ? (
              <img
                src={frontSrc}
                srcSet={frontSrcSet}
                sizes={imgSizes}
                alt={`${name} card front`}
                onError={front.onError}
                // A vault grid is thirty cards deep. Fetching and decoding the
                // ones below the fold up front is what starves the handful that
                // are actually on screen.
                loading={eager ? "eager" : "lazy"}
                decoding="async"
                fetchPriority={eager ? "high" : "auto"}
                className="h-full w-full object-cover"
                // Buys back the small amount of punch the blend layers still
                // cost, so the art lands closer to the source file.
                style={{ filter: "saturate(1.06) contrast(1.04)" }}
                draggable={false}
              />
            ) : (
              <CardPlaceholder name={name} label="No card art" />
            )}
            {Overlays}
          </div>

          {/* Back — skipped entirely on a card that can't turn over, which is every
              thumbnail in the vault grid. */}
          {(canFlip || faceDown) && (
            <div className={cn("holo-face [transform:rotateY(180deg)]", !showBack && "invisible")}>
              {backSrc && !backFailed ? (
                <img
                  src={backSrc}
                  srcSet={backSrcSet}
                  sizes={imgSizes}
                  alt={`${name} card back`}
                  onError={back.onError}
                  loading="lazy"
                  decoding="async"
                  // object-cover, not contain: the card's aspect is measured from
                  // the front art, and one universal back shared across an event
                  // won't always match it exactly. Contain would letterbox the
                  // back against the card body; cover keeps it full-bleed.
                  className="h-full w-full object-cover"
                  style={{ filter: "saturate(1.06) contrast(1.04)" }}
                  draggable={false}
                />
              ) : (
                (backContent ?? <CardPlaceholder name={name} label="No back art" />)
              )}
              {/* Uploaded art gets the full foil treatment; a generated back only
                takes the glare, so the stats stay legible. The prism edge rides
                along either way: it traces the bezel and never sits over the
                panel, so the reason the foil is held back here doesn't apply. */}
              {backSrc && !backFailed ? (
                Overlays
              ) : (
                <>
                  {engaged && <div className="holo-glare" aria-hidden />}
                  {prismEdge}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// The vault renders the whole roster at once, and its parent re-renders on every
// sort, every collection read and every signed-URL refresh. None of that changes
// a card, so none of it should cost thirty re-renders.
export const HoloCard = memo(HoloCardImpl);

function CardPlaceholder({ name, label }: { name: string; label: string }) {
  return (
    <div className="hud-bezel flex h-full w-full flex-col items-center justify-center gap-2 bg-[oklch(0.16_0.02_240)] p-4 text-center">
      <div className="font-display text-4xl font-black uppercase text-primary/60">
        {initialsOf(name) || "?"}
      </div>
      <div className="font-display text-sm font-black uppercase leading-tight tracking-wide">
        {name}
      </div>
      <div className="text-[9px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
