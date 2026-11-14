import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

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
 * touchAct  touch-action for the scene. See `touchAction` below for why this is
 *           all-or-nothing.
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

type TiltOptions = {
  variant: TiltVariant;
  interactive: boolean;
  reduced: boolean;
  /** Whether a finger drag tilts the card at all. */
  touchTilt: boolean;
  /** This card sits on a page that scrolls, so the vertical axis stays the browser's. */
  pageScroll: boolean;
  /** Device-orientation tilt, enabled by the caller after a permission grant. */
  gyro: boolean;
  /** A fast horizontal throw calls `onFlick`. */
  flick: boolean;
  onFlick: () => void;
};

/**
 * Pointer and device-orientation tilt for one card.
 *
 * Everything is written straight onto the elements as CSS variables so tracking
 * stays off React's render path; the only state is `engaged`, which mounts the
 * glare and sparkle layers the first time the card is actually handled.
 */
export function useCardTilt({
  variant,
  interactive,
  reduced,
  touchTilt,
  pageScroll,
  gyro,
  flick,
  onFlick,
}: TiltOptions) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const tiltRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const catchTimer = useRef<number | null>(null);
  const perspRef = useRef(0);
  const pendingRef = useRef<{ px: number; py: number } | null>(null);
  const dragRef = useRef<{ id: number; px: number; py: number; at: number } | null>(null);
  // Set when a pointerup was a flick, and consumed by the click that follows it,
  // so throwing the card over doesn't also register as a tap and flip it twice.
  const flickedRef = useRef(false);
  // The glare and sparkle layers are invisible until the card moves, and each one
  // is a blend-mode layer the compositor has to carry. Thirty cards' worth of them
  // at first paint is what makes the vault crawl on a phone, so they are not
  // mounted until the card is actually being handled.
  const [engaged, setEngaged] = useState(false);
  const t = TILT[variant];

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
      const wasSettling = layer.classList.contains("holo-settle");
      layer.classList.toggle("holo-settle", active === 0);
      // Re-grabbing mid-settle drops holo-settle, which cancels the in-flight ease
      // and snaps the card to the finger. A 100ms one-shot catch closes that gap;
      // it is gone before tracking proper, which has to stay 1:1.
      if (active === 0) {
        layer.classList.remove("holo-catch");
        if (catchTimer.current) window.clearTimeout(catchTimer.current);
      } else if (wasSettling) {
        layer.classList.add("holo-catch");
        if (catchTimer.current) window.clearTimeout(catchTimer.current);
        catchTimer.current = window.setTimeout(() => layer.classList.remove("holo-catch"), 100);
      }
      // Written straight onto the layer rather than through scene variables: a
      // var() on the scene re-resolves for every descendant on each change, and
      // only this one element reads the angle.
      layer.style.transform = `translateZ(${(active * t.lift).toFixed(1)}px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
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
      if (catchTimer.current) window.clearTimeout(catchTimer.current);
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

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!interactive || reduced || e.pointerType === "mouse" || !touchTilt) return;
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

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
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
  function onPointerEnd(e: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.id === e.pointerId && e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    resetTilt();
  }

  /**
   * A fast horizontal throw calls `onFlick`.
   *
   * Only on pointerup — a pointercancel means the system took the gesture away
   * (an app switch, an incoming call), and finishing the flip on the way out
   * would be the card acting on an interaction the user abandoned.
   */
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (drag && drag.id === e.pointerId && flick) {
      const p = localPoint(e);
      if (p) {
        const dx = p.px - drag.px;
        const dy = p.py - drag.py;
        const flicked =
          Math.abs(dx) >= FLICK.dist &&
          Math.abs(dx) >= Math.abs(dy) * FLICK.bias &&
          Date.now() - drag.at <= FLICK.ms;
        if (flicked) {
          // Claimed before onPointerEnd, whose resetTilt clears dragRef.
          flickedRef.current = true;
          onFlick();
        }
      }
    }
    onPointerEnd(e);
  }

  return {
    sceneRef,
    tiltRef,
    cardRef,
    engaged,
    /**
     * A click that follows a flick is the same gesture, and has to be dropped or
     * it would turn the card straight back. True once per flick.
     */
    takeFlick() {
      const was = flickedRef.current;
      flickedRef.current = false;
      return was;
    },
    /**
     * "pan-y" for a card in a scrolling grid; "none" for a hero card, which owns
     * the whole gesture on both axes.
     *
     * touch-action is read once, when the gesture starts, off the hit element and
     * its ancestors, and that decision is final — once the compositor has committed
     * to a pan it does not hand it back, preventDefault is ignored from then on,
     * and our pointer stream dies with a pointercancel. So "pan-y" never meant
     * "scroll unless the card wants it". It meant the card never receives vertical
     * travel at all — rotateX is simply dead on touch — and the instant a thumb
     * drifts a few pixels down the browser cancels the pointer and the card snaps
     * flat mid-drag. That is the bug that reads as "holding it barely tilts".
     *
     * There is no adaptive middle ground worth having: changing touch-action
     * mid-gesture does nothing to the in-flight gesture, and re-capturing after a
     * pointercancel cannot reclaim a pan. The only alternative is "none" plus a JS
     * scroll proxy, which costs momentum and rubber-banding.
     * ...except where the card sits on a page that still has to scroll under a
     * thumb. A hero card is most of a phone screen, so "none" there means the
     * page cannot be scrolled from anywhere the card covers. `pageScroll` gives
     * the vertical axis back to the browser and keeps the rest — the lean on
     * touch is then horizontal only, which is the trade those callers want.
     */
    touchAction:
      touchTilt && interactive && !reduced ? (pageScroll ? "pan-y" : t.touchAct) : undefined,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerEnd,
      onPointerLeave: onPointerEnd,
    },
  };
}
