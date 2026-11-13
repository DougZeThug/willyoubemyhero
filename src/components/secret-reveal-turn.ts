import { useEffect, useRef, useState } from "react";
import { celebrateSecret } from "@/lib/card-confetti";
import { cue, playReveal } from "@/lib/card-sfx";
import { SECRET_CHIME, SECRET_DUPE_CHIME } from "@/lib/secret-cards";
import { prefersReducedMotionNow } from "@/lib/motion";

const TURN_DELAY_MS = 260;

/**
 * The face-down beat every secret reveal shares: celebrate once, then turn the
 * card onto its art. Returns whether the turn has happened.
 *
 * Reads the preference synchronously (not the hook): this runs on the first frame
 * after `enabled` flips, before the hook would have settled.
 */
export function useSecretRevealTurn(
  duplicate: boolean,
  rarity: Parameters<typeof celebrateSecret>[0],
  enabled = true,
): boolean {
  const [revealed, setRevealed] = useState(false);
  const celebratedRef = useRef(false);

  useEffect(() => {
    if (!enabled || celebratedRef.current) return;
    celebratedRef.current = true;
    cue("secretImpact");
    playReveal(duplicate ? SECRET_DUPE_CHIME : SECRET_CHIME);
    // A duplicate is still yours, but it does not get the cannon.
    if (!duplicate) void celebrateSecret(rarity);
    if (prefersReducedMotionNow()) {
      setRevealed(true);
      return;
    }
    const t = setTimeout(() => setRevealed(true), TURN_DELAY_MS);
    return () => clearTimeout(t);
  }, [enabled, duplicate, rarity]);

  return revealed;
}
