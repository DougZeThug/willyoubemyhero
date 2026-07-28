// Celebration bursts, in one place.
//
// The pack screen used to fire four hard-coded hexes that are nobody's tier while
// the player page fired the tier's own colours, so the same champion celebrated
// in two different palettes depending on which screen you were looking at.
import type { Rarity } from "./card-rarity";

function reducedMotion() {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

/** Loaded on demand: nobody pays for the confetti bundle until something is won. */
async function cannon() {
  const { default: confetti } = await import("canvas-confetti");
  return confetti;
}

/** The burst a champion or podium pull earns. */
export async function celebrate(rarity: Rarity) {
  if (reducedMotion()) return;
  const confetti = await cannon();
  confetti({
    particleCount: 90,
    spread: 75,
    origin: { y: 0.55 },
    colors: [rarity.accent, rarity.holoA, rarity.holoB, "#ffffff"],
  });
}

/**
 * A secret's burst.
 *
 * A champion's is already the loudest thing the app does, so this has to be a
 * different *shape* rather than more of the same: two shots fired inward from the
 * bottom corners, which reads as the card being framed rather than as a bigger
 * version of somebody winning a race.
 */
export async function celebrateSecret(rarity: Rarity) {
  if (reducedMotion()) return;
  const confetti = await cannon();
  const colors = [rarity.accent, rarity.holoA, rarity.holoB, "#ffffff"];
  const shot = (x: number, angle: number) =>
    confetti({ particleCount: 60, spread: 55, startVelocity: 45, origin: { x, y: 0.9 }, angle, colors }); // prettier-ignore
  shot(0.1, 60);
  shot(0.9, 120);
}
