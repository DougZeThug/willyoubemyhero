// Typing in a result the clock missed.
//
// createManualRun used to be six requests and six implicit transactions, so a
// failure after the run insert left a run on the ladder with no splits, an
// athlete still waiting, and no audit row. It is one RPC now, and it checks for
// itself that the athlete and every station named belong to the event — a
// station id is only an FK away from any event's course.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, isDenied, IDS, seedEvent, sql } from "./helpers";

afterAll(closeDb);
beforeEach(seedEvent);

const STATION_A = "00000000-0000-4000-8000-00000000c0a1";
const STATION_B = "00000000-0000-4000-8000-00000000c0a2";
const OTHER_EVENT = "00000000-0000-4000-8000-00000000c0ff";
const FOREIGN_STATION = "00000000-0000-4000-8000-00000000c0f1";
const NO_SUCH_STATION = "00000000-0000-4000-8000-00000000dead";

const STARTED = "2026-07-28T12:00:00.000Z";
const FINISHED = "2026-07-28T12:01:01.000Z";

beforeEach(async () => {
  await sql(
    `INSERT INTO public.stations (id, event_id, name, station_order, active) VALUES
       ($1, $3, 'Cornhole', 1, true), ($2, $3, 'Beer Pong', 2, true)`,
    [STATION_A, STATION_B, IDS.event],
  );
  await sql(
    "INSERT INTO public.events (id, name, year, active) VALUES ($1, 'Last year', 2025, false)",
    [OTHER_EVENT],
  );
  await sql(
    "INSERT INTO public.stations (id, event_id, name, station_order, active) VALUES ($1, $2, 'Old sled', 1, true)",
    [FOREIGN_STATION, OTHER_EVENT],
  );
  await sql(
    `UPDATE public.event_participants SET participation_status = 'running', on_clock_since = now()
      WHERE event_id = $1 AND participant_id = $2`,
    [IDS.event, IDS.alice],
  );
});

type SplitRow = {
  station: string;
  at: number;
  seg: number;
};
type PenaltyRow = { station: string | null; ms: number; reason: string | null };

const splitJson = (rows: SplitRow[]) =>
  JSON.stringify(
    rows.map((r) => ({
      station_id: r.station,
      cumulative_time_ms: r.at,
      segment_time_ms: r.seg,
      recorded_at: new Date(Date.parse(STARTED) + r.at).toISOString(),
    })),
  );

const penaltyJson = (rows: PenaltyRow[]) =>
  JSON.stringify(rows.map((r) => ({ station_id: r.station, penalty_ms: r.ms, reason: r.reason })));

async function create(
  splits: SplitRow[] = [],
  penalties: PenaltyRow[] = [],
  { participant = IDS.alice, event = IDS.event } = {},
) {
  const [row] = await sql<{ id: string }>(
    `SELECT public.create_manual_run($1, $2, 61000, $3, $4, $5, $6::jsonb, $7::jsonb) AS id`,
    [
      event,
      participant,
      penalties.reduce((sum, p) => sum + p.ms, 0),
      STARTED,
      FINISHED,
      splitJson(splits),
      penaltyJson(penalties),
    ],
  );
  return row.id;
}

const count = async (table: string) =>
  Number((await sql<{ n: string }>(`SELECT count(*) AS n FROM public.${table}`))[0].n);

describe("create_manual_run", () => {
  it("writes the run, splits, penalties, roster stamp and audit row together", async () => {
    const id = await create(
      [
        { station: STATION_A, at: 20000, seg: 20000 },
        { station: STATION_B, at: 45000, seg: 25000 },
      ],
      [
        { station: STATION_B, ms: 5000, reason: "Missed cone" },
        { station: null, ms: 1000, reason: null },
      ],
    );

    const [run] = await sql<Record<string, unknown>>(
      `SELECT event_id::text, participant_id::text, attempt_number, raw_time_ms, penalty_ms,
              official_time_ms, status, is_official, paused_duration_ms, client_key,
              started_at, finished_at
         FROM public.runs WHERE id = $1`,
      [id],
    );
    expect(run).toMatchObject({
      event_id: IDS.event,
      participant_id: IDS.alice,
      attempt_number: 1,
      raw_time_ms: 61000,
      penalty_ms: 6000,
      official_time_ms: 67000,
      status: "official",
      is_official: true,
      paused_duration_ms: 0,
    });
    expect(run.client_key).toMatch(/^manual:[0-9a-f-]{36}$/);
    expect(new Date(run.started_at as string).toISOString()).toBe(STARTED);
    expect(new Date(run.finished_at as string).toISOString()).toBe(FINISHED);

    const splits = await sql<Record<string, unknown>>(
      `SELECT station_id::text, cumulative_time_ms, segment_time_ms, entry_method, client_key
         FROM public.splits WHERE run_id = $1 ORDER BY cumulative_time_ms`,
      [id],
    );
    expect(splits).toEqual([
      {
        station_id: STATION_A,
        cumulative_time_ms: 20000,
        segment_time_ms: 20000,
        entry_method: "admin_manual",
        client_key: `manual:${id}:${STATION_A}`,
      },
      {
        station_id: STATION_B,
        cumulative_time_ms: 45000,
        segment_time_ms: 25000,
        entry_method: "admin_manual",
        client_key: `manual:${id}:${STATION_B}`,
      },
    ]);

    // Keys follow the order the penalties arrived in, as the handler always keyed them.
    const penalties = await sql<Record<string, unknown>>(
      `SELECT station_id::text, penalty_ms, reason, created_by, client_key
         FROM public.penalties WHERE run_id = $1 ORDER BY client_key`,
      [id],
    );
    expect(penalties).toEqual([
      {
        station_id: STATION_B,
        penalty_ms: 5000,
        reason: "Missed cone",
        created_by: "admin",
        client_key: `manual:${id}:0`,
      },
      {
        station_id: null,
        penalty_ms: 1000,
        reason: null,
        created_by: "admin",
        client_key: `manual:${id}:1`,
      },
    ]);

    const [roster] = await sql<{ participation_status: string; on_clock_since: string | null }>(
      `SELECT participation_status, on_clock_since FROM public.event_participants
        WHERE event_id = $1 AND participant_id = $2`,
      [IDS.event, IDS.alice],
    );
    expect(roster).toEqual({ participation_status: "finished", on_clock_since: null });

    const [log] = await sql<{ action: string; event_id: string; new_value: unknown }>(
      "SELECT action, event_id::text, new_value FROM public.audit_logs WHERE entity_id = $1",
      [id],
    );
    expect(log).toEqual({
      action: "manual_run_entry",
      event_id: IDS.event,
      new_value: { raw_time_ms: 61000, penalty_ms: 6000 },
    });
  });

  it("numbers the attempt after the athlete's existing runs at this event only", async () => {
    expect(await create()).toBeTruthy();
    const second = await create();
    const [row] = await sql<{ attempt_number: number }>(
      "SELECT attempt_number FROM public.runs WHERE id = $1",
      [second],
    );
    expect(row.attempt_number).toBe(2);

    // Somebody else's runs, and the same athlete's runs elsewhere, do not count.
    const bobsFirst = await create([], [], { participant: IDS.bob });
    expect(
      (
        await sql<{ attempt_number: number }>(
          "SELECT attempt_number FROM public.runs WHERE id = $1",
          [bobsFirst],
        )
      )[0].attempt_number,
    ).toBe(1);
  });

  it("refuses an athlete who is not on this event's roster, writing nothing", async () => {
    await expect(create([], [], { participant: IDS.outsider })).rejects.toThrow(
      /Player is not in this event/,
    );
    expect(await count("runs")).toBe(0);
    expect(await count("audit_logs")).toBe(0);
  });

  it("refuses an event the athlete is not rostered on, even for a real event", async () => {
    await expect(create([], [], { event: OTHER_EVENT })).rejects.toThrow(
      /Player is not in this event/,
    );
    expect(await count("runs")).toBe(0);
  });

  it("refuses a split on another event's station, writing nothing", async () => {
    await expect(
      create([
        { station: STATION_A, at: 20000, seg: 20000 },
        { station: FOREIGN_STATION, at: 40000, seg: 20000 },
      ]),
    ).rejects.toThrow(/That station is not part of this event\./);
    expect(await count("runs")).toBe(0);
    expect(await count("splits")).toBe(0);
    expect(await count("audit_logs")).toBe(0);
  });

  it("refuses a penalty on another event's station, but allows one with no station", async () => {
    await expect(
      create([], [{ station: FOREIGN_STATION, ms: 1000, reason: null }]),
    ).rejects.toThrow(/That station is not part of this event\./);
    expect(await count("runs")).toBe(0);

    await create([], [{ station: null, ms: 1000, reason: null }]);
    expect(await count("penalties")).toBe(1);
  });

  it("rolls the whole result back when a later write fails", async () => {
    // A station that does not exist at all is caught by the scoping check; a
    // duplicate client key is not, and fails only at the splits insert, after the
    // run row and the numbering have been written. None of it may survive.
    await expect(
      create([
        { station: STATION_A, at: 20000, seg: 20000 },
        { station: STATION_A, at: 30000, seg: 10000 },
      ]),
    ).rejects.toThrow();
    expect(await count("runs")).toBe(0);
    expect(await count("splits")).toBe(0);
    expect(await count("audit_logs")).toBe(0);
    const [roster] = await sql<{ participation_status: string }>(
      `SELECT participation_status FROM public.event_participants
        WHERE event_id = $1 AND participant_id = $2`,
      [IDS.event, IDS.alice],
    );
    expect(roster.participation_status).toBe("running");
  });

  it("treats a station that exists nowhere as outside the event", async () => {
    await expect(create([{ station: NO_SUCH_STATION, at: 1000, seg: 1000 }])).rejects.toThrow(
      /not part of this event/,
    );
    expect(await count("runs")).toBe(0);
  });

  it("is not executable by anon or authenticated", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      expect(
        await isDenied(
          role,
          "SELECT public.create_manual_run($1, $2, 1, 0, now(), now(), '[]'::jsonb, '[]'::jsonb)",
          [IDS.event, IDS.alice],
        ),
      ).toBe(true);
    }
  });
});
