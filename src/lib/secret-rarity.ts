// How good YOUR copy of a secret card is.
//
// The third axis in the collection, and deliberately its own vocabulary. A
// player card carries a TIER earned on the course and an EDITION rolled per
// copy; a secret carries a LOOK chosen by the admin (foil, prism edge) and a
// LEVEL rolled per copy. Sharing the metal names with card-edition.ts would have
// been cheaper and wrong: both land in stringly typed places the compiler cannot
// police, and a secret must never be mistaken for a pack finish.
//
// The roll is authoritative in Postgres (`roll_secret_tier`), not here — a
// client-side roll on a card the server hands you is a value anybody could
// re-roll by refreshing. This module only reads, ranks and labels it.

/** Rarest first. The index into this IS the rank. */
export const SECRET_TIER_ORDER = ["mythic", "legendary", "epic", "rare", "common"] as const;

export type SecretTier = (typeof SECRET_TIER_ORDER)[number];

/**
 * Pull rates, in ten-thousandths. Basis points rather than percent for the same
 * reason the edition table uses them: 3.5% is not an integer percent, and a
 * table of integers can be asserted to sum exactly.
 *
 * Mirrors the ladder inside `roll_secret_tier()` in the migration; a test pins
 * the two against each other.
 */
const WEIGHT_BP: Record<SecretTier, number> = {
  mythic: 50, // 0.5%
  legendary: 350, // 3.5%
  epic: 800, // 8%
  rare: 1800, // 18%
  common: 7000, // 70%
};

export const SECRET_TIER_BP_TOTAL = 10_000;
export const SECRET_TIER_WEIGHTS_BP: Readonly<Record<SecretTier, number>> = WEIGHT_BP;

type SecretTierStyle = {
  tier: SecretTier;
  label: string;
  /** Opaque colour for the label under the card. */
  accent: string;
};

const TIERS: Record<SecretTier, Omit<SecretTierStyle, "tier">> = {
  // Muted on purpose: 70% of copies are common, and a loud label on seven cards
  // in ten makes the other three quieter. Same argument editionLabel makes for
  // printing nothing at all on a standard finish — but a secret always says
  // something, because the level is the new fact the card is announcing.
  common: { label: "Common", accent: "oklch(0.72 0.02 240)" },
  rare: { label: "Rare", accent: "oklch(0.82 0.14 210)" },
  epic: { label: "Epic", accent: "oklch(0.82 0.16 300)" },
  legendary: { label: "Legendary", accent: "oklch(0.86 0.16 85)" },
  mythic: { label: "Mythic", accent: "oklch(0.84 0.2 15)" },
};

/**
 * hasOwn, not truthiness: the value arrives from Postgres as a bare string, so a
 * stored `"__proto__"` would otherwise resolve to an inherited property and dodge
 * the fallback. Same guard isEdition uses.
 */
export function isSecretTier(value: unknown): value is SecretTier {
  return typeof value === "string" && Object.hasOwn(TIERS, value);
}

/** Narrow a stored string to the ladder, falling back to the common rung. */
export function toSecretTier(value: string | null | undefined): SecretTier {
  return isSecretTier(value) ? value : "common";
}

export function secretTierStyle(tier: string | null | undefined): SecretTierStyle {
  const id = toSecretTier(tier);
  return { tier: id, ...TIERS[id] };
}

/** 0 is mythic. An unrecognised value sorts last, so bestSecretTier can upgrade it. */
export function secretTierRank(tier: string | null | undefined): number {
  const i = isSecretTier(tier) ? SECRET_TIER_ORDER.indexOf(tier) : -1;
  return i === -1 ? SECRET_TIER_ORDER.length : i;
}

/**
 * How many pips a level lights: 5 for mythic down to 1 for common. The inverse
 * of the rank, and derived from the ladder's own length so a sixth rung moves it
 * rather than needing to be found here.
 *
 * Routed through toSecretTier rather than taking secretTierRank's out-of-band
 * answer: an unrecognised string would otherwise light *zero* pips, and an empty
 * row of diamonds reads as a card that failed to render, not as a common.
 */
export function secretTierLevel(tier: string | null | undefined): number {
  return SECRET_TIER_ORDER.length - secretTierRank(toSecretTier(tier));
}

/**
 * Best wins, never down. A second copy that rolled worse is a duplicate, not a
 * downgrade. The identical rule runs in Postgres inside `pull_secret_card`,
 * because the vault and the ledger have to agree about which copy you own.
 */
export function bestSecretTier(
  a: string | null | undefined,
  b: string | null | undefined,
): SecretTier {
  return toSecretTier(secretTierRank(a) <= secretTierRank(b) ? a : b);
}

export function secretTierLabel(tier: string | null | undefined): string {
  return secretTierStyle(tier).label;
}

/**
 * "0.5% pull". Derived from the odds table rather than written out, so the copy
 * printed under a card cannot drift from the rate that produced it.
 */
export function secretTierOddsLabel(tier: string | null | undefined): string {
  return `${WEIGHT_BP[toSecretTier(tier)] / 100}% pull`;
}

/** "MYTHIC · 0.5% pull" — the one line printed under a secret. */
export function secretTierCaption(tier: string | null | undefined): string {
  return `${secretTierLabel(tier)} · ${secretTierOddsLabel(tier)}`;
}

/**
 * "Legendary or better" — what a streak milestone PROMISED, not what a copy is.
 *
 * Its own phrasing rather than reusing secretTierCaption, which prints the base
 * pull rate: under a card that was guaranteed, "3.5% pull" is the odds of the
 * thing that did not happen. The caption stays right in the vault, where a copy
 * carries no memory of how it was earned; this line belongs only on the screen
 * making the promise.
 *
 * Typed strictly, unlike its neighbours. They are loose because their values
 * arrive from Postgres as bare strings; a floor is a literal in
 * STREAK_MILESTONES, so a fallback here would hide a typo rather than survive one.
 */
export function secretTierFloorLabel(tier: SecretTier): string {
  // Nothing sits above the top rung, so "or better" would be writing a cheque the
  // ladder cannot cash.
  return tier === SECRET_TIER_ORDER[0]
    ? `${secretTierLabel(tier)}, guaranteed`
    : `${secretTierLabel(tier)} or better`;
}

/**
 * Whether the level alone earns the celebration burst, whatever the card is.
 * Legendary and up, so roughly one secret in twenty-five stops the garden.
 */
export function secretTierCelebrates(tier: string | null | undefined): boolean {
  return secretTierRank(tier) <= secretTierRank("legendary");
}
