import type { RarityTier } from "./card-rarity";

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
 * How loud a tier is, on the same 0..1 scale the wall behind it uses.
 *
 * Exported so the particle burst and the wash agree. Two scales would drift, and
 * a champion whose wall lit up while its burst stayed at base strength is exactly
 * the kind of mismatch nobody can name but everybody notices.
 */
export function ambienceStrength(tier: RarityTier): number {
  return GLOW[tier];
}
