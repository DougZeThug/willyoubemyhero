import { useEffect, useState } from "react";

/**
 * Whether the device asks for less motion, as a live subscription.
 *
 * Reactive on purpose. Most of this app reads the preference once, inline, at the
 * moment it is about to make a noise or throw confetti — see card-sfx.ts and
 * card-confetti.ts, both called from plain functions with no React around them.
 * That is still the right shape there.
 *
 * A component that *chooses a duration* needs something else: the value has to be
 * part of render, and it has to survive somebody flipping the system setting while
 * the screen is open. Hence a hook, and hence only one of them — this was a private
 * copy inside holo-card.tsx until the pack ceremony needed the same answer.
 *
 * The two forms can disagree for a frame after the setting changes. Nothing in the
 * app can tell, because the module-scope reads happen inside event handlers that
 * are a whole gesture away from a media query flipping.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  // Not an initialiser: the server has no matchMedia, and starting at `true` on the
  // client would hand hydration a different first render than the one it is
  // matching against. Everything animates for one frame, then settles.
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
