// jsdom setup, loaded before every browser-environment test file.
import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// React reports the failing component through console.error("The above error
// occurred in the <%s> component:"). Vitest flattens extra args, so relay every
// console.error verbatim with a prefix, keeping the format string intact.
// eslint-disable-next-line no-console
const realConsoleError = console.error.bind(console);
// eslint-disable-next-line no-console
console.error = (...args: unknown[]) => {
  realConsoleError(
    "[console.error]",
    ...args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))),
  );
};

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
