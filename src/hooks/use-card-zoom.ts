import { useCallback, useEffect, useRef, useState } from "react";
import {
  DOUBLE_TAP_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  anchorOffset,
  clampOffset,
  clampZoom,
  distance,
  midpoint,
  normalizeWheelDelta,
  swipeDirection,
  verticalSwipe,
  zoomFromWheel,
  type Point,
} from "@/lib/zoom";

/** A tap has to stay still and be over quickly, or it was a drag. */
const TAP = { move: 12, ms: 320, gap: 300 } as const;

export type CardZoomOptions = {
  onSwipe?: (dir: -1 | 1) => void;
  /**
   * The same throw on the other axis: -1 flicked up, 1 pulled down.
   *
   * Read here rather than by a second gesture layer over the card. The frame
   * already claims `touch-action: none` and captures the pointer above 1x, so an
   * overlay wanting a pull-down would be asking for events this hook has taken —
   * which is the fight the header of zoom-pan-frame.tsx exists to avoid.
   */
  onVerticalSwipe?: (dir: -1 | 1) => void;
  /** Fired for a single tap that was neither a swipe nor part of a double tap. */
  onTap?: () => void;
  /** Turn the whole thing off, e.g. when there is nothing to look at yet. */
  enabled?: boolean;
};

/**
 * Pinch to zoom, drag to pan, swipe to move on.
 *
 * The transform is written straight to the node rather than rendered, because a
 * pinch produces a move event per frame per finger and React's render path is
 * the wrong place for that. `zoom` is mirrored into state only so callers can
 * react to *being* zoomed — suppressing the card's own tilt, showing a reset
 * button — not to drive the transform.
 */
export function useCardZoom({
  onSwipe,
  onVerticalSwipe,
  onTap,
  enabled = true,
}: CardZoomOptions = {}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const view = useRef({ zoom: MIN_ZOOM, x: 0, y: 0 });
  const [zoom, setZoom] = useState(MIN_ZOOM);

  const pointers = useRef(new Map<number, Point>());
  const drag = useRef<{ id: number; from: Point; at: number; view: Point } | null>(null);
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  // A swipe or a double tap ends in a click the browser synthesises for us; the
  // card underneath must not also treat that as a tap.
  const swallowClick = useRef(false);
  const lastTap = useRef<{ at: number; point: Point } | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const size = useCallback(() => {
    const r = frameRef.current?.getBoundingClientRect();
    return { width: r?.width ?? 0, height: r?.height ?? 0 };
  }, []);

  const apply = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    const v = view.current;
    el.style.transform = `translate3d(${v.x.toFixed(2)}px, ${v.y.toFixed(2)}px, 0) scale(${v.zoom.toFixed(3)})`;
  }, []);

  const commit = useCallback(
    (next: { zoom: number; x: number; y: number }) => {
      const clamped = clampOffset({ x: next.x, y: next.y }, next.zoom, size());
      view.current = { zoom: next.zoom, x: clamped.x, y: clamped.y };
      apply();
      setZoom((z) => (Math.abs(z - next.zoom) < 0.001 ? z : next.zoom));
    },
    [apply, size],
  );

  /** Zoom to `next`, keeping `point` (frame-local px) under the same content. */
  const zoomTo = useCallback(
    (next: number, point?: Point) => {
      const v = view.current;
      const target = clampZoom(next);
      const at = point ?? { x: size().width / 2, y: size().height / 2 };
      const off = anchorOffset({ x: v.x, y: v.y }, at, v.zoom, target);
      commit({ zoom: target, ...(target === MIN_ZOOM ? { x: 0, y: 0 } : off) });
    },
    [commit, size],
  );

  const reset = useCallback(() => commit({ zoom: MIN_ZOOM, x: 0, y: 0 }), [commit]);
  const zoomBy = useCallback((factor: number) => zoomTo(view.current.zoom * factor), [zoomTo]);

  const local = useCallback((e: { clientX: number; clientY: number }): Point => {
    const r = frameRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  }, []);

  // React attaches onWheel passively, so preventDefault there is ignored and the
  // page zooms behind the card. A trackpad pinch arrives here as ctrlKey.
  useEffect(() => {
    const el = frameRef.current;
    if (!el || !enabled) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && view.current.zoom === MIN_ZOOM) return;
      e.preventDefault();
      const dy = normalizeWheelDelta(e.deltaY, e.deltaMode);
      zoomTo(zoomFromWheel(view.current.zoom, dy), local(e));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [enabled, local, zoomTo]);

  useEffect(() => () => void (tapTimer.current && clearTimeout(tapTimer.current)), []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled) return;
      const p = local(e);
      pointers.current.set(e.pointerId, p);
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        pinch.current = { dist: distance(a, b), zoom: view.current.zoom };
        drag.current = null;
        return;
      }
      if (pointers.current.size === 1) {
        drag.current = {
          id: e.pointerId,
          from: p,
          at: Date.now(),
          view: { x: view.current.x, y: view.current.y },
        };
        // Only claim the pointer once we own the gesture outright; at 1x the card
        // underneath still wants it for its tilt.
        if (view.current.zoom > MIN_ZOOM) e.currentTarget.setPointerCapture?.(e.pointerId);
      }
    },
    [enabled, local],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled || !pointers.current.has(e.pointerId)) return;
      const p = local(e);
      pointers.current.set(e.pointerId, p);

      if (pointers.current.size >= 2 && pinch.current) {
        const [a, b] = [...pointers.current.values()];
        const d = distance(a, b);
        if (!pinch.current.dist) return;
        zoomTo((pinch.current.zoom * d) / pinch.current.dist, midpoint(a, b));
        return;
      }

      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      if (view.current.zoom > MIN_ZOOM) {
        commit({
          zoom: view.current.zoom,
          x: d.view.x + (p.x - d.from.x),
          y: d.view.y + (p.y - d.from.y),
        });
      }
    },
    [commit, enabled, local, zoomTo],
  );

  const endPointer = useCallback(
    (e: React.PointerEvent, cancelled: boolean) => {
      const p = pointers.current.get(e.pointerId) ?? local(e);
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) pinch.current = null;
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }

      const d = drag.current;
      drag.current = null;

      // A pinch that ends with a finger still down should hand straight over to
      // panning; drag state was cleared when the pinch began, so rebuild it here
      // rather than making the user lift and touch again.
      if (pointers.current.size === 1 && view.current.zoom > MIN_ZOOM) {
        const [id, point] = [...pointers.current.entries()][0]!;
        drag.current = {
          id,
          from: point,
          at: Date.now(),
          view: { x: view.current.x, y: view.current.y },
        };
        return;
      }

      if (cancelled || !d || d.id !== e.pointerId) return;

      const dx = p.x - d.from.x;
      const dy = p.y - d.from.y;
      const dt = Date.now() - d.at;

      // A throw ends whatever a tap had started. Without this the *previous*
      // tap's held-back `onTap` still fires 300ms later — flipping the card
      // somebody has just swiped away from, or on a surface where the throw
      // itself does nothing, flipping the card they meant to leave.
      const claimGesture = () => {
        if (tapTimer.current) clearTimeout(tapTimer.current);
        tapTimer.current = null;
        lastTap.current = null;
        swallowClick.current = true;
      };

      // A swipe only means "next card" while the card is whole on screen. Zoomed
      // in, the same drag is a pan and must never navigate.
      if (view.current.zoom === MIN_ZOOM && onSwipe) {
        const dir = swipeDirection(dx, dy, dt);
        if (dir) {
          claimGesture();
          onSwipe(dir);
          return;
        }
      }
      // Same rule on the other axis, and after it rather than before: the two are
      // mutually exclusive by their bias, so the order cannot change an answer —
      // but stepping between cards is the gesture people make constantly and
      // dismissing is the one they make once, so the common case is read first.
      if (view.current.zoom === MIN_ZOOM && onVerticalSwipe) {
        const dir = verticalSwipe(dx, dy, dt);
        if (dir) {
          claimGesture();
          onVerticalSwipe(dir);
          return;
        }
      }

      const still = Math.hypot(dx, dy) <= TAP.move;
      if (!still || dt > TAP.ms) return;

      const prev = lastTap.current;
      const now = Date.now();
      if (prev && now - prev.at <= TAP.gap && distance(prev.point, p) <= 40) {
        lastTap.current = null;
        if (tapTimer.current) clearTimeout(tapTimer.current);
        tapTimer.current = null;
        swallowClick.current = true;
        if (view.current.zoom > MIN_ZOOM) reset();
        else zoomTo(DOUBLE_TAP_ZOOM, p);
        return;
      }

      lastTap.current = { at: now, point: p };
      swallowClick.current = true;
      if (tapTimer.current) clearTimeout(tapTimer.current);
      // Held back so a double tap doesn't also flip the card on its way to zooming.
      tapTimer.current = setTimeout(() => {
        tapTimer.current = null;
        lastTap.current = null;
        onTap?.();
      }, TAP.gap);
    },
    [local, onSwipe, onTap, onVerticalSwipe, reset, zoomTo],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => endPointer(e, false), [endPointer]);
  const onPointerCancel = useCallback((e: React.PointerEvent) => endPointer(e, true), [endPointer]);

  // The frame owns tapping, so the card underneath never sees a click.
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return {
    frameRef,
    contentRef,
    zoom,
    zoomed: zoom > MIN_ZOOM,
    canZoomIn: zoom < MAX_ZOOM,
    zoomBy,
    zoomTo,
    reset,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onClickCapture,
    },
  };
}
