// Foil tier for a player's trading card, derived from real combine results.
//
// Nothing here is random: the champion has a visibly different card from everyone
// else because they actually won. Before any official run exists every card is
// "base", and because useEventBundle re-fetches on Supabase realtime changes, cards
// upgrade themselves mid-event the moment someone takes the lead.

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
   * at 12%, `dnf` at 8%) precisely so their bezel disappears into the card, and
   * text or a glow in that colour would be invisible.
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
    holoA: "oklch(0.82 0.14 210)",
    holoB: "oklch(0.75 0.13 195)",
    strength: 0.8,
    sparkle: 0.35,
    border: "oklch(1 0 0 / 12%)",
    // The house cyan — a base card is the app's default look, not a downgrade.
    accent: "oklch(0.82 0.14 210)",
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

// The live app only ever writes queued | running | finished | scratched
// (admin.tsx, admin-write.functions.ts). The extra values are the wider
// vocabulary the schema allows and archived snapshots may still contain.
const DNF_STATUSES = new Set(["scratched", "dq", "dnp", "absent"]);

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

  const officialRuns = bundle.runs.filter((r) => r.is_official && r.official_time_ms != null);

  // Best official run per participant, then ordered fastest first.
  const bestByParticipant = new Map<string, (typeof officialRuns)[number]>();
  for (const run of officialRuns) {
    const prev = bestByParticipant.get(run.participant_id);
    if (!prev || (run.official_time_ms ?? 0) < (prev.official_time_ms ?? 0)) {
      bestByParticipant.set(run.participant_id, run);
    }
  }
  const ranked = [...bestByParticipant.values()].sort(
    (a, b) => (a.official_time_ms ?? 0) - (b.official_time_ms ?? 0),
  );
  const placeByParticipant = new Map(ranked.map((r, i) => [r.participant_id, i + 1]));

  // Participants owning the fastest segment at any single station.
  const runOwner = new Map(bundle.runs.map((r) => [r.id, r.participant_id]));
  const bestPerStation = new Map<string, { ms: number; participantId: string }>();
  for (const s of bundle.splits) {
    if (s.segment_time_ms == null) continue;
    const participantId = runOwner.get(s.run_id);
    if (!participantId) continue;
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
    if (!participantId) continue;
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

  const dqParticipants = new Set(
    bundle.runs.filter((r) => r.status === "dq").map((r) => r.participant_id),
  );

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
