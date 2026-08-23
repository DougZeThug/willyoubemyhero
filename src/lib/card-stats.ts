// How a player's run compares to the rest of the field, station by station.
//
// Extracted from card-back-panel.tsx, which computed all of this inline and then
// rendered it at 8px type on a face that spends half its life rotated away from
// the viewer. The maths is the interesting part of a combine card and deserves
// to be readable in more than one place, so it lives here and both the card back
// and the player page's own breakdown read from it.

/** The subset of the event bundle these functions need. */
export type StatsBundle = {
  stations: { id: string; name: string; short_name: string | null; station_order: number }[];
  runs: {
    id: string;
    participant_id: string;
    official_time_ms: number | null;
    is_official: boolean;
  }[];
  splits: { run_id: string; station_id: string; segment_time_ms: number | null }[];
};

export type LadderRow = {
  id: string;
  label: string;
  /** This player's segment time at the station, if recorded. */
  ms: number | null;
  /** Signed difference from the field median. Negative is faster. */
  deltaMs: number | null;
  /** True when nobody in the field was faster here — the station-king split. */
  best: boolean;
  /** Place at this station among everyone with a split here, 1-based. Ties share. */
  place: number | null;
  /** How many players have a split at this station — the denominator for place. */
  fieldCount: number;
};


export type CardStats = {
  /** Fastest official run, or null if they have none. */
  bestRun: StatsBundle["runs"][number] | null;
  /** One row per station, in course order. */
  ladder: LadderRow[];
  /** Place among everyone with an official time, 1-based. Null without one. */
  rank: number | null;
  /** How many players have an official time at all — the denominator for rank. */
  fieldSize: number;
};

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Best official time per participant across the whole field.
 *
 * One entry per participant so a second, slower run can never displace someone's
 * own best — which is also what keeps a re-run from skewing the station medians.
 */
export function bestTimesByParticipant(bundle: StatsBundle): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of bundle.runs) {
    if (!r.is_official || r.official_time_ms == null) continue;
    const cur = out.get(r.participant_id);
    if (cur == null || r.official_time_ms < cur) out.set(r.participant_id, r.official_time_ms);
  }
  return out;
}

/** Everything the card views need about one participant's combine, in one pass. */
export function cardStats(
  bundle: StatsBundle | null | undefined,
  participantId: string | null | undefined,
): CardStats {
  if (!bundle || !participantId) {
    return { bestRun: null, ladder: [], rank: null, fieldSize: 0 };
  }

  const mine = bundle.runs
    .filter((r) => r.is_official && r.participant_id === participantId)
    .sort((a, b) => (a.official_time_ms ?? 0) - (b.official_time_ms ?? 0));
  const bestRun = mine[0] ?? null;

  const allBest = bestTimesByParticipant(bundle);
  const myBestMs = bestRun?.official_time_ms ?? null;
  const rank =
    myBestMs != null ? [...allBest.values()].filter((ms) => ms < myBestMs).length + 1 : null;

  const runOwner = new Map(bundle.runs.map((r) => [r.id, r.participant_id]));
  const stations = [...bundle.stations].sort((a, b) => a.station_order - b.station_order);

  const ladder: LadderRow[] = stations.map((st) => {
    const forStation = bundle.splits.filter(
      (s) => s.station_id === st.id && s.segment_time_ms != null,
    );
    // Field median uses one split per participant so a re-run can't skew it.
    const perParticipant = new Map<string, number>();
    for (const s of forStation) {
      const owner = runOwner.get(s.run_id);
      if (!owner) continue;
      const ms = s.segment_time_ms as number;
      const cur = perParticipant.get(owner);
      if (cur == null || ms < cur) perParticipant.set(owner, ms);
    }
    const fieldMedian = median([...perParticipant.values()]);
    const ms = bestRun
      ? (forStation.find((s) => s.run_id === bestRun.id)?.segment_time_ms ?? null)
      : null;
    const fastest = perParticipant.size ? Math.min(...perParticipant.values()) : null;
    return {
      id: st.id,
      label: st.short_name || st.name,
      ms,
      deltaMs: ms != null && fieldMedian != null ? ms - fieldMedian : null,
      best: ms != null && fastest != null && ms <= fastest,
    };
  });

  return { bestRun, ladder, rank, fieldSize: allBest.size };
}
