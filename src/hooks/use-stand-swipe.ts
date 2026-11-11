import { useEffect, useRef, useState } from "react";
import { animate, useMotionValue } from "motion/react";
import { SWIPE, swipeDirection } from "@/lib/zoom";

/**
 * The card follows the finger through a swipe, instead of waiting for the lift.
 *
 * A spike: whether it feels right can only be judged on a phone. One line turns
 * it off, and with it off the stand is back to reading the throw on pointerup.
 */
const TRACK_SWIPE = true;
/** Where the card leaves to when nothing dragged it anywhere. */
const EXIT_X = -64;

/**
 * The stand's step gesture: swiping the card away is how you move on.
 *
 * Reads the per-render facts it needs rather than owning them, and its handlers
 * are deliberately new functions every render — they close over `canAdvance`,
 * `reduced` and `onAdvance`, and a stale copy of any of those would let a card
 * that cannot step be thrown, or throw one with the old callback.
 */
export function useStandSwipe({
  reduced,
  canAdvance,
  onAdvance,
  shownKey,
}: {
  reduced: boolean;
  canAdvance: boolean;
  onAdvance: () => void;
  /** What is on the stand, as an identity — see PackStand. */
  shownKey: string;
}) {
  // The step gesture. Swiping the card away is how you move on — there is no
  // Next button — so the whole stand reads the throw, not just the card.
  const swipeRef = useRef<{ id: number; x: number; y: number; at: number } | null>(null);
  // A swipe can end in a click the browser synthesises over whatever the finger
  // lifted on, and the card underneath must not also treat that as a tap —
  // same trap useCardZoom swallows. Cleared again on the next pointerdown,
  // because a touch drag produces no click at all and a stale flag here would
  // eat the next genuine tap.
  const swallowClickRef = useRef(false);

  // Following the finger. `dragX` is the keyed wrapper's own x, so the entrance
  // and exit springs animate the very value the finger writes to.
  const dragX = useMotionValue(0);
  // The spring-back, held so the next touch can stop it rather than fight it.
  const settleRef = useRef<ReturnType<typeof animate> | null>(null);
  // Whether this gesture moved the card. A tap must not spring back a card that
  // is still arriving on its entrance, which is also `dragX`.
  const draggedRef = useRef(false);
  // Where the card on its way out is headed. A swipe sets it to wherever the
  // finger left the card, so the exit carries on from there rather than gliding
  // back to the default while it fades; the arrow key leaves it alone.
  const [exitX, setExitX] = useState(EXIT_X);
  // Not on the card's key in a layout effect: that would run while the old card
  // is still exiting on this same value and snap it to 0. The incoming card
  // resets `dragX` itself — motion sets a style motion value to the element's
  // `initial` when it mounts.
  useEffect(() => {
    setExitX(EXIT_X);
  }, [shownKey]);

  function settle() {
    settleRef.current = animate(dragX, 0, { type: "spring", duration: 0.4, bounce: 0.2 });
  }

  function handleSwipeDown(e: React.PointerEvent) {
    swallowClickRef.current = false;
    settleRef.current?.stop();
    draggedRef.current = false;
    swipeRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, at: Date.now() };
  }
  function handleSwipeMove(e: React.PointerEvent) {
    // Reduced motion and a card that cannot step stay exactly as they were: the
    // throw is read on release and nothing slides.
    if (!TRACK_SWIPE || reduced || !canAdvance) return;
    const start = swipeRef.current;
    if (!start || start.id !== e.pointerId) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    // Tracked only while it is reading as a swipe, so a vertical scroll that
    // starts on the card does not drag it sideways.
    if (Math.abs(dx) < Math.abs(dy) * SWIPE.bias) return;
    draggedRef.current = true;
    // Away from the next card it resists, so it reads as the wrong way.
    // `jump`, not `set`: it also stops an animation still running on the value.
    dragX.jump(dx < 0 ? dx * 0.9 : dx * 0.25);
  }
  function handleSwipeUp(e: React.PointerEvent) {
    const d = swipeRef.current;
    swipeRef.current = null;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    const ms = Date.now() - d.at;
    let dir = swipeDirection(dx, dy, ms);
    // A short, fast flick is a throw too: half the distance, if it is quick.
    const flick =
      TRACK_SWIPE &&
      !reduced &&
      dir === 0 &&
      dx < -SWIPE.dist / 2 &&
      Math.abs(dx) >= Math.abs(dy) * SWIPE.bias &&
      Math.abs(dx) / Math.max(ms, 1) > 0.11;
    if (flick) dir = 1;
    const committed = dir === 1 && canAdvance;
    if (committed) {
      // Batched with the advance below, so the exit sees it as its `custom`.
      if (TRACK_SWIPE && !reduced) setExitX(Math.min(dragX.get(), EXIT_X));
    } else if (TRACK_SWIPE && draggedRef.current) {
      settle();
    }
    draggedRef.current = false;
    if (dir === 0) return;
    // Swallowed for either direction, advanced or not: a throw across a
    // face-down card must not fall through and run the reveal ceremony.
    swallowClickRef.current = true;
    if (committed) onAdvance();
  }
  function handleSwipeCancel() {
    swipeRef.current = null;
    if (TRACK_SWIPE && draggedRef.current) settle();
    draggedRef.current = false;
  }
  function handleSwipeClickCapture(e: React.MouseEvent) {
    if (!swallowClickRef.current) return;
    swallowClickRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  }

  return {
    dragX,
    exitX,
    handlers: {
      onPointerDown: handleSwipeDown,
      onPointerMove: handleSwipeMove,
      onPointerUp: handleSwipeUp,
      onPointerCancel: handleSwipeCancel,
      onClickCapture: handleSwipeClickCapture,
    },
  };
}
