import { createContext, useContext } from "react";

/**
 * Whether a screen has taken the whole device for a piece of theatre.
 *
 * There is exactly one consumer today — the pack opening — and the flag lives up
 * at the root rather than in the route because the thing it has to move is the
 * app shell, which is that route's grandparent. A route cannot dim a nav it does
 * not render.
 *
 * Deliberately not a router concern. It is not "which page is this", it is "is
 * something on screen right now that the chrome would be standing in front of",
 * and that flips several times inside a single route.
 *
 * The context and its hooks live here rather than beside the components so that
 * presentation-mode.tsx exports components and nothing else — a mixed module
 * breaks fast refresh for everything that imports it, which on this route is the
 * whole ceremony.
 */
export const PresentationContext = createContext<{
  active: boolean;
  setActive: (on: boolean) => void;
}>({ active: false, setActive: () => {} });

/** Read by the shell, to get out of the way. */
export function useIsPresenting(): boolean {
  return useContext(PresentationContext).active;
}

/** Claim or release the screen. Used by `<PresentationMode>`, not by routes. */
export function usePresentationControl(): (on: boolean) => void {
  return useContext(PresentationContext).setActive;
}
