import { useEffect, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import { PresentationContext, usePresentationControl } from "@/hooks/use-presentation";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";

export function PresentationProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  return (
    <PresentationContext.Provider value={{ active, setActive }}>
      {children}
    </PresentationContext.Provider>
  );
}

/**
 * Claim the screen while `active`, and give it back on unmount.
 *
 * Renders nothing itself. The vignette is a separate component, because it has to
 * sit inside the presenting route's own stacking context — see PresentationStage.
 */
export function PresentationMode({ active }: { active: boolean }) {
  const setActive = usePresentationControl();

  useEffect(() => {
    setActive(active);
    // Navigating away mid-ceremony — a back gesture out of the pack — would
    // otherwise leave the nav faded out and inert on every screen after it, with
    // no way back to it.
    return () => setActive(false);
  }, [active, setActive]);

  return null;
}

/**
 * The dark room the scene is played in.
 *
 * A sibling of the scene, never an ancestor of it. `backdrop-filter` is a
 * grouping property: an element carrying one flattens its whole subtree out of
 * any 3D context, which for the pack means the shards and the fan lose their
 * perspective and collapse into flat cutouts.
 *
 * Mounted by the *route* rather than by the ceremony, because it has to outlive
 * it. `PackOpening` unmounts on the frame the stand takes over, and an exit
 * animation on a component that is being unmounted by its parent never runs — so
 * a backdrop owned by the ceremony pops off in one frame, in the middle of the
 * handoff it exists to cover.
 */
export function PresentationStage({ active, blur = true }: { active: boolean; blur?: boolean }) {
  const reduced = usePrefersReducedMotion();
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.28 }}
          className="pointer-events-none fixed inset-0 z-0"
        >
          {blur && !reduced && <div className="absolute inset-0 backdrop-blur-sm" />}
          {/* Two grounds, not one. The wash is what dims whatever the route was
              already showing; the vignette is what puts the card in a pool of
              light rather than on a flat dark rectangle. */}
          <div className="absolute inset-0 bg-background/80" />
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(120% 75% at 50% 42%, transparent 0%, oklch(0 0 0 / 55%) 62%, oklch(0 0 0 / 82%) 100%)",
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
