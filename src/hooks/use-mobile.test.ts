// The whole app is phone-first, so this breakpoint decides a lot of layout.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useIsMobile } from "./use-mobile";

type Listener = () => void;

/** A matchMedia whose viewport width can be changed mid-test. */
function stubViewport(initialWidth: number) {
  const listeners = new Set<Listener>();
  let width = initialWidth;

  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    get: () => width,
  });

  vi.stubGlobal("matchMedia", (query: string) => ({
    // The hook reads window.innerWidth itself; the query only drives the event.
    matches: width < 768,
    media: query,
    onchange: null,
    addEventListener: (_: string, fn: Listener) => listeners.add(fn),
    removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
    addListener: (fn: Listener) => listeners.add(fn),
    removeListener: (fn: Listener) => listeners.delete(fn),
    dispatchEvent: () => false,
  }));

  return {
    resizeTo(next: number) {
      width = next;
      act(() => listeners.forEach((fn) => fn()));
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useIsMobile", () => {
  it("is true below the 768px breakpoint", () => {
    stubViewport(390);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("is false at and above the breakpoint", () => {
    stubViewport(768);
    expect(renderHook(() => useIsMobile()).result.current).toBe(false);

    stubViewport(1440);
    expect(renderHook(() => useIsMobile()).result.current).toBe(false);
  });

  it("is true one pixel below the breakpoint", () => {
    stubViewport(767);
    expect(renderHook(() => useIsMobile()).result.current).toBe(true);
  });

  it("follows a viewport that changes — a phone rotating to landscape", () => {
    const viewport = stubViewport(390);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);

    viewport.resizeTo(844);
    expect(result.current).toBe(false);

    viewport.resizeTo(390);
    expect(result.current).toBe(true);
  });

  it("detaches its listener on unmount", () => {
    const viewport = stubViewport(390);
    const { unmount } = renderHook(() => useIsMobile());
    expect(viewport.listenerCount).toBe(1);
    unmount();
    expect(viewport.listenerCount).toBe(0);
  });
});
