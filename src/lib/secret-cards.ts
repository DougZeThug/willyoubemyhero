// Secret cards: the pulled-only side of the collection.
//
// Client-safe. Nothing here reaches the database, and nothing here knows how many
// secret cards exist — the set size is the one number the whole feature withholds.
import type { Rarity } from "./card-rarity";

/**
 * The look of a secret card.
 *
 * Admin-curated art that is not a person. Pulled, never derived, so it lives
 * outside RARITY rather than inside it: those six strings are persisted in
 * event_participants.card_rarity, and a seventh would mean a tier an admin could
 * hand to a player who never earned it.
 *
 * `tier: "base"` is here only to satisfy Rarity["tier"]: RarityTier. NOTHING MAY
 * BRANCH ON IT — the reveal calls playReveal(SECRET_CHIME) explicitly and
 * SecretBackPanel hardcodes its reason line, precisely so this lie stays inert.
 *
 * Green into magenta on purpose: it is the one hue axis the six tiers leave empty
 * (gold 90-95, violet 300, magenta 330, amber 85, cyan 195-210, slate 240), and it
 * is the actual signature of a diffraction grating, which is what the rosette
 * imitates. Nothing else in the app is green.
 */
export const SECRET_RARITY: Rarity = {
  tier: "base",
  label: "Secret",
  // Lightness matched to champion's rather than exceeded: this art is uploaded by
  // an admin and its content is unknown, and a hotter dodge stop floods it.
  holoA: "oklch(0.92 0.17 160)",
  holoB: "oklch(0.85 0.2 325)",
  strength: 1,
  sparkle: 1,
  border: "oklch(0.9 0.19 160)",
  accent: "oklch(0.9 0.19 160)",
  pattern: "rosette",
  idle: true,
  prismEdge: true,
  // Outside the ladder. Secrets are never sorted against the roster — they have
  // their own shelf — but a rank inside 0..5 would collide with a real tier.
  rank: -1,
};

/** Printed where a player card prints TIER_REASON. */
export const SECRET_REASON = "Not on the roster";

/** Chime ids in card-sfx.ts. Not tiers — see the note on SECRET_RARITY. */
export const SECRET_CHIME = "secret";
export const SECRET_DUPE_CHIME = "secretDupe";

/**
 * A secret card as the owner sees it. There is no `total` and no `setSize` here
 * on purpose; the server never sends one either.
 */
export type SecretCardView = {
  id: string;
  name: string;
  flavour: string | null;
  foil: string;
  artUrl: string | null;
  backUrl: string | null;
};

export type OwnedSecret = SecretCardView & {
  /** ISO date of the first pull, for the card back. */
  firstPulledOn: string;
  /** Pulls including duplicates. 1 means you have found it once. */
  count: number;
  /**
   * How many people have found this card. Deliberately on OwnedSecret and not on
   * SecretCardView: a count only ever appears on a card you already own, and
   * SecretCardView is what the fourth slot renders mid-reveal.
   */
  ownerCount: number;
};

export type SecretDayStatus = {
  claimed: boolean;
  /** Null when nobody is claimed — the server tells a stranger nothing. */
  day: string | null;
  pulledToday: boolean;
  /** How many this member owns. Never how many exist. */
  pulled: number;
  /** Only ever "there is something to pull", never how much. */
  available: boolean;
  resetsAt: string | null;
};

export type SecretPullResult =
  | {
      ok: true;
      day: string;
      duplicate: boolean;
      /** False when this call resumed a pull already spent today. */
      fresh: boolean;
      card: SecretCardView;
    }
  | { ok: false; reason: "unavailable" };

/**
 * Foil treatments a secret card may wear.
 *
 * Its own vocabulary rather than FoilPattern, so adding a look for secrets can
 * never accidentally become a look a player card can be given. Stored in
 * `secret_cards.foil` with no CHECK behind it, so an unknown value falls back
 * here the way an unrecognised card_rarity falls back to base.
 */
const SECRET_FOILS: Record<string, Rarity> = {
  rosette: SECRET_RARITY,
};

export function secretFoil(id: string | null | undefined): Rarity {
  return (id && SECRET_FOILS[id]) || SECRET_RARITY;
}

/** "3 secrets pulled" / "1 secret pulled". Never rendered at zero — see the vault. */
export function secretsPulledLabel(n: number): string {
  return `${n} secret${n === 1 ? "" : "s"} pulled`;
}
