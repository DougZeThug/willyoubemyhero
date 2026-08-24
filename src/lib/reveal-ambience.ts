import type { RarityTier } from "./card-rarity";
import { editionStyle, type Edition } from "./card-edition";

/**
 * How loud the room gets for a tier.
 *
 * Kept here rather than on the Rarity type on purpose. card-rarity.ts answers
 * "what did this player do at the combine" — it is derived from official times,
 * station splits and penalties, and it is the thing persisted in
 * `event_participants.card_rarity`. How bright the wall behind a card goes is a
 * presentation decision about the same tier, and it belongs with the thing doing
 * the presenting.
 *
 * The order is not `rank`. Rank sorts the vault best-to-worst, where `base` sits
 * in the middle and `penaltyBox` and `dnf` below it — but a penalty-box card is
 * *funnier* than a base card and deserves its colour on the wall, while a DNF is
 * supposed to look like the lights went out. So this is its own scale.
 */
const GLOW: Record<RarityTier, number> = {
  champion: 1,
  podium: 0.7,
  stationKing: 0.6,
  penaltyBox: 0.42,
  base: 0.34,
  // Deliberately the quietest thing on the scale. The tier means somebody did
  // not finish, and the card is meant to read as the power being cut.
  dnf: 0.16,
};

/** The secret is not a tier — see SECRET_RARITY — so it gets its own level. */
export const SECRET_GLOW = 1;

/**
 * A finished set, and the only thing on this scale that is not a card.
 *
 * Pinned to the same 1 a secret gets rather than invented above it: the scale
 * tops out at full, the wash has nowhere brighter to go, and a number over 1
 * would silently clamp and read as a level that means something when it does
 * not. What separates the two is the COLOUR and the confetti, not the volume.
 */
export const COMPLETE_GLOW = 1;

/**
 * How loud a tier is, on the same 0..1 scale the wall behind it uses.
 *
 * Exported so the particle burst and the wash agree. Two scales would drift, and
 * a champion whose wall lit up while its burst stayed at base strength is exactly
 * the kind of mismatch nobody can name but everybody notices.
 *
 * The finish adds to it rather than scaling it, and for the same reason GLOW is
 * not `rank`: the two axes are independent, so a rare finish should lift a quiet
 * tier by the same amount it lifts a loud one. Platinum's 0.5 is set so that even
 * the dimmest tier it can land on clears the threshold where the wash grows its
 * second core — a 0.5% pull has to land in the room whatever the card is.
 *
 * The default keeps every existing caller compiling and unchanged.
 */
export function ambienceStrength(tier: RarityTier, edition: Edition = "standard"): number {
  return Math.min(1, GLOW[tier] + editionStyle(edition).lift);
}
