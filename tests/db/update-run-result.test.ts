// Correcting a result that is already in the books.
//
// A wholesale replace has to delete before it inserts — the client keys are
// derived from the run and the station, and client_key is globally unique on
// both child tables — so from the server function this was six requests and six
// implicit transactions. A failure on either insert landed after the deletes had
// already committed: a run with a fresh raw_time_ms, a generated official time
// computed from it, and no splits or penalties under either. The audit row that
// would have named the old time ran last and never ran at all.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, isDenied, IDS, seedEvent, sql } from "./helpers";

afterAll(closeDb);
beforeEach(seedEvent);

const RUN = "00000000-0000-4000-8000-00000000b001";
const STATION_A = "00000000-0000-4000-8000-00000000b0a1";
const STATION_B = "00000000-0000-4000-8000-00000000b0a2";
const NO_SUCH_STATION = "00000000-0000-4000-8000-00000000dead";

async function seedRun() {
  await sql(
    `INSERT INTO public.stations (id, event_id, name, station_order, active) VALUES
       ($1, $3, 'Cornhole', 1, true), ($2, $3, 'Beer Pong', 2, true)`,
    [STATION_A, STATION_B, IDS.event],
  );
  await sql(
    `INSERT INTO public.runs (id, event_id, participant_id, started_at, raw_time_ms, penalty_ms)
     VALUES ($1, $2, $3, now(), 60000, 5000)`,
    [RUN, IDS.event, IDS.alice],
  );
  await sql(
    `INSERT INTO public.splits (run_id, station_id, cumulative_time_ms, segment_time_ms, client_key)
     VALUES ($1, $2, 20000, 20000, 'original:a')`,
    [RUN, STATION_A],
  );
  await sql(
    `INSERT INTO public.penalties (run_id, station_id, penalty_ms, reason, client_key)
     VALUES ($1, $2, 5000, 'Missed cone', 'original:p')`,
    [RUN, STATION_A],
  );
}

/** Split rows as the RPC takes them: already sorted, already differenced. */
function splitRows(rows: Array<{ station: string; at: number; seg: number }>) {
  return JSON.stringify(
    rows.map((r) => ({
      station_id: r.station,
      cumulative_time_ms: r.at,
      segment_time_ms: r.seg,
      recorded_at: new Date(Date.UTC(2026, 6, 28, 12, 0, 0)).toISOString(),
      client_key: `edit:${RUN}:${r.station}`,
    })),
  );
}

function penaltyRows(rows: Array<{ station: string | null; ms: number; reason: string | null }>) {
  return JSON.stringify(
    rows.map((r, i) => ({
      station_id: r.station,
      penalty_ms: r.ms,
      reason: r.reason,
      client_key: `edit:${RUN}:${i}`,
    })),
  );
}

function replace(splits: string, penalties: string, raw = 55000, penalty = 2000) {
  return sql("SELECT public.update_run_result($1, $2, $3, $4, $5::jsonb, $6::jsonb)", [
    RUN,
    IDS.event,
    raw,
    penalty,
    splits,
    penalties,
  ]);
}

const readRun = () =>
  sql<{ raw_time_ms: number; penalty_ms: number; official_time_ms: number }>(
    "SELECT raw_time_ms, penalty_ms, official_time_ms FROM public.runs WHERE id = $1",
    [RUN],
  );

const readSplits = () =>
  sql<{ station_id: string; cumulative_time_ms: number; entry_method: string; corrected: boolean }>(
    `SELECT station_id::text, cumulative_time_ms, entry_method, corrected
     FROM public.splits WHERE run_id = $1 ORDER BY cumulative_time_ms`,
    [RUN],
  );

const readPenalties = () =>
  sql<{ penalty_ms: number; reason: string | null; created_by: string }>(
    `SELECT penalty_ms, reason, created_by FROM public.penalties
     WHERE run_id = $1 ORDER BY penalty_ms`,
    [RUN],
  );

describe("update_run_result", () => {
  beforeEach(seedRun);

  it("replaces the whole result and records what it used to be", async () => {
    await replace(
      splitRows([
        { station: STATION_A, at: 15000, seg: 15000 },
        { station: STATION_B, at: 40000, seg: 25000 },
      ]),
      penaltyRows([{ station: STATION_B, ms: 2000, reason: "Foot fault" }]),
    );

    // official_time_ms is generated, so fixing the parts fixes the total.
    expect((await readRun())[0]).toEqual({
      raw_time_ms: 55000,
      penalty_ms: 2000,
      official_time_ms: 57000,
    });

    const splits = await readSplits();
    expect(splits.map((s) => s.cumulative_time_ms)).toEqual([15000, 40000]);
    expect(splits.every((s) => s.entry_method === "admin_edit" && s.corrected)).toBe(true);

    expect(await readPenalties()).toEqual([
      { penalty_ms: 2000, reason: "Foot fault", created_by: "admin" },
    ]);

    const [log] = await sql<{
      action: string;
      previous_value: { raw_time_ms: number; penalty_ms: number };
      new_value: { raw_time_ms: number; penalty_ms: number };
    }>("SELECT action, previous_value, new_value FROM public.audit_logs WHERE entity_id = $1", [
      RUN,
    ]);
    expect(log.action).toBe("update_run_result");
    expect(log.previous_value).toEqual({ raw_time_ms: 60000, penalty_ms: 5000 });
    expect(log.new_value).toEqual({ raw_time_ms: 55000, penalty_ms: 2000 });
  });

  it("keeps the old result when the new one cannot be written", async () => {
    // The whole reason this is one statement. From the server function the
    // deletes had already committed by the time an insert could fail, so this
    // left a run with a new time and nothing under it — and no audit row,
    // because that was written last.
    await expect(
      replace(
        splitRows([{ station: NO_SUCH_STATION, at: 15000, seg: 15000 }]),
        penaltyRows([{ station: null, ms: 2000, reason: null }]),
      ),
    ).rejects.toThrow();

    expect((await readRun())[0]).toMatchObject({ raw_time_ms: 60000, penalty_ms: 5000 });
    expect((await readSplits()).map((s) => s.cumulative_time_ms)).toEqual([20000]);
    expect(await readPenalties()).toEqual([
      { penalty_ms: 5000, reason: "Missed cone", created_by: null },
    ]);
    expect(await sql("SELECT 1 FROM public.audit_logs WHERE entity_id = $1", [RUN])).toHaveLength(
      0,
    );
  });

  it("rolls the penalties back too when only they are bad", async () => {
    await expect(
      replace(
        splitRows([{ station: STATION_A, at: 15000, seg: 15000 }]),
        penaltyRows([{ station: NO_SUCH_STATION, ms: 2000, reason: null }]),
      ),
    ).rejects.toThrow();

    expect((await readSplits()).map((s) => s.cumulative_time_ms)).toEqual([20000]);
    expect(await readPenalties()).toHaveLength(1);
  });

  it("clears both children when the sheet sends nothing", async () => {
    // A station left blank means "there is no split here" and disappears.
    await replace("[]", "[]", 55000, 0);

    expect(await readSplits()).toHaveLength(0);
    expect(await readPenalties()).toHaveLength(0);
    expect((await readRun())[0]).toMatchObject({ raw_time_ms: 55000, penalty_ms: 0 });
  });

  it("refuses a run belonging to another event, touching nothing", async () => {
    const other = "00000000-0000-4000-8000-00000000b0ff";
    await sql("INSERT INTO public.events (id, name, year, active) VALUES ($1, 'Last year', 2025, false)", [other]); // prettier-ignore

    await expect(
      sql("SELECT public.update_run_result($1, $2, $3, $4, $5::jsonb, $6::jsonb)", [
        RUN,
        other,
        55000,
        0,
        "[]",
        "[]",
      ]),
    ).rejects.toThrow(/not part of this event/);

    expect((await readRun())[0]).toMatchObject({ raw_time_ms: 60000, penalty_ms: 5000 });
    expect(await readSplits()).toHaveLength(1);
  });

  it("is not executable by anon or authenticated", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      expect(
        await isDenied(role, "SELECT public.update_run_result($1, $2, 1, 0, '[]'::jsonb, '[]'::jsonb)", [RUN, IDS.event]), // prettier-ignore
      ).toBe(true);
    }
  });
});
