// Finished secret-card sets, and the one number this feature is otherwise built
// to withhold.
//
// Every other surface in the secret-card feature goes out of its way not to say
// how big a set is — SecretBackPanel prints no serial, getSecretCollections
// returns names without sizes, secret_cards is kept out of realtime so a row
// count cannot be inferred from a broadcast. Not knowing how much is left is
// what makes the daily pull worth taking.
//
// A completed set is the designed exception, because there the number IS the
// prize. `size` below only ever arrives attached to a trophy somebody has
// already earned; there is no shape in this file that can carry the size of a
// set still being collected, and that is deliberate.
//
// `via` is stored in collection_trophies.via, so it is append-only for the same
// reason award category ids and rarity tiers are: renaming one orphans every row
// carrying it.

import type { Rarity } from "./card-rarity";

/**
 * The look of a finished set.
 *
 * Same trick SECRET_RARITY plays, and for the same reason: RevealAmbience, the
 * confetti and the card chrome all speak Rarity, and a set is not a tier. Gold
 * rather than the secret green — a set is not a card, and `warn` amber is
 * already what the award pills on the player pages mean by "somebody won
 * something".
 */
export const TROPHY_RARITY: Rarity = {
  tier: "base",
  label: "Set complete",
  holoA: "oklch(0.92 0.17 95)",
  holoB: "oklch(0.85 0.2 60)",
  strength: 1,
  sparkle: 1,
  border: "oklch(0.82 0.19 85)",
  accent: "oklch(0.82 0.19 85)",
  pattern: "rosette",
  idle: true,
  prismEdge: true,
  // Outside the ladder, exactly like SECRET_RARITY: a trophy is never sorted
  // against the roster and a rank inside 0..5 would collide with a real tier.
  rank: -1,
};

/** Chime id in card-sfx.ts. Not a tier — see the note on TROPHY_RARITY. */
export const TROPHY_CHIME = "collectionComplete";

/** How a set got finished. Mirrors the CHECK in 20260825120000. */
export const TROPHY_VIA = ["pull", "trade", "grant", "claim"] as const;
export type TrophyVia = (typeof TROPHY_VIA)[number];

/**
 * A set finished by THIS action, as it comes back on the acquiring response.
 *
 * Null on every response that acquired nothing new, which is what lets the
 * ceremony fire on presence alone rather than on a diff against what was already
 * on screen.
 */
export type CompletedCollection = {
  collection: string;
  /**
   * The set's name, resolved in SQL alongside the size.
   *
   * Carried rather than looked up because the acquiring response is the only
   * announcement a completion gets — the pack screen does not load the set list,
   * and a grant never reaches the recipient at all — so everything the ceremony
   * needs travels together or not at all.
   */
  label: string;
  size: number;
  completedOn: string;
};

/** The same thing carried on a trade, which can finish a set for either party. */
export type CompletedCollectionFor = CompletedCollection & { participantId: string };

/** One trophy on somebody's shelf, as the public table hands it over. */
export type CollectionTrophy = {
  participantId: string;
  collection: string;
  /** Resolved server-side, so a hidden or deleted set still renders as something. */
  label: string;
  size: number;
  completedOn: string;
  via: string;
};

/**
 * "Complete · 9 cards", the line the shelf and the card back both print.
 *
 * One place rather than two, because these are the only two surfaces in the app
 * allowed to print a set size and they must not drift into saying it differently.
 */
export function trophySizeLabel(size: number): string {
  return `${size} card${size === 1 ? "" : "s"}`;
}

/** Trophies belonging to one person, newest first — the order a shelf reads in. */
export function trophiesFor(
  trophies: readonly CollectionTrophy[],
  participantId: string | null | undefined,
): CollectionTrophy[] {
  if (!participantId) return [];
  return trophies
    .filter((t) => t.participantId === participantId)
    .sort((a, b) => b.completedOn.localeCompare(a.completedOn) || a.label.localeCompare(b.label));
}

/**
 * The set ids this person has finished.
 *
 * A Set rather than a list because every caller is asking "is this one done" —
 * the card back, the shelf heading, the badge on a tile.
 */
export function completedIds(
  trophies: readonly CollectionTrophy[],
  participantId: string | null | undefined,
): Set<string> {
  return new Set(trophiesFor(trophies, participantId).map((t) => t.collection));
}
