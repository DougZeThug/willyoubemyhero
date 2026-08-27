/**
 * Who is in contention, and where they stand.
 *
 * The board and the tier rules used to answer this separately: the leaderboard
 * ranked *official runs* while card-rarity.ts ranked *athletes in contention*.
 * On the same screen that put a dead heat at 1 and 2 beside two champion cards,
 * kept a scratched athlete's place, and listed anybody re-timed twice. One set
 * of rules, read by both, is the fix — the tier is the card's whole claim to a
 * place, so the two must not be able to disagree.
 */

/**
 * Roster statuses that put somebody out of contention for every earned tier and
 * off the board entirely.
 *
 * The live app only ever writes queued | running | finished | scratched
 * (admin.tsx, admin-write.functions.ts). The extra values are the wider
 * vocabulary the schema allows and archived snapshots may still contain.
 */
export const OUT_OF_CONTENTION_STATUSES: ReadonlySet<string> = new Set([
  "scratched",
  "dq",
  "dnp",
  "absent",
]);

export type StandingsRun = {
  participant_id: string;
  official_time_ms: number | null;
  is_official: boolean;
  status: string;
};

export type StandingsParticipant = {
  participant_id: string;
  participation_status: string;
};

export type StandingsBundle<
  P extends StandingsParticipant = StandingsParticipant,
  R extends StandingsRun = StandingsRun,
> = {
  participants: readonly P[];
  runs: readonly R[];
};

export type Standing<R> = {
  participantId: string;
  /** Their best official run — the one the board and the card both quote. */
  run: R;
  /** 1-based, shared on a dead heat. Never the index into the rendered list. */
  place: number;
};

/**
 * A run with no time sorts LAST, everywhere.
 *
 * `?? 0` put it first, which is exactly the state a live combine passes through
 * — a run marked official a beat before its time is typed — and it showed the
 * wrong winner on the big screen in front of the party.
 */
export function compareOfficialTime(
  a: { official_time_ms: number | null },
  b: { official_time_ms: number | null },
): number {
  return (a.official_time_ms ?? Infinity) - (b.official_time_ms ?? Infinity);
}

/**
 * Participants out of contention: a dnf-family roster status, or any run at all
 * marked dq.
 *
 * A dq'd athlete who posted the fastest clock consumed the champion slot even
 * though their own card read dnf, and the honest winner shipped as podium — so
 * this has to be resolved before anything is placed, not alongside it.
 */
export function outOfContention(bundle: StandingsBundle): Set<string> {
  const out = new Set(bundle.runs.filter((r) => r.status === "dq").map((r) => r.participant_id));
  for (const p of bundle.participants) {
    if (OUT_OF_CONTENTION_STATUSES.has(p.participation_status)) out.add(p.participant_id);
  }
  return out;
}

/**
 * Best official run per athlete in contention, fastest first.
 *
 * One row per athlete rather than per run, so somebody re-timed appears once;
 * `place` counts everyone strictly faster and adds one, so a dead heat shares a
 * number rather than splitting on sort stability.
 */
export function standings<P extends StandingsParticipant, R extends StandingsRun>(
  bundle: StandingsBundle<P, R> | null | undefined,
): Standing<R>[] {
  if (!bundle) return [];
  const excluded = outOfContention(bundle);

  const best = new Map<string, R>();
  for (const run of bundle.runs) {
    if (!run.is_official || run.official_time_ms == null) continue;
    if (excluded.has(run.participant_id)) continue;
    const prev = best.get(run.participant_id);
    if (!prev || run.official_time_ms < (prev.official_time_ms ?? Infinity)) {
      best.set(run.participant_id, run);
    }
  }

  const rows = [...best.values()];
  return rows
    .map((run) => ({
      participantId: run.participant_id,
      run,
      place:
        rows.filter((o) => (o.official_time_ms ?? Infinity) < run.official_time_ms!).length + 1,
    }))
    .sort((a, b) => compareOfficialTime(a.run, b.run));
}
