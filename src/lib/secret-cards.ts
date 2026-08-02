// Secret cards: the pulled-only side of the collection.
//
// Client-safe. Nothing here reaches the database, and nothing here knows how many
// secret cards exist — the set size is the one number the whole feature withholds.
import type { BorderFx, Rarity } from "./card-rarity";

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
 * imitates. Nothing else in the app is green — though since foils became
 * admin-picked the green is only the *default* tell; the invariant that marks a
 * secret across every foil is the prism edge, which no earned tier may carry.
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
  borderFx: string;
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
 *
 * Every entry keeps `label: "Secret"` (the back panel prints it — the look's
 * name must not leak onto the card), `prismEdge: true` (the universal tell) and
 * `rank: -1`. Ids are add-only: they persist in secret_cards rows, so renaming
 * one silently resets existing cards to the default. holoA lightness stays at
 * or under champion's 0.92 for the same reason SECRET_RARITY's does — the art
 * is admin-uploaded and unknown, and a hotter dodge stop floods it.
 */
const SECRET_FOILS: Record<string, Rarity> = {
  rosette: SECRET_RARITY,
  aurora: {
    ...SECRET_RARITY,
    holoA: "oklch(0.9 0.13 220)",
    holoB: "oklch(0.84 0.17 300)",
    border: "oklch(0.87 0.14 250)",
    accent: "oklch(0.87 0.14 250)",
    pattern: "prismatic",
  },
  ember: {
    ...SECRET_RARITY,
    // Amber into magenta, never amber into red — under color-dodge a warm→warm
    // pair compounds with warm artwork and floods it (the champion lesson).
    holoA: "oklch(0.88 0.17 70)",
    holoB: "oklch(0.78 0.19 340)",
    border: "oklch(0.84 0.17 45)",
    accent: "oklch(0.84 0.17 45)",
  },
  ultraviolet: {
    ...SECRET_RARITY,
    holoA: "oklch(0.86 0.2 330)",
    holoB: "oklch(0.76 0.16 285)",
    border: "oklch(0.8 0.18 310)",
    accent: "oklch(0.8 0.18 310)",
    pattern: "scanline",
    sparkle: 0.8,
  },
  chrome: {
    ...SECRET_RARITY,
    // Near-achromatic on purpose: the one look that lets loud art speak alone.
    holoA: "oklch(0.92 0.02 240)",
    holoB: "oklch(0.78 0.05 260)",
    border: "oklch(0.86 0.03 250)",
    accent: "oklch(0.86 0.03 250)",
    pattern: "prismatic",
    sparkle: 0.85,
  },
};

/** Admin-facing labels. One list feeds the panel selects and the zod enums. */
export const SECRET_FOIL_OPTIONS = [
  { id: "rosette", label: "Spectral Green" },
  { id: "aurora", label: "Aurora" },
  { id: "ember", label: "Ember" },
  { id: "ultraviolet", label: "Ultraviolet" },
  { id: "chrome", label: "Liquid Chrome" },
] as const;

export const SECRET_BORDER_FX_OPTIONS = [
  { id: "spin", label: "Prism Spin" },
  { id: "pulse", label: "Heartbeat" },
  { id: "shimmer", label: "Shimmer" },
  { id: "steady", label: "Steady" },
] as const;

const BORDER_FX_IDS = new Set<string>(SECRET_BORDER_FX_OPTIONS.map((o) => o.id));

// Memo for foil+borderFx combinations, so render sites get referentially stable
// Rarity objects across renders instead of a fresh spread each call.
const FX_VARIANTS = new Map<string, Rarity>();

export function secretFoil(id: string | null | undefined, borderFx?: string | null): Rarity {
  const base = (id && SECRET_FOILS[id]) || SECRET_RARITY;
  // "spin" is what an absent borderFx already means, so it takes the base object
  // unchanged — same fallback contract as an unknown id.
  if (!borderFx || borderFx === "spin" || !BORDER_FX_IDS.has(borderFx)) return base;
  const key = `${id && SECRET_FOILS[id] ? id : "rosette"}.${borderFx}`;
  let variant = FX_VARIANTS.get(key);
  if (!variant) {
    variant = { ...base, borderFx: borderFx as BorderFx };
    FX_VARIANTS.set(key, variant);
  }
  return variant;
}

/** "3 secrets pulled" / "1 secret pulled". Never rendered at zero — see the vault. */
export function secretsPulledLabel(n: number): string {
  return `${n} secret${n === 1 ? "" : "s"} pulled`;
}
