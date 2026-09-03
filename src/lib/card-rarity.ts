// Foil tier for a player's trading card, derived from real combine results.
//
// Nothing here is random: the champion has a visibly different card from everyone
// else because they actually won. Before any official run exists every card is
// "base", and because useEventBundle re-fetches on Supabase realtime changes, cards
// upgrade themselves mid-event the moment someone takes the lead.

import { OUT_OF_CONTENTION_STATUSES, outOfContention, standings } from "./standings";

export type RarityTier = "champion" | "podium" | "stationKing" | "penaltyBox" | "dnf" | "base";

/**
 * Which foil texture a tier wears. The colours alone were never enough to tell
 * two tiers apart at a glance — a champion and a base card both swept one
 * rainbow band, just in different hues. Each pattern is a `.holo-pattern-*` rule
 * in styles.css that overrides the band geometry.
 */
export type FoilPattern = "refractor" | "prismatic" | "scanline" | "hazard" | "matte" | "rosette";

/**
 * How the prism edge moves. Its own vocabulary rather than a pattern for the
 * same reason `prismEdge` is a flag: the ring is opaque chrome, not a foil.
 * Each animated id is a plain `.holo-prism-edge.is-*` rule in styles.css.
 */
export type BorderFx = "spin" | "pulse" | "shimmer" | "steady";

/**
 * A map rather than `is-${fx}` so every class name exists verbatim in source —
 * grep finds them, and a BorderFx id that gains no CSS shows up here as a
 * hole instead of silently rendering an unstyled class.
 *
 * Here beside the type rather than in holo-card.tsx because the admin picker
 * renders the same ring to preview it, and the admin bundle has no other reason
 * to pull in the whole card.
 */
export const BORDER_FX_CLASS: Record<BorderFx, string | undefined> = {
  spin: "is-spinning",
  pulse: "is-pulsing",
  shimmer: "is-shimmering",
  steady: undefined,
};

export type Rarity = {
  tier: RarityTier;
  label: string;
  /** Foil gradient endpoints, fed straight into CSS custom properties. */
  holoA: string;
  holoB: string;
  /**
   * How hard the foil catches light, 0..1. Scales both the resting sheen and the
   * bloom on tilt, so the tier is readable at a glance without reading the badge.
   */
  strength: number;
  /** 0 = no sparkle layer, 1 = maximum glint density. */
  sparkle: number;
  /** Border colour for the card bezel and grid tiles. */
  border: string;
  /**
   * Opaque tier colour for page chrome — stat tiles, buttons, ambient glow.
   *
   * Deliberately not `border`: two tiers use a translucent white there (`base`
   * at 24%, `dnf` at 8%) precisely so their bezel stays quiet against the card,
   * and text or a glow in that colour would be invisible.
   */
  accent: string;
  /** Foil texture. See FoilPattern. */
  pattern: FoilPattern;
  /**
   * Whether the card keeps a slow sheen crawling across it at rest. Only the
   * tiers worth showing off get it, and only on a hero-sized card — see the
   * gating in holo-card.tsx.
   */
  idle: boolean;
  /**
   * Rainbow bezel around the card. Secret cards only, and the reason it is a flag
   * rather than another `pattern` is that it is not a foil at all: every other
   * layer is a blend mode filmed over the artwork, which ambient light destroys,
   * and this one is opaque chrome that survives being looked at outdoors.
   */
  prismEdge?: boolean;
  /**
   * How the prism edge animates. Only meaningful alongside `prismEdge`;
   * undefined means "spin", so the six earned tiers never carry it and every
   * existing Rarity literal keeps its behaviour.
   */
  borderFx?: BorderFx;
  /**
   * Whether a tile of this card blooms in its own colour.
   *
   * One scale of glow across the app (§8): only the top of each ladder gets one
   * — champion and podium here, gold and platinum in card-edition.ts, legendary
   * and mythic in secret-cards.ts. Every owned tile used to glow in its tier
   * colour, which made a shelf of base cards look exactly as special as a
   * champion. A hero-sized card is exempt; see the gate in holo-card.tsx.
   */
  glow?: boolean;
  /** Ranked best-to-worst, for sorting the vault. */
  rank: number;
};

const RARITY: Record<RarityTier, Omit<Rarity, "tier">> = {
  champion: {
    label: "1 of 1",
    holoA: "oklch(0.92 0.19 95)",
    // Gold into magenta rather than gold into red-orange. Under color-dodge a
    // warm second stop compounds with the crimson the card art is already full
    // of and floods it; swinging to magenta keeps the prismatic gold read while
    // leaving the blues in the artwork alone.
    holoB: "oklch(0.8 0.16 330)",
    strength: 1,
    sparkle: 1,
    border: "oklch(0.88 0.17 90)",
    accent: "oklch(0.88 0.17 90)",
    pattern: "prismatic",
    idle: true,
    glow: true,
    rank: 0,
  },
  podium: {
    label: "Gold",
    holoA: "oklch(0.9 0.15 95)",
    holoB: "oklch(0.82 0.14 210)",
    strength: 0.92,
    sparkle: 0.7,
    border: "oklch(0.85 0.14 95)",
    accent: "oklch(0.85 0.14 95)",
    pattern: "refractor",
    idle: true,
    glow: true,
    rank: 1,
  },
  stationKing: {
    label: "Station King",
    holoA: "oklch(0.85 0.16 300)",
    holoB: "oklch(0.82 0.14 210)",
    strength: 0.86,
    sparkle: 0.6,
    border: "oklch(0.8 0.16 300)",
    accent: "oklch(0.8 0.16 300)",
    pattern: "scanline",
    idle: false,
    rank: 2,
  },
  base: {
    label: "Base",
    // Rotated 20° off --primary (210) toward teal-green, keeping the same
    // lightness and chroma ladder and the same 15° gap between the two stops.
    // The hue is the whole point: these were byte-identical to --primary and
    // --accent, so a base card and a button were the same object on screen and
    // the app looked like a card that had not loaded.
    holoA: "oklch(0.82 0.14 190)",
    holoB: "oklch(0.75 0.13 175)",
    strength: 0.8,
    sparkle: 0.35,
    // 24%, not 12%: at 12% the bezel disappeared and a base card had no edge at
    // all, which is a different thing from a modest one.
    border: "oklch(1 0 0 / 24%)",
    accent: "oklch(0.82 0.14 190)",
    pattern: "refractor",
    idle: false,
    rank: 3,
  },
  penaltyBox: {
    label: "Penalty Box",
    holoA: "oklch(0.82 0.19 85)",
    holoB: "oklch(0.65 0.24 25)",
    strength: 0.66,
    sparkle: 0.22,
    border: "oklch(0.82 0.19 85)",
    accent: "oklch(0.82 0.19 85)",
    pattern: "hazard",
    idle: false,
    rank: 4,
  },
  dnf: {
    label: "DNF",
    holoA: "oklch(0.6 0.02 240)",
    holoB: "oklch(0.45 0.02 240)",
    strength: 0.22,
    sparkle: 0,
    border: "oklch(1 0 0 / 8%)",
    // Desaturated slate. The tier is supposed to look like the lights went out.
    accent: "oklch(0.62 0.02 240)",
    pattern: "matte",
    idle: false,
    rank: 5,
  },
};

/**
 * What a player did to land on a tier.
 *
 * The label alone never carried it — "Station King" only reads as a flex if you
 * already know it means the fastest split at a station. Shown under the tier
 * badge on the player page and on the generated card back.
 */
export const TIER_REASON: Record<RarityTier, string> = {
  champion: "Fastest official time",
  podium: "Top three finish",
  stationKing: "Fastest at a station",
  penaltyBox: "Most penalty time",
  dnf: "Did not finish",
  base: "Combine athlete",
};

export function rarityStyle(tier: RarityTier): Rarity {
  return { tier, ...RARITY[tier] };
}

/**
 * Rarest first. The index into this IS the rank, same shape as
 * SECRET_TIER_ORDER — it exists so pickers can sort by tier without each of
 * them inventing its own ordering.
 */
export const RARITY_ORDER: readonly RarityTier[] = [
  "champion",
  "podium",
  "stationKing",
  "penaltyBox",
  "dnf",
  "base",
];

/** 0 is champion. An unknown tier sorts last. */
export function rarityRank(tier: string | null | undefined): number {
  const i = RARITY_ORDER.indexOf(tier as RarityTier);
  return i === -1 ? RARITY_ORDER.length : i;
}

// The subset of the event bundle this module needs. Kept structural so it accepts
// the live bundle from useEventBundle and an archived snapshot alike.
type RarityBundle = {
  participants: {
    id: string;
    participant_id: string;
    participation_status: string;
    card_rarity?: string | null;
  }[];
  runs: {
    participant_id: string;
    official_time_ms: number | null;
    is_official: boolean;
    status: string;
    id: string;
  }[];
  splits: { run_id: string; station_id: string; segment_time_ms: number | null }[];
  penalties: { run_id: string; penalty_ms: number }[];
};

// The dnf-family roster statuses live in standings.ts, so the board and the
// tiers cannot drift apart about who is in contention. Re-exported under the
// old name because this module reads it for its own dnf tier as well.
const DNF_STATUSES = OUT_OF_CONTENTION_STATUSES;

function isTier(v: string): v is RarityTier {
  return v in RARITY;
}

/**
 * Assign a tier to every event participant in one pass.
 * Returns a map keyed by event_participant id.
 */
export function rarityMap(bundle: RarityBundle | null | undefined): Map<string, Rarity> {
  const out = new Map<string, Rarity>();
  if (!bundle) return out;

  // Anyone already bound for the dnf tier — a scratched/dq/dnp/absent roster
  // status, or any disqualified run — is out of contention for every earned
  // slot, not just their own tier. Without this a dq'd athlete who posted the
  // fastest clock still held place 1: their own tier said dnf, but the champion
  // slot stayed consumed and the honest winner shipped as podium. Same story
  // for a station crown or the penalty box.
  const dqParticipants = new Set(
    bundle.runs.filter((r) => r.status === "dq").map((r) => r.participant_id),
  );
  const excluded = outOfContention(bundle);

  // Best official run per athlete, placed by counting everyone strictly faster,
  // so a dead heat shares the place. Shared with the leaderboard, which used to
  // do all of this a second, looser way and contradict the card beside it.
  const placeByParticipant = new Map(
    standings(bundle).map((s) => [s.participantId, s.place] as const),
  );

  // Participants owning the fastest segment at any single station.
  const runOwner = new Map(bundle.runs.map((r) => [r.id, r.participant_id]));
  const bestPerStation = new Map<string, { ms: number; participantId: string }>();
  for (const s of bundle.splits) {
    if (s.segment_time_ms == null) continue;
    const participantId = runOwner.get(s.run_id);
    if (!participantId || excluded.has(participantId)) continue;
    const prev = bestPerStation.get(s.station_id);
    if (!prev || s.segment_time_ms < prev.ms) {
      bestPerStation.set(s.station_id, { ms: s.segment_time_ms, participantId });
    }
  }
  const stationKings = new Set([...bestPerStation.values()].map((v) => v.participantId));

  // Most penalty time taken across the event — the deliberately ugly tier.
  const penaltyByParticipant = new Map<string, number>();
  for (const p of bundle.penalties) {
    const participantId = runOwner.get(p.run_id);
    if (!participantId || excluded.has(participantId)) continue;
    penaltyByParticipant.set(
      participantId,
      (penaltyByParticipant.get(participantId) ?? 0) + p.penalty_ms,
    );
  }
  let worstPenaltyParticipant: string | null = null;
  let worstPenaltyMs = 0;
  for (const [participantId, ms] of penaltyByParticipant) {
    if (ms > worstPenaltyMs) {
      worstPenaltyMs = ms;
      worstPenaltyParticipant = participantId;
    }
  }

  for (const ep of bundle.participants) {
    // An explicit admin override always wins.
    const override = ep.card_rarity;
    if (override && isTier(override)) {
      out.set(ep.id, rarityStyle(override));
      continue;
    }

    const pid = ep.participant_id;
    let tier: RarityTier = "base";
    if (DNF_STATUSES.has(ep.participation_status) || dqParticipants.has(pid)) {
      tier = "dnf";
    } else {
      const place = placeByParticipant.get(pid);
      if (place === 1) tier = "champion";
      else if (place === 2 || place === 3) tier = "podium";
      else if (stationKings.has(pid)) tier = "stationKing";
      else if (worstPenaltyParticipant === pid && worstPenaltyMs > 0) tier = "penaltyBox";
    }
    out.set(ep.id, rarityStyle(tier));
  }

  return out;
}
