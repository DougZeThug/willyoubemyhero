// Celebration bursts, in one place.
//
// The pack screen used to fire four hard-coded hexes that are nobody's tier while
// the player page fired the tier's own colours, so the same champion celebrated
// in two different palettes depending on which screen you were looking at.
import type { Rarity } from "./card-rarity";
import { editionStyle, type Edition } from "./card-edition";
import { oklchToHex } from "./color";

function reducedMotion() {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * A tier's colours, in the only notation canvas-confetti can read.
 *
 * It parses colours by stripping everything that is not a hex digit and taking
 * the first six characters, so an `oklch()` string comes out as an unrelated
 * olive — and because every tier in this app starts `oklch(0.8…`, they all came
 * out as roughly the *same* olive. The confetti has been the wrong colour since
 * it was added, and identically wrong for every tier, which is why nobody
 * noticed.
 */
function palette(rarity: Rarity, extra: string[] = []): string[] {
  return [rarity.accent, rarity.holoA, rarity.holoB, ...extra].map(oklchToHex);
}

/** Loaded on demand: nobody pays for the confetti bundle until something is won. */
async function cannon() {
  const { default: confetti } = await import("canvas-confetti");
  return confetti;
}

/**
 * The spray of light a card throws as it lands.
 *
 * Not confetti, and the difference is the point. Confetti is a celebration —
 * paper, falling, lasting seconds — and it belongs to winning something. This is
 * a single outward pulse from behind the card, gone in half a second, and it
 * belongs to the *impact*: it is the visual half of the chime, not a party.
 *
 * So: no gravity to speak of, high velocity, tight ticks, and origin dead centre
 * where the card is rather than the bottom of the screen where a cannon would be.
 */
export async function burst(rarity: Rarity, strength = 1) {
  if (reducedMotion()) return;
  const confetti = await cannon();
  confetti({
    particleCount: Math.round(26 * strength),
    spread: 360,
    startVelocity: 26 * strength,
    // Barely falls. A particle that arcs is debris; one that flies straight out
    // and fades is light.
    gravity: 0.35,
    decay: 0.9,
    ticks: 45,
    scalar: 0.7,
    origin: { y: 0.44 },
    colors: palette(rarity).slice(0, 2).concat("#ffffff"),
    // Round, not rectangular: the default confetti shape is a paper rectangle
    // that tumbles, which is exactly the reading this is avoiding.
    shapes: ["circle"],
  });
}

/**
 * The burst a champion or podium pull earns — or a good enough finish on any
 * tier at all.
 *
 * The edition's metal joins the palette rather than replacing it, and buys a few
 * more particles: a platinum base card should land harder than a plain one
 * without pretending its owner won the race. Both axes in one burst, which is
 * the same rule the card's own frame follows.
 */
export async function celebrate(rarity: Rarity, edition: Edition = "standard") {
  if (reducedMotion()) return;
  const confetti = await cannon();
  const edn = editionStyle(edition);
  confetti({
    particleCount: Math.round(90 * (1 + edn.lift * 0.5)),
    spread: 75,
    origin: { y: 0.55 },
    colors: palette(rarity, edn.lift > 0 ? [edn.accent, "#ffffff"] : ["#ffffff"]),
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
  const colors = palette(rarity, ["#ffffff"]);
  const shot = (x: number, angle: number) =>
    confetti({ particleCount: 60, spread: 55, startVelocity: 45, origin: { x, y: 0.9 }, angle, colors }); // prettier-ignore
  shot(0.1, 60);
  shot(0.9, 120);
}
