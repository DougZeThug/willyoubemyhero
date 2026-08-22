// The two counters this app computes as "how many are there, plus one".
//
// saveCompletedRun numbers a run's attempt that way and recordDraftSelection
// numbers a pick that way, both as a read followed by a write. Two consoles
// acting at the same moment read the same number and both write it, and until
// 20260822120000 nothing in the schema refused the second one — so a double-tap
// on Save produced two runs recorded as the same attempt, silently.
//
// What is checked here is that the second write now fails, and that the
// idempotent save path — which re-sends a number it already owns — still does not.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, IDS, seedEvent, sql } from "./helpers";

beforeEach(seedEvent);
afterAll(closeDb);

/** The columns saveCompletedRun writes, minus the ones with defaults. */
async function insertRun(attempt: number, clientKey: string | null, participant = IDS.alice) {
  return sql(
    `INSERT INTO public.runs
       (event_id, participant_id, attempt_number, raw_time_ms, status, is_official, client_key)
     VALUES ($1, $2, $3, 60000, 'official', true, $4)
     RETURNING id, attempt_number`,
    [IDS.event, participant, attempt, clientKey],
  );
}

describe("runs (event_id, participant_id, attempt_number)", () => {
  it("refuses a second run recorded as the same attempt", async () => {
    await insertRun(1, "key-a");
    await expect(insertRun(1, "key-b")).rejects.toThrow(/duplicate key|unique/i);
  });

  it("leaves the first run standing after the refusal", async () => {
    await insertRun(1, "key-a");
    await insertRun(1, "key-b").catch(() => {});
    expect(await sql("SELECT count(*)::int AS n FROM public.runs")).toEqual([{ n: 1 }]);
  });

  it("still allows the same attempt number for a different athlete", async () => {
    // Everybody's first run is attempt 1; the index is per athlete, not per event.
    await insertRun(1, "key-a", IDS.alice);
    await expect(insertRun(1, "key-b", IDS.bob)).resolves.toHaveLength(1);
  });

  it("still allows the same athlete a second, differently numbered attempt", async () => {
    await insertRun(1, "key-a");
    await expect(insertRun(2, "key-b")).resolves.toHaveLength(1);
  });

  it("lets a replayed save update its own row rather than colliding with it", async () => {
    // saveCompletedRun's idempotent path: the upsert arbitrates on client_key and
    // a retry re-sends the attempt number it was already given, so the row it
    // conflicts with is itself. If ON CONFLICT stopped working under the new
    // index, the console's Retry button would start failing instead of saving.
    await insertRun(1, "replay-key");
    await sql(
      `INSERT INTO public.runs
         (event_id, participant_id, attempt_number, raw_time_ms, status, is_official, client_key)
       VALUES ($1, $2, 1, 61000, 'official', true, 'replay-key')
       ON CONFLICT (client_key) DO UPDATE SET raw_time_ms = EXCLUDED.raw_time_ms`,
      [IDS.event, IDS.alice],
    );
    expect(
      await sql("SELECT count(*)::int AS n, max(raw_time_ms)::int AS ms FROM public.runs"),
    ).toEqual([{ n: 1, ms: 61000 }]);
  });
});

describe("draft_selections (event_id, selection_order)", () => {
  async function pick(order: number, position: number, participant: string) {
    return sql(
      `INSERT INTO public.draft_selections (event_id, participant_id, selection_order, draft_position)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [IDS.event, participant, order, position],
    );
  }

  it("refuses a second pick recorded in the same position in the order", async () => {
    // The other two uniques on this table — draft_position and participant_id —
    // would both let this through: two different people picked at two different
    // draft positions, filed as the same pick number.
    await pick(1, 1, IDS.alice);
    await expect(pick(1, 2, IDS.bob)).rejects.toThrow(/duplicate key|unique/i);
  });

  it("still allows the picks that follow", async () => {
    await pick(1, 1, IDS.alice);
    await expect(pick(2, 2, IDS.bob)).resolves.toHaveLength(1);
  });
});
