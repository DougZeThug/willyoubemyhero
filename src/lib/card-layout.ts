// Where the live numbers sit on top of a card front.
//
// The art is a flat image with whatever the designer typeset already baked into
// it, and it is not the same composition on every card. So rather than guess a
// position in code, the admin drags a box onto the real artwork once and that
// box is what this module describes: a slot, in coordinates that mean the same
// thing at 320px in the vault grid and at 1080px in a share export.
//
// Everything is normalised 0..1 against the card's own box, and type size is a
// fraction of the card's *width*. That is what makes one layout serve every
// size without measuring anything — measurement is exactly what card-back-panel
// warns off, because a .holo-face is a rotated, backface-hidden node and reports
// zero width to anything that asks.

import { ATTRIBUTE_KEYS, ATTRIBUTE_META, type AttributeKey } from "./card-attributes";
import type { PlayerAttributes } from "./card-attributes";
import type { CardStats } from "./card-stats";
import { formatTime } from "./format";

/** Everything a slot can be bound to: derived ratings, then real combine facts. */
export type StatSlotKey =
  | "ovr"
  | AttributeKey
  | "time"
  | "rank"
  | "bib"
  | "pick"
  | "bestStation"
  | "tier"
  | "name";

export const SLOT_KEYS: readonly StatSlotKey[] = [
  "ovr",
  ...ATTRIBUTE_KEYS,
  "time",
  "rank",
  "bib",
  "pick",
  "bestStation",
  "tier",
  "name",
];

/** Menu copy for the calibration editor. */
export const SLOT_LABELS: Record<StatSlotKey, string> = {
  ovr: "Overall",
  speed: ATTRIBUTE_META.speed.label,
  burst: ATTRIBUTE_META.burst.label,
  consistency: ATTRIBUTE_META.consistency.label,
  clutch: ATTRIBUTE_META.clutch.label,
  discipline: ATTRIBUTE_META.discipline.label,
  time: "Official time",
  rank: "Rank",
  bib: "Bib",
  pick: "Draft pick",
  bestStation: "Station won",
  tier: "Rarity tier",
  name: "Name",
};

export type SlotAlign = "left" | "center" | "right";

export type StatSlot = {
  /** Stable across edits, so React and the editor's drag state agree. */
  id: string;
  key: StatSlotKey;
  /** Top-left corner and size, each 0..1 of the card's own box. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Value type size, as a fraction of card width. */
  size: number;
  align: SlotAlign;
  /** An oklch() string, or "tier" to follow the card's rarity accent. */
  color?: string;
  /**
   * Opaque fill painted behind the slot.
   *
   * This is the piece that makes existing artwork usable: a number typeset into
   * the art can be covered by a plate sampled from the pixels around it, and the
   * live value drawn on top. Null for art with a space already left for it.
   */
  plate?: { color: string; radius?: number } | null;
  /** Small-caps caption above the value. Null for a bare number. */
  label?: string | null;
};

export type CardLayout = {
  version: 1;
  /** Card aspect the slots were placed against, so a mismatch can be flagged. */
  aspect: number;
  slots: StatSlot[];
};

/** Standard trading card, 2.5in x 3.5in — the same default holo-card assumes. */
export const DEFAULT_ASPECT = 5 / 7;

/**
 * What the editor opens with on a card that has no layout yet.
 *
 * A stat strip across the bottom and the overall up in the top-left corner,
 * which is where a card puts its headline number. Every value carries a plate,
 * because the common case is art that already has something printed there.
 */
export function defaultLayout(aspect = DEFAULT_ASPECT): CardLayout {
  const plate = { color: "oklch(0.14 0.02 240)", radius: 0.02 };
  const strip: StatSlot[] = ATTRIBUTE_KEYS.map((key, i) => ({
    id: `slot-${key}`,
    key,
    x: 0.06 + i * 0.177,
    y: 0.84,
    w: 0.16,
    h: 0.1,
    size: 0.075,
    align: "center" as const,
    color: "oklch(0.98 0 0)",
    plate,
    label: ATTRIBUTE_META[key].short,
  }));
  return {
    version: 1,
    aspect,
    slots: [
      {
        id: "slot-ovr",
        key: "ovr",
        x: 0.06,
        y: 0.05,
        w: 0.2,
        h: 0.14,
        size: 0.12,
        align: "center",
        color: "tier",
        plate,
        label: "OVR",
      },
      ...strip,
    ],
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function isSlotKey(v: unknown): v is StatSlotKey {
  return typeof v === "string" && (SLOT_KEYS as readonly string[]).includes(v);
}

function parsePlate(raw: unknown): StatSlot["plate"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  if (typeof src.color !== "string" || !src.color) return null;
  return { color: src.color.slice(0, 64), radius: clamp01(num(src.radius, 0)) };
}

/**
 * Read a layout off jsonb, or off a request body — the same function does both.
 *
 * The column is jsonb and the editor posts JSON, so neither side can be trusted
 * to hold a well-formed layout. Slots that make no sense are dropped rather than
 * failing the whole card, and every coordinate is clamped into range, so the
 * worst a bad payload can do is put a box somewhere silly.
 *
 * Returns null when there is nothing usable, which is the same signal as "no
 * layout saved": the card renders as plain artwork.
 */
export function parseCardLayout(raw: unknown): CardLayout | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  if (!Array.isArray(src.slots)) return null;

  const seen = new Set<string>();
  const slots: StatSlot[] = [];
  for (const entry of src.slots) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const s = entry as Record<string, unknown>;
    if (!isSlotKey(s.key)) continue;

    // Ids have to be unique or React reuses the wrong node mid-drag. A collision
    // is far more likely to be a hand-edited payload than a real duplicate slot.
    const id = typeof s.id === "string" && s.id ? s.id.slice(0, 64) : `slot-${slots.length}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const x = clamp01(num(s.x, 0));
    const y = clamp01(num(s.y, 0));
    slots.push({
      id,
      key: s.key,
      x,
      y,
      // A box may not run off the card, or the value inside it is unreachable
      // in the editor and clipped everywhere else.
      w: Math.min(clamp01(num(s.w, 0.2)), 1 - x),
      h: Math.min(clamp01(num(s.h, 0.1)), 1 - y),
      size: Math.min(0.5, Math.max(0.01, num(s.size, 0.08))),
      align: s.align === "left" || s.align === "right" ? s.align : "center",
      color: typeof s.color === "string" ? s.color.slice(0, 64) : undefined,
      plate: parsePlate(s.plate),
      label: typeof s.label === "string" ? s.label.slice(0, 24) : null,
    });
    if (slots.length >= 32) break;
  }

  if (slots.length === 0) return null;
  // A zero or negative aspect is a missing one, not a very thin card — clamping
  // it to the minimum would render every slot onto a sliver.
  const aspect = num(src.aspect, DEFAULT_ASPECT);
  return {
    version: 1,
    aspect: aspect > 0 ? Math.min(3, Math.max(0.2, aspect)) : DEFAULT_ASPECT,
    slots,
  };
}

/**
 * Read `card_layout` off a row whose generated type predates the column.
 *
 * src/integrations/supabase/types.ts is `supabase gen types` output and lags the
 * migrations — it is still missing `card_rarity`, which card-rarity.ts works
 * around the same way. Keeping the cast here means exactly one place to delete
 * once the types are regenerated.
 */
export function readLayoutColumn(row: unknown): unknown {
  if (!row || typeof row !== "object") return null;
  return (row as Record<string, unknown>).card_layout ?? null;
}

/**
 * The layout every card in the event should use, keyed by event_participant id.
 *
 * A player's own layout wins over the event default, the same resolution order
 * card backs already follow in getEventCardUrls. Built as a map rather than
 * resolved per card because the vault renders thirty at once and re-validating
 * a layout on every one of them, every render, is pure waste.
 */
export function layoutMap(
  participants: { id: string; card_layout?: unknown }[] | null | undefined,
  event: unknown,
): Map<string, CardLayout | null> {
  const out = new Map<string, CardLayout | null>();
  if (!participants) return out;
  const fallback = parseCardLayout(readLayoutColumn(event));
  for (const p of participants) {
    out.set(p.id, parseCardLayout(p.card_layout) ?? fallback);
  }
  return out;
}

/** Everything a slot can read. Assembled once per card by the caller. */
export type SlotContext = {
  attributes: PlayerAttributes | null;
  stats: Pick<CardStats, "bestRun" | "rank" | "fieldSize" | "ladder">;
  name: string;
  bib: number | null;
  pick: number | null;
  rarityLabel: string;
};

const DASH = "—";

/**
 * A context with no combine data in it.
 *
 * For the vault grid, which renders `compact` — only the overall, which comes
 * off the attribute map the page already built. Running cardStats for thirty
 * thumbnails to fill fields none of them draw would cost a full pass over every
 * split, thirty times, for nothing.
 */
export const EMPTY_SLOT_STATS: SlotContext["stats"] = {
  bestRun: null,
  rank: null,
  fieldSize: 0,
  ladder: [],
};

/**
 * The string a slot prints.
 *
 * Always a string, never null: a slot is a hole punched in the artwork, and
 * leaving it empty shows whatever the art had underneath — which on a card with
 * a plate is a blank rectangle, and on one without is the stale baked-in number
 * this whole thing exists to replace.
 */
export function resolveSlot(key: StatSlotKey, ctx: SlotContext): string {
  switch (key) {
    case "ovr":
      return ctx.attributes?.ovr != null ? String(ctx.attributes.ovr) : DASH;
    case "time":
      return ctx.stats.bestRun ? formatTime(ctx.stats.bestRun.official_time_ms) : DASH;
    case "rank":
      return ctx.stats.rank != null ? `#${ctx.stats.rank}` : DASH;
    case "bib":
      return ctx.bib != null ? String(ctx.bib) : DASH;
    case "pick":
      return ctx.pick != null ? `#${ctx.pick}` : DASH;
    case "bestStation":
      return ctx.stats.ladder.find((r) => r.best)?.label ?? DASH;
    case "tier":
      return ctx.rarityLabel;
    case "name":
      return ctx.name;
    default: {
      const rating = ctx.attributes?.ratings[key];
      return rating != null ? String(rating) : DASH;
    }
  }
}
