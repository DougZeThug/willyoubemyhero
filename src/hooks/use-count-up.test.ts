// Stat tiles on the player page roll into place rather than snapping.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCountUp } from "./use-count-up";
import { setMatchMedia } from "@/test/setup";

/** Drive requestAnimationFrame by hand so the easing is deterministic. */
function useFakeFrames() {
  let now = 0;
  const queue: FrameRequestCallback[] = [];
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    queue.push(cb);
    return queue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  return {
    advance(ms: number) {
      now += ms;
      const pending = queue.splice(0, queue.length);
      act(() => pending.forEach((cb) => cb(now)));
    },
    get pending() {
      return queue.length;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useCountUp", () => {
  it("returns null for a null target — nothing to count up to", () => {
    const { result } = renderHook(() => useCountUp(null));
    expect(result.current).toBeNull();
  });

  it("returns the target immediately under reduced motion", () => {
    setMatchMedia((q) => q.includes("prefers-reduced-motion"));
    const { result } = renderHook(() => useCountUp(42_000));
    expect(result.current).toBe(42_000);
  });

  it("returns the target immediately for a zero duration", () => {
    const { result } = renderHook(() => useCountUp(42_000, 0));
    expect(result.current).toBe(42_000);
  });

  it("eases toward the target and lands exactly on it", () => {
    const frames = useFakeFrames();
    const { result } = renderHook(() => useCountUp(1_000, 600));

    frames.advance(300);
    // easeOutCubic at the halfway point is 0.875, comfortably past linear.
    expect(result.current).toBeGreaterThan(500);
    expect(result.current).toBeLessThan(1_000);

    frames.advance(300);
    // The easing only ever approaches the target; the final frame pins it.
    expect(result.current).toBe(1_000);
  });

  it("stops requesting frames once it has arrived", () => {
    const frames = useFakeFrames();
    renderHook(() => useCountUp(1_000, 600));
    frames.advance(600);
    frames.advance(600);
    expect(frames.pending).toBe(0);
  });

  it("restarts when the target changes", () => {
    const frames = useFakeFrames();
    const { result, rerender } = renderHook(({ target }) => useCountUp(target, 600), {
      initialProps: { target: 1_000 },
    });
    frames.advance(600);
    expect(result.current).toBe(1_000);

    rerender({ target: 2_000 });
    frames.advance(600);
    expect(result.current).toBe(2_000);
  });

  it("drops to null when the target becomes null", () => {
    const frames = useFakeFrames();
    const { result, rerender } = renderHook(({ target }) => useCountUp(target, 600), {
      initialProps: { target: 1_000 as number | null },
    });
    frames.advance(600);
    rerender({ target: null });
    expect(result.current).toBeNull();
  });

  it("cancels its pending frame on unmount", () => {
    useFakeFrames();
    const { unmount } = renderHook(() => useCountUp(1_000, 600));
    unmount();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  it("survives a browser with no matchMedia at all", () => {
    // The hook uses optional chaining for exactly this; older iOS Safari in a
    // webview can be missing it.
    vi.stubGlobal("matchMedia", undefined);
    const frames = useFakeFrames();
    const { result } = renderHook(() => useCountUp(500, 600));
    frames.advance(600);
    expect(result.current).toBe(500);
  });
});
