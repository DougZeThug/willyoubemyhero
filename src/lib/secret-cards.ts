// Secret cards: the pulled-only side of the collection.
//
// Client-safe. Nothing here reaches the database, and nothing here knows how many
// secret cards exist — the set size is the one number the whole feature withholds.
import type { BorderFx, Rarity } from "./card-rarity";
import { toSecretTier } from "./secret-rarity";

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
  /** Set the card is filed into. Null means unsorted — see SECRET_COLLECTIONS. */
  collection: string | null;
  artUrl: string | null;
  backUrl: string | null;
  /**
   * How good THIS copy is — see secret-rarity.ts. On SecretCardView rather than
   * OwnedSecret because the fourth slot renders the level the moment the card
   * turns, before it is anything you own.
   */
  tier: string;
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
  glacier: {
    ...SECRET_RARITY,
    // Chrome's cool cousin: still quiet, but with a hue to it, so the two are
    // told apart by temperature rather than by chroma alone.
    holoA: "oklch(0.92 0.07 205)",
    holoB: "oklch(0.82 0.12 255)",
    border: "oklch(0.88 0.09 225)",
    accent: "oklch(0.88 0.09 225)",
    pattern: "refractor",
    sparkle: 0.9,
  },
  jade: {
    ...SECRET_RARITY,
    // Green into teal, where the default green goes to magenta. Same family,
    // opposite second act — a card can be green without being *the* green.
    holoA: "oklch(0.89 0.15 170)",
    holoB: "oklch(0.79 0.12 235)",
    border: "oklch(0.85 0.14 180)",
    accent: "oklch(0.85 0.14 180)",
    pattern: "prismatic",
  },
  toxic: {
    ...SECRET_RARITY,
    holoA: "oklch(0.92 0.19 130)",
    holoB: "oklch(0.8 0.14 200)",
    border: "oklch(0.89 0.18 125)",
    accent: "oklch(0.89 0.18 125)",
    // The hazard stripe existed for penaltyBox and nothing else could ask for
    // it; on a secret it reads as a warning label somebody laminated.
    pattern: "hazard",
  },
  bubblegum: {
    ...SECRET_RARITY,
    holoA: "oklch(0.9 0.13 350)",
    holoB: "oklch(0.86 0.1 215)",
    border: "oklch(0.87 0.12 345)",
    accent: "oklch(0.87 0.12 345)",
    sparkle: 0.9,
  },
  nebula: {
    ...SECRET_RARITY,
    // The widest hue sweep in the set — magenta all the way round to cyan — so
    // the rosette bands land as separate colours instead of one blended smear.
    holoA: "oklch(0.88 0.18 320)",
    holoB: "oklch(0.8 0.13 195)",
    border: "oklch(0.84 0.16 315)",
    accent: "oklch(0.84 0.16 315)",
    pattern: "prismatic",
  },
  copper: {
    ...SECRET_RARITY,
    // Warm into violet, never warm into warm — see ember. Deliberately duller
    // and darker than ember at both ends: as swatches they are neighbours on the
    // hue wheel, and at 28px on a phone only the drop in chroma tells them apart.
    holoA: "oklch(0.81 0.1 55)",
    holoB: "oklch(0.66 0.08 290)",
    border: "oklch(0.77 0.09 50)",
    accent: "oklch(0.77 0.09 50)",
    // Matte and low sparkle: aged metal, not fresh foil.
    pattern: "matte",
    sparkle: 0.6,
  },
  midnight: {
    ...SECRET_RARITY,
    holoA: "oklch(0.79 0.14 265)",
    holoB: "oklch(0.62 0.15 300)",
    border: "oklch(0.74 0.15 275)",
    accent: "oklch(0.74 0.15 275)",
    pattern: "scanline",
    sparkle: 0.7,
  },
  onyx: {
    ...SECRET_RARITY,
    // The darkest look in the set, for art that carries itself. Kept off the
    // floor rather than taken to black: the prism edge is drawn from holoA/holoB
    // (see .holo-prism-edge), and that ring is the one tell every secret shares
    // regardless of foil — dimming it would cost more than the look is worth.
    holoA: "oklch(0.75 0.02 265)",
    holoB: "oklch(0.58 0.03 285)",
    border: "oklch(0.68 0.02 270)",
    accent: "oklch(0.68 0.02 270)",
    pattern: "matte",
    sparkle: 0.45,
  },
  crimson: {
    ...SECRET_RARITY,
    // Red into violet: the cool second stop is what keeps a red card from
    // compounding with warm art the way a red→orange pair would.
    holoA: "oklch(0.78 0.19 25)",
    holoB: "oklch(0.66 0.15 305)",
    border: "oklch(0.74 0.18 20)",
    accent: "oklch(0.74 0.18 20)",
    pattern: "scanline",
    sparkle: 0.8,
  },
  sunset: {
    ...SECRET_RARITY,
    holoA: "oklch(0.85 0.15 40)",
    holoB: "oklch(0.7 0.14 265)",
    border: "oklch(0.82 0.15 35)",
    accent: "oklch(0.82 0.15 35)",
    pattern: "refractor",
  },
  citrine: {
    ...SECRET_RARITY,
    // Held a stop under champion's lightness: yellow is the easiest hue to
    // blow out under color-dodge.
    holoA: "oklch(0.9 0.16 100)",
    holoB: "oklch(0.79 0.12 210)",
    border: "oklch(0.87 0.15 95)",
    accent: "oklch(0.87 0.15 95)",
    pattern: "prismatic",
  },
  royalGold: {
    ...SECRET_RARITY,
    // The explicitly rich gold option: bright gold into a cool champagne so the
    // second stop does not compound with warm artwork the way a gold→amber pair
    // would. High sparkle and prismatic bands give it the slow specular luster
    // that reads as metal rather than as yellow paint.
    holoA: "oklch(0.85 0.15 85)",
    holoB: "oklch(0.9 0.07 215)",
    border: "oklch(0.83 0.14 85)",
    accent: "oklch(0.83 0.14 85)",
    pattern: "prismatic",
    sparkle: 0.95,
  },
  sandstorm: {
    ...SECRET_RARITY,
    // Copper's drier neighbour — lower chroma still, matte, so the two read
    // apart at swatch size by texture as well as temperature.
    holoA: "oklch(0.84 0.07 80)",
    holoB: "oklch(0.68 0.06 315)",
    border: "oklch(0.8 0.07 75)",
    accent: "oklch(0.8 0.07 75)",
    pattern: "matte",
    sparkle: 0.55,
  },
  tidal: {
    ...SECRET_RARITY,
    holoA: "oklch(0.87 0.12 190)",
    holoB: "oklch(0.7 0.14 260)",
    border: "oklch(0.83 0.13 195)",
    accent: "oklch(0.83 0.13 195)",
    pattern: "refractor",
  },
  cobalt: {
    ...SECRET_RARITY,
    holoA: "oklch(0.8 0.16 255)",
    holoB: "oklch(0.86 0.12 205)",
    border: "oklch(0.78 0.16 250)",
    accent: "oklch(0.78 0.16 250)",
    pattern: "prismatic",
  },
  amethyst: {
    ...SECRET_RARITY,
    holoA: "oklch(0.82 0.15 300)",
    holoB: "oklch(0.86 0.11 5)",
    border: "oklch(0.8 0.15 295)",
    accent: "oklch(0.8 0.15 295)",
    pattern: "prismatic",
    sparkle: 0.95,
  },
  pearl: {
    ...SECRET_RARITY,
    // Almost no chroma at all, warm into cool. Chrome is neutral-blue metal;
    // this is the softer, whiter one, told apart by temperature at the top stop.
    holoA: "oklch(0.93 0.03 85)",
    holoB: "oklch(0.86 0.04 230)",
    border: "oklch(0.9 0.03 100)",
    accent: "oklch(0.9 0.03 100)",
    pattern: "refractor",
    sparkle: 1,
  },
};

/**
 * Admin-facing labels. One list feeds the panel pickers and the zod enums.
 *
 * Ordered warm → cool → dark rather than alphabetically, because the picker
 * renders it as a strip of swatches and a strip that walks the hue wheel is
 * scannable in a way a strip sorted by name is not.
 */
export const SECRET_FOIL_OPTIONS = [
  { id: "rosette", label: "Spectral Green" },
  { id: "jade", label: "Jade" },
  { id: "toxic", label: "Toxic" },
  { id: "citrine", label: "Citrine" },
  { id: "royalGold", label: "Royal Gold" },
  { id: "ember", label: "Ember" },
  { id: "sunset", label: "Sunset" },
  { id: "crimson", label: "Crimson" },
  { id: "copper", label: "Copper" },
  { id: "sandstorm", label: "Sandstorm" },
  { id: "bubblegum", label: "Bubblegum" },
  { id: "amethyst", label: "Amethyst" },
  { id: "ultraviolet", label: "Ultraviolet" },
  { id: "nebula", label: "Nebula" },
  { id: "aurora", label: "Aurora" },
  { id: "tidal", label: "Tidal" },
  { id: "cobalt", label: "Cobalt" },
  { id: "glacier", label: "Glacier" },
  { id: "pearl", label: "Pearl" },
  { id: "chrome", label: "Liquid Chrome" },
  { id: "midnight", label: "Midnight" },
  { id: "onyx", label: "Onyx" },
] as const;

export const SECRET_BORDER_FX_OPTIONS = [
  { id: "spin", label: "Prism Spin" },
  { id: "pulse", label: "Heartbeat" },
  { id: "shimmer", label: "Shimmer" },
  { id: "steady", label: "Steady" },
] as const;

/**
 * One set, as the admin authored it.
 *
 * `accent` is a preset id from SET_ACCENTS, not a colour: the palette can be
 * retuned without rewriting rows, and an id retired from the list degrades to
 * "no theme" rather than to broken CSS. Null/undefined means untinted.
 */
export type SecretCollection = { id: string; label: string; accent?: string | null };

/**
 * The colours a set can wear.
 *
 * Ids are stored in `secret_collections.accent`, so they are add-only for the
 * same reason foil ids and award category ids are. The values are oklch to match
 * every other colour in this codebase, and each is picked bright enough to read
 * as a border and a glow against the near-black field.
 */
export const SET_ACCENTS = [
  { id: "cyan", label: "Cyan", oklch: "oklch(0.82 0.14 210)" },
  { id: "azure", label: "Azure", oklch: "oklch(0.78 0.14 235)" },
  { id: "blue", label: "Blue", oklch: "oklch(0.7 0.18 260)" },
  { id: "indigo", label: "Indigo", oklch: "oklch(0.62 0.18 275)" },
  { id: "violet", label: "Violet", oklch: "oklch(0.68 0.2 295)" },
  { id: "purple", label: "Purple", oklch: "oklch(0.6 0.21 310)" },
  { id: "magenta", label: "Magenta", oklch: "oklch(0.72 0.24 330)" },
  { id: "pink", label: "Pink", oklch: "oklch(0.8 0.14 350)" },
  { id: "rose", label: "Rose", oklch: "oklch(0.76 0.16 5)" },
  { id: "crimson", label: "Crimson", oklch: "oklch(0.6 0.2 15)" },
  { id: "red", label: "Red", oklch: "oklch(0.68 0.21 25)" },
  { id: "ember", label: "Ember", oklch: "oklch(0.66 0.17 40)" },
  { id: "orange", label: "Orange", oklch: "oklch(0.76 0.18 55)" },
  { id: "amber", label: "Amber", oklch: "oklch(0.8 0.16 72)" },
  { id: "gold", label: "Gold", oklch: "oklch(0.84 0.17 88)" },
  { id: "lime", label: "Lime", oklch: "oklch(0.85 0.19 125)" },
  { id: "green", label: "Green", oklch: "oklch(0.78 0.19 150)" },
  { id: "mint", label: "Mint", oklch: "oklch(0.86 0.13 165)" },
  { id: "teal", label: "Teal", oklch: "oklch(0.78 0.13 185)" },
  { id: "slate", label: "Slate", oklch: "oklch(0.72 0.03 250)" },
] as const;

export type SetAccentId = (typeof SET_ACCENTS)[number]["id"];

export const SET_ACCENT_IDS = SET_ACCENTS.map((a) => a.id) as readonly string[];

/** The colour for a stored accent id, or null when there is no theme. */
export function setAccentColor(id: string | null | undefined): string | null {
  if (!id) return null;
  return SET_ACCENTS.find((a) => a.id === id)?.oklch ?? null;
}

/** The colour a set wears, looked up by set id. Null for unsorted or untinted. */
export function setAccent(
  id: string | null | undefined,
  sets: readonly SecretCollection[] = SECRET_COLLECTIONS,
): string | null {
  if (!id) return null;
  return setAccentColor(sets.find((c) => c.id === id)?.accent);
}

/**
 * The sets that shipped before sets were data.
 *
 * The live list now lives in `public.secret_collections`, which admins edit from
 * the panel; this array is the seed those four rows were created from, and the
 * fallback for any render that has not loaded the list yet.
 *
 * Ids are stored in `secret_cards.collection`, so they stay add-only for the same
 * reason foil ids and award category ids are: renaming one orphans every row
 * already carrying it. Labels are free to change; ids are not. Null means
 * unsorted, which is what every card written before this existed is.
 */
export const SECRET_COLLECTIONS: readonly SecretCollection[] = [
  { id: "cornhole", label: "Cornhole Collection" },
  { id: "wags", label: "WAGs" },
  { id: "pets", label: "Pets" },
  { id: "legacyPets", label: "Legacy Pets" },
];

export const SECRET_COLLECTION_IDS = SECRET_COLLECTIONS.map((c) => c.id) as readonly string[];

/**
 * A set id an admin can create. Not an enum any more — the vocabulary lives in a
 * table — so the shape is pinned here and existence is checked against the table.
 */
// New ids are slugged to lowercase by `toSecretCollectionId`, but the original
// Legacy Pets row shipped as `legacyPets`. Accept the casing of existing rows
// at the request boundary; existence is still checked against the sets table.
export const SECRET_COLLECTION_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?$/;

/** Turn a typed set name into a stable, storable id. */
export function toSecretCollectionId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/** What an unfiled card is grouped under. Never a set id, so it can't be stored. */
export const UNSORTED_COLLECTION_LABEL = "Unsorted";

/**
 * The same pile, headed on a player's own shelf.
 *
 * "Unsorted" is admin vocabulary — it describes filing work nobody but the
 * commissioner can do, and on the vault it reads as though the owner left their
 * cards in a mess. To the person holding them it is just "Secrets".
 */
export const VAULT_UNSORTED_LABEL = "Secrets";

/**
 * Label for a stored value. An id retired from the list above still has rows
 * pointing at it, so an unknown id renders as itself rather than disappearing.
 */
export function secretCollectionLabel(
  id: string | null | undefined,
  sets: readonly SecretCollection[] = SECRET_COLLECTIONS,
): string {
  if (!id) return UNSORTED_COLLECTION_LABEL;
  return sets.find((c) => c.id === id)?.label ?? id;
}

/**
 * Group cards into the fixed set order, unsorted last, dropping empty groups.
 * Shared by the admin panel and the vault so the two read in the same order.
 */
export function groupBySecretCollection<T extends { collection?: string | null }>(
  items: readonly T[],
  sets: readonly SecretCollection[] = SECRET_COLLECTIONS,
): { id: string | null; label: string; accent: string | null; items: T[] }[] {
  const groups = new Map<string | null, T[]>();
  for (const item of items) {
    // `||`, not `??`: the column is unconstrained text, so a row can hold "" as
    // well as NULL, and both mean the same thing — secretCollectionLabel has
    // always rendered them both as Unsorted. Left as separate keys they became
    // two identically-labelled shelves, and once the vault derived a section id
    // from the group they collided on one id and the second pile's cards
    // vanished off the page.
    const key = item.collection || null;
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  const ordered: { id: string | null; label: string; accent: string | null; items: T[] }[] = [];
  for (const c of sets) {
    const items = groups.get(c.id);
    if (items) {
      ordered.push({ id: c.id, label: c.label, accent: setAccentColor(c.accent), items });
      groups.delete(c.id);
    }
  }
  // Anything stored but not in the list (a retired id), then the unsorted pile.
  const unsorted = groups.get(null);
  groups.delete(null);
  for (const [id, items] of groups)
    ordered.push({ id, label: secretCollectionLabel(id, sets), accent: null, items });
  if (unsorted)
    ordered.push({ id: null, label: UNSORTED_COLLECTION_LABEL, accent: null, items: unsorted });

  return ordered;
}

const BORDER_FX_IDS = new Set<string>(SECRET_BORDER_FX_OPTIONS.map((o) => o.id));

// Memo for foil+borderFx+level combinations, so render sites get referentially
// stable Rarity objects across renders instead of a fresh spread each call.
const FX_VARIANTS = new Map<string, Rarity>();

/**
 * The look of one secret card, optionally coloured by the level of the copy in
 * hand.
 *
 * `tier` is the level that was rolled for a specific pull, so it belongs here
 * and not in the card's stored look: the same card is a common to one person and
 * a mythic to another. Two things ride on it, both from §8's "rarity by rank":
 *
 * - **Legendary and mythic glow.** A shelf where every secret bloomed had no top
 *   to it; now the top two rungs are the only ones that do.
 * - **Mythic forces the ring's shimmer**, over whatever the admin picked for the
 *   card. Hero-only falls out for free — holo-card.tsx only applies
 *   BORDER_FX_CLASS at hero size, so a vault grid never starts shimmering.
 *
 * Callers with no level at all — the admin set editor, previewing a card nobody
 * has pulled — omit it and get the card's own look untouched.
 */
export function secretFoil(
  id: string | null | undefined,
  borderFx?: string | null,
  tier?: string | null,
): Rarity {
  // hasOwn, not a truthiness check on the lookup: the registry is a plain
  // object, so a stored id like "__proto__" or "constructor" would otherwise
  // resolve to an inherited property and dodge the fallback.
  const known = id != null && Object.hasOwn(SECRET_FOILS, id);
  const base = known ? SECRET_FOILS[id] : SECRET_RARITY;
  const level = tier == null ? null : toSecretTier(tier);
  const glow = level === "mythic" || level === "legendary";
  const fx = level === "mythic" ? "shimmer" : borderFx;
  // "spin" is what an absent borderFx already means, so with nothing else to
  // change it takes the base object unchanged — same fallback contract as an
  // unknown id.
  const plainFx = !fx || fx === "spin" || !BORDER_FX_IDS.has(fx);
  if (plainFx && !glow) return base;
  const key = `${known ? id : "rosette"}.${plainFx ? "spin" : fx}.${glow ? "glow" : "flat"}`;
  let variant = FX_VARIANTS.get(key);
  if (!variant) {
    variant = {
      ...base,
      ...(plainFx ? null : { borderFx: fx as BorderFx }),
      ...(glow && { glow }),
    };
    FX_VARIANTS.set(key, variant);
  }
  return variant;
}

/** "3 secrets pulled" / "1 secret pulled". Never rendered at zero — see the vault. */
export function secretsPulledLabel(n: number): string {
  return `${n} secret${n === 1 ? "" : "s"} pulled`;
}

/**
 * Is there a card waiting today?
 *
 * Extracted from the vault's pack button so the nav's Pack tab and that button
 * cannot drift: two places drawing the same cue off two copies of the same
 * expression is how one of them quietly starts glowing on a spent day.
 *
 * Leaks nothing. Every field it reads is already scoped to whoever is asking —
 * `available` is only ever "there is something", never how much — and a stranger
 * with no status at all is simply false.
 */
export function secretWaiting(status: SecretDayStatus | null | undefined): boolean {
  return !!status?.claimed && !status.pulledToday && status.available;
}
