// Every animation in the card system asks this hook whether it is allowed to
// run, so a regression here is silent and total.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePrefersReducedMotion } from "./use-reduced-motion";

type Listener = (e: MediaQueryListEvent) => void;

/**
 * A matchMedia whose answer can be flipped mid-test.
 *
 * Hand-rolled rather than the shared `setMatchMedia` from src/test/setup.ts: that
 * one builds its listener set inside the mock factory and hands back no way to
 * fire it, which is exactly what the "follows a setting" case needs.
 */
function stubReducedMotion(initial: boolean) {
  const listeners = new Set<Listener>();
  let reduced = initial;

  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion") && reduced,
    media: query,
    onchange: null,
    addEventListener: (_: string, fn: Listener) => listeners.add(fn),
    removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
    addListener: (fn: Listener) => listeners.add(fn),
    removeListener: (fn: Listener) => listeners.delete(fn),
    dispatchEvent: () => false,
  }));

  return {
    set(next: boolean) {
      reduced = next;
      act(() => listeners.forEach((fn) => fn({ matches: next } as MediaQueryListEvent)));
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePrefersReducedMotion", () => {
  it("reports the setting on mount", () => {
    stubReducedMotion(true);
    expect(renderHook(() => usePrefersReducedMotion()).result.current).toBe(true);
  });

  it("is false when nothing is asking for less motion", () => {
    stubReducedMotion(false);
    expect(renderHook(() => usePrefersReducedMotion()).result.current).toBe(false);
  });

  it("follows a setting flipped while the screen is open", () => {
    const mq = stubReducedMotion(false);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);

    mq.set(true);
    expect(result.current).toBe(true);

    mq.set(false);
    expect(result.current).toBe(false);
  });

  it("detaches its listener on unmount", () => {
    const mq = stubReducedMotion(true);
    const { unmount } = renderHook(() => usePrefersReducedMotion());
    expect(mq.listenerCount).toBe(1);
    unmount();
    expect(mq.listenerCount).toBe(0);
  });

  it("survives an environment with no matchMedia at all", () => {
    vi.stubGlobal("matchMedia", undefined);
    // Not a hypothetical: this is what an older jsdom and a server render both
    // look like, and the optional call in the hook is the only thing between
    // that and a crash on every card in the app.
    expect(() => renderHook(() => usePrefersReducedMotion())).not.toThrow();
  });
});
