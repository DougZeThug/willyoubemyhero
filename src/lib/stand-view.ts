// What the reveal stand shows for the slot it is on, worked out in one place.
//
// pack-stand.tsx used to decide all of this inline, in the same function that
// owns the effects and the gesture, which left the one component carrying every
// branch of every screen state at once. None of it needs React: it is a slot in
// and a handful of facts out, so it lives here where a test can exhaust it.
import type { Variants } from "motion/react";
import type { StandSlot } from "@/components/pack-stand";
import type { Edition } from "@/lib/card-edition";
import { rarityStyle } from "@/lib/card-rarity";
import { upgradeLabel } from "@/lib/pack-outcome";

/** A roster card turns over at the house speed. */
export const FLIP_MS = 500;
/**
 * A secret takes more than twice as long.
 *
 * It is the one card on the screen nobody has seen before, and the only one
 * whose turn is the payoff rather than a way of getting at the stats on the back.
 */
export const SECRET_FLIP_MS = 1100;

/**
 * How long a secret's impact lasts.
 *
 * Short. A flash and a shake are punctuation, and anything long enough to watch
 * stops being an impact and becomes an effect — the confetti afterwards is what
 * carries the celebration.
 */
export const SLAM_MS = 460;

/**
 * How far into the turn the face has actually arrived.
 *
 * Not a new number: it is the fraction the landing burst has always used, named
 * here because the second beat has to be measured from the same instant. A card
 * is front-on well before the rotation stops, and a beat measured from the flip's
 * full length would begin a quarter-second after the moment it is punctuating.
 */
export const FACE_LANDS_AT = 0.86;

/**
 * The beat a special pull is held on before its metal comes up.
 *
 * Long enough to read as two events — the card, and then what it turned out to
 * be — and short enough that nobody standing in a garden thinks it has stalled.
 */
export const BEAT_MS = 250;

/** Beat one holds the face at 60%; beat two lets it go. */
export type StandBeat = "none" | "held" | "bloomed";

/** How long a turn takes: the house speed, or the secret's own. */
export function flipMsFor(onSecret: boolean): number {
  return onSecret ? SECRET_FLIP_MS : FLIP_MS;
}

/**
 * What a slot is, as the stand reads it.
 *
 * `current` is undefined only for an empty pack, which still has to render a
 * stand rather than throw.
 */
export function resolveStand(current?: StandSlot) {
  const onSecret = current?.slot.kind === "secret";
  const ep = current?.ep ?? null;
  const secret = current?.slot.kind === "secret" ? current.slot.card : null;
  const rarity = current?.rarity ?? rarityStyle("base");
  // A secret wears the prism ring and never an edition frame; a roster card
  // wears whatever Postgres minted, and standard until that is known.
  const edition: Edition | null = onSecret ? null : (current?.edition ?? null);
  const name = onSecret ? (secret?.name ?? "Secret") : (ep?.participant?.name ?? "—");
  const outcome = current?.outcome ?? "duplicate";
  const isDupe = outcome === "duplicate";
  /**
   * The number the ribbon prints for whatever is on the mark.
   *
   * Null rather than 1 when the route has not answered: a stand that assumed
   * would stamp NEW on a card it knows nothing about, which is the one mistake
   * this ribbon must never make.
   */
  const standCopies = current?.copies ?? null;
  const climbed = current && outcome === "upgrade" ? upgradeLabel(current.slot) : null;
  return { onSecret, ep, secret, rarity, edition, name, outcome, isDupe, standCopies, climbed };
}

/**
 * Where the card starts when the ceremony has just gathered a deck onto this mark.
 *
 * It fades in on the spot: a card sliding in from off-screen would read as the
 * deck having been thrown away.
 *
 * Two functions rather than one that takes `gathered`. That flag is read off a
 * ref during render (the latch lives in PackStand), and a value derived from a
 * ref cannot be handed to a function without the compiler lint reading it as a
 * ref escaping — so the choice between them stays in the JSX, where it was.
 */
export function gatheredInitial(reduced: boolean) {
  return { opacity: 0, x: 0, scale: reduced ? 1 : 0.94 };
}

/** Where the card starts when the sequence is stepping on: in from the right. */
export function steppedInitial(reduced: boolean) {
  return { opacity: 0, x: reduced ? 0 : 64, scale: 0.94 };
}

/** A variant, so the exit can read where the finger left the card. */
export function exitVariants(reduced: boolean): Variants {
  return {
    out: (x: number) => ({ opacity: 0, x: reduced ? 0 : x, scale: 0.94 }),
  };
}
