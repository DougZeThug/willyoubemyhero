// jsdom setup, loaded before every browser-environment test file.
import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// jsdom has no matchMedia. use-count-up.ts, card-sfx.ts and use-mobile.tsx all
// call it, and the first two branch on prefers-reduced-motion — so the stub has
// to be a real object with listeners, not a bare `{ matches: false }`.
type MediaListener = (e: MediaQueryListEvent) => void;

export function setMatchMedia(matcher: (query: string) => boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const listeners = new Set<MediaListener>();
    return {
      matches: matcher(query),
      media: query,
      onchange: null,
      addEventListener: (_: string, fn: MediaListener) => listeners.add(fn),
      removeEventListener: (_: string, fn: MediaListener) => listeners.delete(fn),
      // Deprecated pair, still used by some libraries.
      addListener: (fn: MediaListener) => listeners.add(fn),
      removeListener: (fn: MediaListener) => listeners.delete(fn),
      dispatchEvent: () => false,
    };
  });
}

beforeEach(() => {
  // Default: nothing matches, so animations run and the viewport reads desktop.
  setMatchMedia(() => false);
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
