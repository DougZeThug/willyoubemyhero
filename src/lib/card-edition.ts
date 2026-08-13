// The finish on a copy of a card, rolled when you pull it.
//
// The second axis, and the deliberate opposite of card-rarity.ts: a TIER is
// earned on the course and is the same on every phone in the garden, while an
// EDITION is luck and belongs to one person's copy. Two people can hold the same
// champion and one of them holds a better print of it.
//
// That distinction is the whole justification for putting randomness in an app
// whose rarity module opens "Nothing here is random", so the code keeps it
// structural rather than trusting anyone to remember it:
//
//   - the edition is stored in `card_pulls`, a row about a person's copy, and
//     never in `event_participants`, a row about a player;
//   - the tier keeps the outer bezel, the foil texture, the ribbon, the reason
//     line and the chime. The edition gets an inner frame and its own chip, and
//     the two labels are never merged;
//   - the vault sorts on tier first and only tie-breaks on edition, so a
//     platinum DNF can never outrank a base champion.
//
// A secret card never carries an edition, the reciprocal of the rule in
// secret-cards.ts that no earned tier carries the prism edge.

import { seededRng } from "./format";

/**
 * The low rung is `standard`, NOT `base`.
 *
 * `base` is already a RarityTier, and the two axes meet constantly in stringly
 * typed places the compiler cannot police — `CollectedCard.tier` is a `string`,
 * `mergeCollection` writes the literal `"base"`, and `playReveal` takes a
 * `string` and would answer an edition with the base chime instead of throwing.
 * Same reasoning that keeps FoilPattern and BorderFx separate vocabularies.
 */
export type Edition = "standard" | "bronze" | "silver" | "gold" | "platinum";

/**
 * Rarest first. This ordering is the algorithm twice over: `rollEdition` walks it
 * to turn a draw into a finish, and the index into it IS the rank. It exists in
 * one other place — the array inside `card_edition_rank()` in the migration —
 * because SQL has to apply the same "best wins" rule on conflict, and a test
 * pins the two against each other.
 */
export const EDITION_ORDER = ["platinum", "gold", "silver", "bronze", "standard"] as const;

/** For `z.enum` on the wire, where a readonly tuple of the union is what zod wants. */
export const EDITION_IDS = EDITION_ORDER;

/**
 * Pull rates, in ten-thousandths.
 *
 * Basis points rather than percent because gold is 3.5%, which is not an integer
 * percent — and a float table cannot be asserted to sum exactly, which is the one
 * property that makes the cumulative walk below provably total.
 */
const WEIGHT_BP: Record<Edition, number> = {
  platinum: 50, // 0.5%
  gold: 350, // 3.5%
  silver: 800, // 8%
  bronze: 1800, // 18%
  standard: 7000, // 70%
};

const BP_TOTAL = 10_000;

export type EditionStyle = {
  edition: Edition;
  /**
   * Never bare "Gold": `podium.label` is already "Gold", and a gold-finish podium
   * card would otherwise read "Gold · Gold". "Parallel" is the hobby's own word
   * for exactly this — same card, different print — and reads correctly beside
   * any tier label.
   */
  label: string;
  /** Metal gradient endpoints, fed straight into CSS custom properties. */
  metalA: string;
  metalB: string;
  /**
   * The near-white middle stop. No tier gradient has one, and that is what makes
   * a gold frame read as polished metal rather than as a warmer podium — the two
   * hues are genuinely close (0.84/0.14/82 against podium's 0.85/0.14/95).
   */
  specular: string;
  /** Opaque colour for chips, glow and confetti. Never `metalB`, which goes dark. */
  accent: string;
  /**
   * How much the finish lifts the room and the card's outer bloom, 0..1.
   *
   * Its own scale rather than a function of rank, for the same reason
   * reveal-ambience.ts keeps GLOW separate from `rank`: the gap between bronze
   * and silver should be barely felt and the gap between gold and platinum
   * should stop the garden.
   */
  lift: number;
};

const EDITIONS: Record<Edition, Omit<EditionStyle, "edition">> = {
  // Renders no frame at all, so the three metal stops here are never read. They
  // are present because a partial style object would push a null check into every
  // render site to save nothing.
  standard: {
    label: "Standard",
    metalA: "oklch(0.82 0.14 210)",
    metalB: "oklch(0.75 0.13 195)",
    specular: "oklch(0.98 0.01 210)",
    // The house cyan, matching `base`'s accent: a standard finish is the app's
    // default look, not a downgrade.
    accent: "oklch(0.82 0.14 210)",
    lift: 0,
  },
  bronze: {
    metalA: "oklch(0.7 0.1 55)",
    metalB: "oklch(0.48 0.07 42)",
    specular: "oklch(0.88 0.07 62)",
    label: "Bronze Parallel",
    accent: "oklch(0.72 0.1 55)",
    // Darker and far less chromatic than penaltyBox's amber, which is the only
    // thing keeping the two apart at a glance.
    lift: 0.05,
  },
  silver: {
    label: "Silver Parallel",
    metalA: "oklch(0.88 0.012 250)",
    metalB: "oklch(0.64 0.015 255)",
    specular: "oklch(0.98 0.004 250)",
    accent: "oklch(0.86 0.012 250)",
    lift: 0.12,
  },
  gold: {
    label: "Gold Parallel",
    metalA: "oklch(0.84 0.14 82)",
    metalB: "oklch(0.62 0.11 68)",
    specular: "oklch(0.99 0.05 92)",
    accent: "oklch(0.84 0.14 82)",
    lift: 0.26,
  },
  platinum: {
    label: "Platinum Parallel",
    metalA: "oklch(0.94 0.02 205)",
    // A cool violet foot rather than another neutral. Rendered side by side,
    // the first attempt at platinum read as a slightly brighter silver — which
    // is a bad trade for the rarest thing in the app, and worse in the vault
    // grid, where the sheen is gated off and the frame is most of what is left
    // to tell them apart. Chroma, not lightness, is what separates them.
    metalB: "oklch(0.72 0.11 278)",
    specular: "oklch(0.99 0.01 210)",
    accent: "oklch(0.93 0.03 210)",
    // Large enough that a platinum on the dimmest tier still clears the second
    // core threshold in reveal-ambience. A 0.5% pull has to land in the room.
    lift: 0.5,
  },
};

/**
 * A map rather than `card-edition-${id}` so every class name exists verbatim in
 * source — grep finds them, and an Edition that gains no CSS shows up here as a
 * hole instead of silently rendering an unstyled class. Same contract as
 * BORDER_FX_CLASS.
 */
export const EDITION_CLASS: Record<Edition, string | undefined> = {
  standard: undefined,
  bronze: "card-edition-bronze",
  silver: "card-edition-silver",
  gold: "card-edition-gold",
  platinum: "card-edition-platinum",
};

/**
 * The animated rung. Split out rather than folded into EDITION_CLASS because the
 * card only wears it at hero size — a vault grid of thirty permanently animating
 * compositor layers is the cost holo-card.tsx gates .holo-idle to avoid.
 */
export const EDITION_ANIM_CLASS: Record<Edition, string | undefined> = {
  standard: undefined,
  bronze: undefined,
  silver: undefined,
  gold: undefined,
  platinum: "is-sheening",
};

/**
 * hasOwn, not a truthiness check: an edition arrives from IndexedDB and from
 * Postgres, neither of which constrains the string, so a stored `"__proto__"`
 * would otherwise resolve to an inherited property and dodge the fallback.
 * Same guard secretFoil uses, for the same reason.
 */
export function isEdition(value: unknown): value is Edition {
  return typeof value === "string" && Object.hasOwn(EDITIONS, value);
}

export function editionStyle(edition: Edition): EditionStyle {
  return { edition, ...EDITIONS[edition] };
}

/**
 * Narrow a stored string to the ladder, falling back to standard.
 *
 * Every finish that reaches a render site has come out of IndexedDB or Postgres
 * as a bare `string`, and neither constrains it. Named rather than left to each
 * caller so the fallback is one decision rather than a dozen, and so nobody
 * reaches for `as Edition`.
 */
export function toEdition(value: string | null | undefined): Edition {
  return isEdition(value) ? value : "standard";
}

/**
 * Best-to-worst, 0 is platinum. Mirrors Rarity.rank, and derived from
 * EDITION_ORDER rather than stored beside the palette so the ladder cannot be
 * ordered one way for sorting and another way for the roll.
 *
 * An unrecognised value sorts last, which is what lets `bestEdition` upgrade a
 * corrupt stored string rather than preserving it forever.
 */
export function editionRank(edition: string | null | undefined): number {
  const i = isEdition(edition) ? EDITION_ORDER.indexOf(edition) : -1;
  return i === -1 ? EDITION_ORDER.length : i;
}

/**
 * The seed one card's finish is rolled from.
 *
 * Composed onto the pack seed rather than replacing it, so a finish is decided by
 * the same three facts the pack is — who you are, which day, which event — and a
 * refresh can no more reroll it than it can redeal the pack.
 *
 * Keyed on the CARD, not the slot. dealPack swaps the last slot for a card the
 * baseline does not hold, so a slot-keyed roll would hand the pity card whatever
 * finish slot three happened to draw, and move it again the moment the baseline
 * did.
 */
export function editionSeed(packSeed: string, eventParticipantId: string): string {
  return `${packSeed}:edition:${eventParticipantId}`;
}

/** Deterministic. The same seed always yields the same finish, on any device. */
export function rollEdition(seed: string): Edition {
  const draw = Math.floor(seededRng(seed)() * BP_TOTAL);
  let ceiling = 0;
  for (const edition of EDITION_ORDER) {
    ceiling += WEIGHT_BP[edition];
    if (draw < ceiling) return edition;
  }
  // Unreachable while the table sums to BP_TOTAL, which a test pins. Falling back
  // to the common rung rather than throwing: a mistuned table should cost a
  // badge, not a pack.
  return "standard";
}

/**
 * Best wins.
 *
 * A worse finish of a card you already hold is a duplicate, not a downgrade, so
 * the value only ever moves up the ladder. The identical rule runs in Postgres in
 * `record_card_pulls`, because the local collection and the server row have to
 * agree about which copy you own.
 */
export function bestEdition(a: string | null | undefined, b: string | null | undefined): Edition {
  const winner = editionRank(a) <= editionRank(b) ? a : b;
  return isEdition(winner) ? winner : "standard";
}

/**
 * Null for a standard finish — 70% of pulls have no badge, and a chip reading
 * "Standard" on seven cards in ten is noise that makes the other three quieter.
 * Same shape as packedByLabel.
 */
export function editionLabel(edition: string | null | undefined): string | null {
  if (!isEdition(edition) || edition === "standard") return null;
  return EDITIONS[edition].label;
}

/**
 * "0.5% pull", for the card back.
 *
 * Derived from the odds table rather than written out, so the copy on the back of
 * a card cannot drift from the rate that actually produced it.
 */
export function editionOddsLabel(edition: string | null | undefined): string | null {
  if (!isEdition(edition) || edition === "standard") return null;
  return `${WEIGHT_BP[edition] / 100}% pull`;
}

/**
 * Whether the finish alone earns the confetti cannon, whatever the tier did.
 *
 * The point of the ladder: a base card can stop the garden if the roll was good
 * enough. Gold and up, so roughly one pack in ten fires on the edition.
 */
export function editionCelebrates(edition: string | null | undefined): boolean {
  return editionRank(edition) <= editionRank("gold");
}

/** Exported for the test that pins the table against the advertised rates. */
export const EDITION_WEIGHTS_BP: Readonly<Record<Edition, number>> = WEIGHT_BP;
export const EDITION_BP_TOTAL = BP_TOTAL;
