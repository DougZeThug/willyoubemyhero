// The two readings of "is this card at rest".
//
// `view.current.zoom` decides every gesture — whether a drag release is a swipe
// or a pan, whether the pointer is captured — and `zoom` state decides every
// piece of chrome around it. They are written from one call and used to be
// allowed to disagree, which is a bug with no symptom: the card looks fine and
// the gestures are gone, or the chrome says zoomed at a card that is not.
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { DOUBLE_TAP_ZOOM, MIN_ZOOM, SWIPE } from "@/lib/zoom";
import { useCardZoom } from "./use-card-zoom";

/**
 * A pointer event shaped the way the hook reads one.
 *
 * `currentTarget` is a bare object rather than a node: jsdom has none of the
 * pointer-capture API, and the hook reaches for it through `?.` — so the absent
 * methods take the same branch a real browser does before anything is captured.
 */
function pointer(id: number, x: number, y: number) {
  return {
    pointerId: id,
    clientX: x,
    clientY: y,
    currentTarget: {},
  } as unknown as React.PointerEvent;
}

/** A throw across the card, in the units `swipeDirection` reads. */
function throwCard(h: ReturnType<typeof useCardZoom>["handlers"], dx: number) {
  act(() => h.onPointerDown(pointer(1, 200, 200)));
  act(() => h.onPointerMove(pointer(1, 200 + dx, 200)));
  act(() => h.onPointerUp(pointer(1, 200 + dx, 200)));
}

describe("useCardZoom", () => {
  it("still answers a swipe after a pinch that ended a hair above 1x", () => {
    // The state dedup ignores a change under 0.001, and 1.0004 is inside it. The
    // ref took the number anyway, so `view.current.zoom === MIN_ZOOM` stopped
    // matching and swipe-to-next and pull-down-to-close were both dropped —
    // permanently, and with `zoomed` still false so nothing said why.
    const onSwipe = vi.fn();
    const onVerticalSwipe = vi.fn();
    const { result } = renderHook(() => useCardZoom({ onSwipe, onVerticalSwipe }));

    act(() => result.current.zoomTo(MIN_ZOOM + 0.0004));

    expect(result.current.zoom).toBe(MIN_ZOOM);
    expect(result.current.zoomed).toBe(false);
    throwCard(result.current.handlers, -(SWIPE.dist + 20));
    expect(onSwipe).toHaveBeenCalledWith(1);
  });

  it("comes back out of the magnified chrome when reset lands under the dead band", () => {
    // The mirror image, and the stickier one. From a double tap, a pinch down to
    // 1.0005 moves the STATE there — the jump from 2.4 is large — and then
    // reset() writes an exact 1 the dedup refuses to follow. `zoomed` stayed true
    // over a card at 1x, hiding the position counter for good, and pressing Reset
    // again committed the same number and changed nothing.
    const { result } = renderHook(() => useCardZoom({}));

    act(() => result.current.zoomTo(DOUBLE_TAP_ZOOM));
    expect(result.current.zoomed).toBe(true);

    act(() => result.current.zoomTo(MIN_ZOOM + 0.0005));
    act(() => result.current.reset());

    expect(result.current.zoom).toBe(MIN_ZOOM);
    expect(result.current.zoomed).toBe(false);
  });

  it("still treats a drag as a pan once the card is genuinely zoomed", () => {
    // The snap must not swallow a real zoom. Well clear of the dead band, a throw
    // is a pan and must never navigate.
    const onSwipe = vi.fn();
    const { result } = renderHook(() => useCardZoom({ onSwipe }));

    act(() => result.current.zoomTo(DOUBLE_TAP_ZOOM));
    throwCard(result.current.handlers, -(SWIPE.dist + 20));

    expect(onSwipe).not.toHaveBeenCalled();
    expect(result.current.zoomed).toBe(true);
  });
});
