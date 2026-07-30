// Trading-card ratings, derived from what someone actually did on the course.
//
// card-stats.ts already answers "how fast was this, and how does it compare" in
// milliseconds. That is the truth, and the card back prints it. This module
// answers a different question — "what does this player look like as a card" —
// and the answer has to be a number between 40 and 99, because that is the
// vocabulary a trading card speaks.
//
// Nothing here is stored. Same reasoning card-rarity.ts gives for tiers: every
// rating is field-relative, so one person finishing changes everybody else's
// numbers, and writing them per-run would mean recomputing the whole event on
// every save. Derived keeps it free, keeps archived snapshots self-describing,
// and means cards visibly upgrade mid-event the moment the bundle refetches.

import { bestTimesByParticipant, type StatsBundle } from "./card-stats";
import { DNF_STATUSES } from "./card-rarity";

export type AttributeKey = "speed" | "burst" | "consistency" | "clutch" | "discipline";

export const ATTRIBUTE_KEYS: readonly AttributeKey[] = [
  "speed",
  "burst",
  "consistency",
  "clutch",
  "discipline",
];

/**
 * Display copy for each rating.
 *
 * `short` is what fits in a slot on the card front — three letters, the way a
 * real card abbreviates. `hint` is the one-line explanation, shown where there
 * is room for it, in the same register as TIER_REASON in card-rarity.ts.
 */
export const ATTRIBUTE_META: Record<AttributeKey, { label: string; short: string; hint: string }> =
  {
    speed: { label: "Speed", short: "SPD", hint: "Best official time against the field" },
    burst: { label: "Burst", short: "BST", hint: "Their strongest single station" },
    consistency: {
      label: "Consistency",
      short: "CON",
      hint: "How level they were across stations",
    },
    clutch: { label: "Clutch", short: "CLU", hint: "Last station against their own average" },
    discipline: { label: "Discipline", short: "DIS", hint: "Penalty time taken, inverted" },
  };

export type PlayerAttributes = {
  /** Null until they have an official run. Render as an em dash, never as 0. */
  ovr: number | null;
  ratings: Record<AttributeKey, number | null>;
  /**
   * False while anyone still has a run to post.
   *
   * Every rating here is field-relative, which means yours can fall while you
   * stand at the bar, because somebody else just went faster. That is not a bug
   * and it is not worth faking a ratchet to hide — but it does need saying, so
   * the UI marks unsettled numbers as provisional.
   */
  settled: boolean;
};

/**
 * The slice of the event bundle these ratings need. Structural, so it takes the
 * live bundle from useEventBundle and an archived snapshot alike.
 *
 * Spelled out rather than intersected with StatsBundle: `runs` needs `status`
 * here, and `A[] & B[]` resolves a `.filter` callback to A alone, which quietly
 * hides the extra field from every array method.
 */
export type AttrBundle = {
  stations: StatsBundle["stations"];
  splits: StatsBundle["splits"];
  participants: {
    id: string;
    participant_id: string;
    participation_status: string;
    /** Admin override, jsonb. Shallow-merged over the derived values. */
    card_attributes?: unknown;
  }[];
  runs: {
    id: string;
    participant_id: string;
    official_time_ms: number | null;
    is_official: boolean;
    status: string;
  }[];
  penalties: { run_id: string; penalty_ms: number }[];
};

/**
 * The bottom of the scale.
 *
 * Not 0, and not 1. Everyone in this field showed up on a Saturday and ran an
 * obstacle course in a garden; a card that says 12 is a card nobody wants to be
 * handed. 40 is the same floor the sports games use, and for the same reason.
 */
export const RATING_FLOOR = 40;
export const RATING_CEIL = 99;

/**
 * How much each rating counts toward the overall.
 *
 * Speed carries most of it because the combine is a timed course and everyone
 * standing in the garden already knows who won. The other four exist to make two
 * players with adjacent times look like different cards.
 */
const OVR_WEIGHTS: Record<AttributeKey, number> = {
  speed: 0.4,
  burst: 0.15,
  consistency: 0.15,
  clutch: 0.15,
  discipline: 0.15,
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function toRating(p: number): number {
  return Math.round(RATING_FLOOR + (RATING_CEIL - RATING_FLOOR) * clamp01(p));
}

/**
 * What fraction of the field this value beats, 1 = best, 0 = worst.
 *
 * Rank percentile rather than a z-score or a min-max stretch. With thirteen
 * people a z-score is mostly noise, and min-max hands the whole scale to one
 * outlier — a single sandbagged run would flatten everybody else's Speed to the
 * floor. Rank is robust to that and it is also the thing people already say out
 * loud: you beat nine of twelve.
 *
 * Ties share a place, matching the competition rank cardStats already uses.
 */
function percentile(value: number, field: number[], lowerIsBetter: boolean): number {
  if (field.length <= 1) return 1;
  const better = field.filter((v) => (lowerIsBetter ? v < value : v > value)).length;
  return (field.length - 1 - better) / (field.length - 1);
}

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

const NO_RATINGS: Record<AttributeKey, number | null> = {
  speed: null,
  burst: null,
  consistency: null,
  clutch: null,
  discipline: null,
};

export type AttributeOverride = Partial<Record<"ovr" | AttributeKey, number>>;

/**
 * Read an admin override off the jsonb column.
 *
 * The column is jsonb, so it can hold literally anything — this is the boundary
 * where that stops being true. Anything that is not a finite number in range is
 * dropped rather than rejected, so one bad key can't blank a whole card.
 *
 * Exported because the server function that writes the column runs the same
 * parse before storing: whatever lands in the database has already been through
 * the reader, so a value that survives a write is a value the card can draw.
 */
export function parseAttributeOverride(raw: unknown): AttributeOverride {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const out: AttributeOverride = {};
  for (const key of ["ovr", ...ATTRIBUTE_KEYS] as const) {
    const v = src[key];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    out[key] = Math.min(RATING_CEIL, Math.max(0, Math.round(v)));
  }
  return out;
}

/**
 * Rate every event participant in one pass.
 * Returns a map keyed by event_participant id, the same as rarityMap.
 */
export function attributeMap(bundle: AttrBundle | null | undefined): Map<string, PlayerAttributes> {
  const out = new Map<string, PlayerAttributes>();
  if (!bundle) return out;

  const bestTimes = bestTimesByParticipant(bundle);
  const allTimes = [...bestTimes.values()];

  const runOwner = new Map(bundle.runs.map((r) => [r.id, r.participant_id]));
  const dqParticipants = new Set(
    bundle.runs.filter((r) => r.status === "dq").map((r) => r.participant_id),
  );

  // Fastest segment per participant per station, in course order. One entry per
  // participant so a second, slower run can never drag their own station time
  // down — the same guard cardStats puts on the field median.
  const stations = [...bundle.stations].sort((a, b) => a.station_order - b.station_order);
  const byStation = stations.map((st) => {
    const perParticipant = new Map<string, number>();
    for (const s of bundle.splits) {
      if (s.station_id !== st.id || s.segment_time_ms == null) continue;
      const owner = runOwner.get(s.run_id);
      if (!owner) continue;
      const cur = perParticipant.get(owner);
      if (cur == null || s.segment_time_ms < cur) perParticipant.set(owner, s.segment_time_ms);
    }
    return { id: st.id, perParticipant, field: [...perParticipant.values()] };
  });

  // Penalty time per participant. Everyone on the roster counts, including the
  // clean ones — otherwise Discipline would be scored against only the people
  // who took a penalty, and a spotless run would rank last in a field of one.
  const penaltyByParticipant = new Map<string, number>();
  for (const ep of bundle.participants) penaltyByParticipant.set(ep.participant_id, 0);
  for (const p of bundle.penalties) {
    const owner = runOwner.get(p.run_id);
    if (owner == null || !penaltyByParticipant.has(owner)) continue;
    penaltyByParticipant.set(owner, (penaltyByParticipant.get(owner) ?? 0) + p.penalty_ms);
  }
  const penaltyField = [...penaltyByParticipant.values()];

  // Provisional until everyone who is going to run has run. Someone scratched is
  // never going to post a time, so waiting on them would leave every card marked
  // provisional for the rest of the event.
  const settled = bundle.participants.every(
    (ep) =>
      DNF_STATUSES.has(ep.participation_status) ||
      dqParticipants.has(ep.participant_id) ||
      bestTimes.has(ep.participant_id),
  );

  for (const ep of bundle.participants) {
    const pid = ep.participant_id;
    const override = parseAttributeOverride(ep.card_attributes);

    const isDnf = DNF_STATUSES.has(ep.participation_status) || dqParticipants.has(pid);
    const myTime = bestTimes.get(pid) ?? null;

    if (isDnf || myTime == null) {
      out.set(ep.id, applyOverride({ ovr: null, ratings: { ...NO_RATINGS }, settled }, override));
      continue;
    }

    const ratings: Record<AttributeKey, number | null> = { ...NO_RATINGS };

    ratings.speed = toRating(percentile(myTime, allTimes, true));
    ratings.discipline = toRating(
      percentile(penaltyByParticipant.get(pid) ?? 0, penaltyField, true),
    );

    // Their percentile at each station they have a time for, in course order.
    const mine = byStation
      .map((st) => {
        const ms = st.perParticipant.get(pid);
        return ms == null ? null : percentile(ms, st.field, true);
      })
      .filter((p): p is number => p != null);

    if (mine.length > 0) ratings.burst = toRating(Math.max(...mine));

    // Consistency and clutch are both statements about spread, and a single
    // sample has none. Better a dash than a number invented from one station.
    if (mine.length >= 2) {
      // Deliberately spread alone, not spread weighted by quality: someone who
      // was mid-table at every station really is consistent, and a card that
      // called them erratic for it would be wrong.
      ratings.consistency = toRating(1 - (Math.max(...mine) - Math.min(...mine)));

      // Finishing above your own average is the whole idea. Halved and centred,
      // so an even performance lands mid-scale rather than at the floor.
      const last = mine[mine.length - 1];
      ratings.clutch = toRating((last - mean(mine) + 1) / 2);
    }

    out.set(ep.id, applyOverride({ ovr: composeOvr(ratings), ratings, settled }, override));
  }

  return out;
}

/** Weighted mean over whichever ratings resolved, renormalised so a missing one
 *  shifts the average rather than dragging it toward zero. */
function composeOvr(ratings: Record<AttributeKey, number | null>): number | null {
  if (ratings.speed == null) return null;
  let weighted = 0;
  let total = 0;
  for (const key of ATTRIBUTE_KEYS) {
    const value = ratings[key];
    if (value == null) continue;
    weighted += value * OVR_WEIGHTS[key];
    total += OVR_WEIGHTS[key];
  }
  return total === 0 ? null : Math.round(weighted / total);
}

function applyOverride(derived: PlayerAttributes, override: AttributeOverride): PlayerAttributes {
  const ratings = { ...derived.ratings };
  for (const key of ATTRIBUTE_KEYS) {
    if (override[key] != null) ratings[key] = override[key]!;
  }
  // An overridden OVR wins outright; otherwise it is recomposed, so bumping one
  // rating by hand moves the headline number the way you would expect.
  const ovr = override.ovr != null ? override.ovr : (composeOvr(ratings) ?? derived.ovr);
  return { ovr, ratings, settled: derived.settled };
}
