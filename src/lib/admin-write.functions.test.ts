// The commissioner's write surface. Every handler here runs as service_role
// with RLS out of the picture, so `requireAdmin` is the only thing between a
// request and the database.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseResponses } from "@/test/supabase-mock";
import { adminHeaders, callServerFn, memberHeaders } from "@/test/server-fn";
import { signAdminToken, signMemberToken } from "./session.server";

let mock = createSupabaseMock();

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return mock.client;
  },
}));

const EVENT_ID = "00000000-0000-4000-8000-0000000000ff";
const OTHER_EVENT_ID = "00000000-0000-4000-8000-0000000000ee";
const PARTICIPANT_ID = "00000000-0000-4000-8000-0000000000aa";
const EVENT_PARTICIPANT_ID = "00000000-0000-4000-8000-000000000011";
const STATION_ID = "00000000-0000-4000-8000-000000000022";
const RUN_ID = "00000000-0000-4000-8000-000000000033";

function withDb(responses: SupabaseResponses = {}) {
  mock = createSupabaseMock(responses);
}

const asAdmin = (eventId = EVENT_ID) => adminHeaders(signAdminToken(eventId).token);

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
  withDb();
});

/**
 * A minimal valid payload per handler, so the auth sweep below reaches the
 * guard rather than tripping over its own input validation.
 *
 * Every exported handler must appear here. That is the point: a new write
 * endpoint added without an entry fails the completeness check, and one added
 * without `requireAdmin` fails the sweep.
 */
const VALID_PAYLOADS: Record<string, Record<string, unknown>> = {
  upsertParticipant: { eventId: EVENT_ID, name: "Doug" },
  addParticipantToEvent: { eventId: EVENT_ID, participantId: PARTICIPANT_ID },
  removeParticipantFromEvent: { eventId: EVENT_ID, eventParticipantId: EVENT_PARTICIPANT_ID },
  setParticipantStatus: {
    eventId: EVENT_ID,
    eventParticipantId: EVENT_PARTICIPANT_ID,
    status: "finished",
  },
  setRunningOrder: {
    eventId: EVENT_ID,
    order: [{ id: EVENT_PARTICIPANT_ID, running_order: 1 }],
  },
  recordRandomization: {
    eventId: EVENT_ID,
    scope: "running_order",
    previous: [],
    resulting: [],
    seed: "seed",
  },
  upsertStation: {
    eventId: EVENT_ID,
    name: "Sled Push",
    station_order: 1,
    split_enabled: true,
    penalty_amount_ms: 5_000,
    active: true,
  },
  deleteStation: { eventId: EVENT_ID, id: STATION_ID },
  saveCompletedRun: {
    eventId: EVENT_ID,
    participantId: PARTICIPANT_ID,
    clientKey: "client-key-1",
    started_at: "2026-07-28T12:00:00.000Z",
    finished_at: "2026-07-28T12:01:00.000Z",
    raw_time_ms: 60_000,
  },
  deleteRun: { eventId: EVENT_ID, runId: RUN_ID },
  recordDraftSelection: {
    eventId: EVENT_ID,
    participantId: PARTICIPANT_ID,
    draftPosition: 1,
  },
  undoLastDraftSelection: { eventId: EVENT_ID },
  updateEvent: { eventId: EVENT_ID, status: "live" },
  resetCombine: { eventId: EVENT_ID },
  resetParticipantRuns: { eventId: EVENT_ID, participantId: PARTICIPANT_ID },
  updateRunResult: {
    eventId: EVENT_ID,
    runId: RUN_ID,
    raw_time_ms: 61_000,
    splits: [{ stationId: STATION_ID, cumulative_time_ms: 20_000 }],
    penalties: [{ stationId: STATION_ID, penalty_ms: 5_000, reason: "Missed cone" }],
  },
  deleteRunResult: { eventId: EVENT_ID, runId: RUN_ID },
  createManualRun: {
    eventId: EVENT_ID,
    participantId: PARTICIPANT_ID,
    raw_time_ms: 61_000,
    splits: [{ stationId: STATION_ID, cumulative_time_ms: 20_000 }],
    penalties: [],
  },
};

describe("every write requires the commissioner", () => {
  it("covers every exported handler", async () => {
    // If this fails, a new endpoint was added without an entry above, and the
    // sweep below is therefore no longer checking it.
    const mod = await import("./admin-write.functions");
    expect(Object.keys(mod).sort()).toEqual(Object.keys(VALID_PAYLOADS).sort());
  });

  it.each(Object.keys(VALID_PAYLOADS))("%s refuses an unauthenticated request", async (name) => {
    const mod = (await import("./admin-write.functions")) as unknown as Record<
      string,
      (o?: { data?: unknown }) => Promise<unknown>
    >;
    await expect(callServerFn(mod[name], { data: VALID_PAYLOADS[name] })).rejects.toThrow(
      "Admin PIN required",
    );
    expect(mock.calls).toHaveLength(0);
  });

  it.each(Object.keys(VALID_PAYLOADS))("%s refuses a member token", async (name) => {
    const mod = (await import("./admin-write.functions")) as unknown as Record<
      string,
      (o?: { data?: unknown }) => Promise<unknown>
    >;
    const headers = memberHeaders(signMemberToken(PARTICIPANT_ID).token);
    await expect(callServerFn(mod[name], { data: VALID_PAYLOADS[name], headers })).rejects.toThrow(
      "Admin PIN required",
    );
  });

  it.each(Object.keys(VALID_PAYLOADS))(
    "%s refuses an admin token for a different event",
    async (name) => {
      const mod = (await import("./admin-write.functions")) as unknown as Record<
        string,
        (o?: { data?: unknown }) => Promise<unknown>
      >;
      await expect(
        callServerFn(mod[name], {
          data: VALID_PAYLOADS[name],
          headers: asAdmin(OTHER_EVENT_ID),
        }),
      ).rejects.toThrow("Admin PIN required");
    },
  );
});

describe("the crowd clock", () => {
  // /live counts up from event_participants.on_clock_since. Nothing else
  // records when somebody stepped up: the runs row is not written until the run
  // is over, so before this column the spectator timer just counted from
  // whenever the browser happened to load.
  async function setStatus(status: string) {
    const { setParticipantStatus } = await import("./admin-write.functions");
    await callServerFn(setParticipantStatus, {
      data: { eventId: EVENT_ID, eventParticipantId: EVENT_PARTICIPANT_ID, status },
      headers: asAdmin(),
    });
    return mock.callsFor("event_participants", "update")[0].payload as Record<string, unknown>;
  }

  it("starts the clock when somebody goes on it", async () => {
    const payload = await setStatus("running");
    expect(payload.participation_status).toBe("running");
    expect(Date.parse(payload.on_clock_since as string)).not.toBeNaN();
  });

  it("keeps the original stamp when an athlete already on the clock is started", async () => {
    // setOnClock and then Start both write "running". Re-stamping on the second
    // would drag the spectator clock forward to the Start tap and lose the
    // moment the athlete actually stepped up.
    withDb({ "event_participants.select": { data: { participation_status: "running" } } });
    const payload = await setStatus("running");
    expect(payload).toEqual({ participation_status: "running" });
    expect(payload).not.toHaveProperty("on_clock_since");
  });

  it("clears the clock on every other status", async () => {
    for (const status of ["waiting", "queued", "finished", "scratched"]) {
      withDb();
      expect(await setStatus(status)).toEqual({
        participation_status: status,
        on_clock_since: null,
      });
    }
  });

  it("clears the clock when the combine is reset", async () => {
    const { resetCombine } = await import("./admin-write.functions");
    withDb({ "runs.select": { data: [] } });
    await callServerFn(resetCombine, { data: { eventId: EVENT_ID }, headers: asAdmin() });
    const [update] = mock.callsFor("event_participants", "update");
    expect(update.payload).toEqual({ participation_status: "waiting", on_clock_since: null });
  });
});

describe("saveCompletedRun", () => {
  const base = VALID_PAYLOADS.saveCompletedRun;

  async function save(data: unknown) {
    const { saveCompletedRun } = await import("./admin-write.functions");
    return callServerFn(saveCompletedRun, { data, headers: asAdmin() });
  }

  function runInserted() {
    return mock.callsFor("runs", "upsert")[0].payload as Record<string, unknown>;
  }

  it("numbers a first attempt 1", async () => {
    withDb({ "runs.select": { count: 0 }, "runs.upsert": { data: { id: RUN_ID } } });
    await save(base);
    expect(runInserted().attempt_number).toBe(1);
  });

  it("numbers the next attempt after the existing ones", async () => {
    withDb({ "runs.select": { count: 2 }, "runs.upsert": { data: { id: RUN_ID } } });
    await save(base);
    expect(runInserted().attempt_number).toBe(3);
  });

  it("counts only this participant's runs at this event", async () => {
    withDb({ "runs.select": { count: 0 }, "runs.upsert": { data: { id: RUN_ID } } });
    await save(base);
    const count = mock.callsFor("runs", "select").find((c) => c.terminal === "await")!;
    expect(mock.eqValue(count, "event_id")).toBe(EVENT_ID);
    expect(mock.eqValue(count, "participant_id")).toBe(PARTICIPANT_ID);
  });

  it("keeps the attempt number a retry was already given", async () => {
    // The console's Retry button re-sends the same client_key. Renumbering it
    // would turn a first run into "attempt 2" purely because the phone had to
    // try twice.
    withDb({
      "runs.select": [{ data: { attempt_number: 1 } }, { count: 1 }],
      "runs.upsert": { data: { id: RUN_ID } },
    });
    await save(base);
    expect(runInserted().attempt_number).toBe(1);
    const lookup = mock.callsFor("runs", "select").find((c) => c.terminal === "maybeSingle")!;
    expect(mock.eqValue(lookup, "client_key")).toBe("client-key-1");
  });

  it("totals the penalties onto the run", async () => {
    withDb({ "runs.select": { count: 0 }, "runs.upsert": { data: { id: RUN_ID } } });
    await save({
      ...base,
      penalties: [
        { stationId: null, penalty_ms: 5_000, reason: "cone", clientKey: "p1" },
        { stationId: STATION_ID, penalty_ms: 2_500, reason: null, clientKey: "p2" },
      ],
    });
    expect(runInserted().penalty_ms).toBe(7_500);
  });

  it("records a zero penalty total when there were none", async () => {
    withDb({ "runs.select": { count: 0 }, "runs.upsert": { data: { id: RUN_ID } } });
    await save(base);
    expect(runInserted().penalty_ms).toBe(0);
  });

  it("keys the upsert on the client key, so a replayed save is idempotent", async () => {
    // A phone that loses signal mid-save retries; that must not create a
    // second run for the same effort.
    withDb({ "runs.select": { count: 0 }, "runs.upsert": { data: { id: RUN_ID } } });
    await save(base);
    expect(mock.callsFor("runs", "upsert")[0].options).toEqual({ onConflict: "client_key" });
    expect(runInserted().client_key).toBe("client-key-1");
  });

  it("marks the run official", async () => {
    withDb({ "runs.select": { count: 0 }, "runs.upsert": { data: { id: RUN_ID } } });
    await save(base);
    expect(runInserted()).toMatchObject({ status: "official", is_official: true });
  });

  it("writes splits and penalties against the saved run", async () => {
    withDb({ "runs.select": { count: 0 }, "runs.upsert": { data: { id: RUN_ID } } });
    await save({
      ...base,
      splits: [
        {
          stationId: STATION_ID,
          cumulative_time_ms: 20_000,
          segment_time_ms: 20_000,
          clientKey: "s1",
          recorded_at: "2026-07-28T12:00:20.000Z",
        },
      ],
      penalties: [{ stationId: STATION_ID, penalty_ms: 5_000, reason: null, clientKey: "p1" }],
    });
    const splits = mock.callsFor("splits", "upsert")[0];
    expect((splits.payload as Record<string, unknown>[])[0]).toMatchObject({
      run_id: RUN_ID,
      station_id: STATION_ID,
      entry_method: "live_manual",
    });
    expect(splits.options).toEqual({ onConflict: "client_key" });
    expect(mock.callsFor("penalties", "upsert")[0].options).toEqual({ onConflict: "client_key" });
  });

  it("skips the split and penalty writes entirely when there are none", async () => {
    withDb({ "runs.select": { count: 0 }, "runs.upsert": { data: { id: RUN_ID } } });
    await save(base);
    expect(mock.callsFor("splits")).toHaveLength(0);
    expect(mock.callsFor("penalties")).toHaveLength(0);
  });

  it("marks the participant finished and stops the crowd clock", async () => {
    withDb({ "runs.select": { count: 0 }, "runs.upsert": { data: { id: RUN_ID } } });
    await save(base);
    const [update] = mock.callsFor("event_participants", "update");
    expect(update.payload).toEqual({
      participation_status: "finished",
      on_clock_since: null,
    });
    expect(mock.eqValue(update, "participant_id")).toBe(PARTICIPANT_ID);
  });

  it("surfaces a failed run write rather than reporting a run id", async () => {
    withDb({
      "runs.select": { count: 0 },
      "runs.upsert": { data: null, error: { message: "conflict" } },
    });
    await expect(save(base)).rejects.toBeTruthy();
  });

  it("rejects a negative time", async () => {
    await expect(save({ ...base, raw_time_ms: -1 })).rejects.toThrow();
  });

  it("rejects a client key too short to be unique", async () => {
    await expect(save({ ...base, clientKey: "short" })).rejects.toThrow();
  });
});

describe("addParticipantToEvent", () => {
  it("appends to the end of the running order", async () => {
    withDb({ "event_participants.select": { data: { running_order: 7 } } });
    const { addParticipantToEvent } = await import("./admin-write.functions");
    await callServerFn(addParticipantToEvent, {
      data: VALID_PAYLOADS.addParticipantToEvent,
      headers: asAdmin(),
    });
    expect(mock.callsFor("event_participants", "insert")[0].payload).toMatchObject({
      running_order: 8,
      bib_number: null,
    });
  });

  it("starts at 1 for the first entrant", async () => {
    withDb({ "event_participants.select": { data: null } });
    const { addParticipantToEvent } = await import("./admin-write.functions");
    await callServerFn(addParticipantToEvent, {
      data: VALID_PAYLOADS.addParticipantToEvent,
      headers: asAdmin(),
    });
    expect(mock.callsFor("event_participants", "insert")[0].payload).toMatchObject({
      running_order: 1,
    });
  });
});

describe("upsertParticipant", () => {
  it("inserts when no id is given, and does not carry eventId into the row", async () => {
    withDb({ "participants.insert": { data: { id: PARTICIPANT_ID } } });
    const { upsertParticipant } = await import("./admin-write.functions");
    await callServerFn(upsertParticipant, {
      data: { eventId: EVENT_ID, name: "Doug", nickname: "Dougie" },
      headers: asAdmin(),
    });
    const payload = mock.callsFor("participants", "insert")[0].payload as Record<string, unknown>;
    expect(payload).toEqual({ name: "Doug", nickname: "Dougie" });
    expect(payload).not.toHaveProperty("eventId");
  });

  it("updates the named participant when an id is given", async () => {
    withDb({ "participants.update": { data: { id: PARTICIPANT_ID } } });
    const { upsertParticipant } = await import("./admin-write.functions");
    await callServerFn(upsertParticipant, {
      data: { eventId: EVENT_ID, id: PARTICIPANT_ID, name: "Doug" },
      headers: asAdmin(),
    });
    const [update] = mock.callsFor("participants", "update");
    expect(mock.eqValue(update, "id")).toBe(PARTICIPANT_ID);
    expect(mock.callsFor("participants", "insert")).toHaveLength(0);
  });

  it("rejects a profile image that is not a url at all", async () => {
    const { upsertParticipant } = await import("./admin-write.functions");
    await expect(
      callServerFn(upsertParticipant, {
        data: { eventId: EVENT_ID, name: "Doug", profile_image_url: "not a url" },
        headers: asAdmin(),
      }),
    ).rejects.toThrow();
  });

  it("accepts any scheme, which z.string().url() does not constrain", async () => {
    // Documenting the boundary rather than asserting a guard that isn't there.
    // The value only ever reaches an <img src>, where browsers refuse to
    // execute a javascript: URL, so this is a sharp edge and not a hole — but
    // it is the line to move if that ever stops being true.
    withDb({ "participants.insert": { data: { id: PARTICIPANT_ID } } });
    const { upsertParticipant } = await import("./admin-write.functions");
    await expect(
      callServerFn(upsertParticipant, {
        data: { eventId: EVENT_ID, name: "Doug", profile_image_url: "javascript:alert(1)" },
        headers: asAdmin(),
      }),
    ).resolves.toBeTruthy();
  });

  it("rejects an over-long name", async () => {
    const { upsertParticipant } = await import("./admin-write.functions");
    await expect(
      callServerFn(upsertParticipant, {
        data: { eventId: EVENT_ID, name: "x".repeat(81) },
        headers: asAdmin(),
      }),
    ).rejects.toThrow();
  });
});

describe("draft selections", () => {
  it("numbers selections in order and records the drafted position", async () => {
    withDb({ "draft_selections.select": { count: 4 } });
    const { recordDraftSelection } = await import("./admin-write.functions");
    await callServerFn(recordDraftSelection, {
      data: { eventId: EVENT_ID, participantId: PARTICIPANT_ID, draftPosition: 3 },
      headers: asAdmin(),
    });
    expect(mock.callsFor("draft_selections", "insert")[0].payload).toMatchObject({
      selection_order: 5,
      draft_position: 3,
    });
    expect(mock.callsFor("event_participants", "update")[0].payload).toEqual({
      selected_draft_position: 3,
    });
  });

  it("rejects a zero or negative draft position", async () => {
    const { recordDraftSelection } = await import("./admin-write.functions");
    await expect(
      callServerFn(recordDraftSelection, {
        data: { eventId: EVENT_ID, participantId: PARTICIPANT_ID, draftPosition: 0 },
        headers: asAdmin(),
      }),
    ).rejects.toThrow();
  });

  it("undo removes the last pick and clears the player's position", async () => {
    withDb({
      "draft_selections.select": {
        data: { id: "sel-1", participant_id: PARTICIPANT_ID, selection_order: 5 },
      },
    });
    const { undoLastDraftSelection } = await import("./admin-write.functions");
    await callServerFn(undoLastDraftSelection, {
      data: { eventId: EVENT_ID },
      headers: asAdmin(),
    });
    expect(mock.callsFor("draft_selections", "delete")).toHaveLength(1);
    expect(mock.callsFor("event_participants", "update")[0].payload).toEqual({
      selected_draft_position: null,
    });
  });

  it("undo on an empty draft changes nothing", async () => {
    withDb({ "draft_selections.select": { data: null } });
    const { undoLastDraftSelection } = await import("./admin-write.functions");
    expect(
      await callServerFn(undoLastDraftSelection, {
        data: { eventId: EVENT_ID },
        headers: asAdmin(),
      }),
    ).toEqual({ ok: true });
    expect(mock.callsFor("draft_selections", "delete")).toHaveLength(0);
    expect(mock.callsFor("event_participants", "update")).toHaveLength(0);
  });
});

describe("setRunningOrder", () => {
  it("writes one update per row", async () => {
    const { setRunningOrder } = await import("./admin-write.functions");
    await callServerFn(setRunningOrder, {
      data: {
        eventId: EVENT_ID,
        order: [
          { id: EVENT_PARTICIPANT_ID, running_order: 2 },
          { id: STATION_ID, running_order: 1 },
        ],
      },
      headers: asAdmin(),
    });
    expect(mock.callsFor("event_participants", "update")).toHaveLength(2);
  });

  it("accepts an empty reorder", async () => {
    const { setRunningOrder } = await import("./admin-write.functions");
    await expect(
      callServerFn(setRunningOrder, {
        data: { eventId: EVENT_ID, order: [] },
        headers: asAdmin(),
      }),
    ).resolves.toEqual({ ok: true });
  });

  it("rejects when any update fails", async () => {
    withDb({
      "event_participants.update": [
        { data: null, error: null },
        { data: null, error: { message: "connection lost" } },
      ],
    });
    const { setRunningOrder } = await import("./admin-write.functions");
    await expect(
      callServerFn(setRunningOrder, {
        data: {
          eventId: EVENT_ID,
          order: [
            { id: EVENT_PARTICIPANT_ID, running_order: 2 },
            { id: STATION_ID, running_order: 1 },
          ],
        },
        headers: asAdmin(),
      }),
    ).rejects.toThrow("Failed to update running order");
  });
});

describe("updateEvent", () => {
  it("does not write eventId into the row it updates", async () => {
    const { updateEvent } = await import("./admin-write.functions");
    await callServerFn(updateEvent, {
      data: { eventId: EVENT_ID, results_locked: true, draft_locked: false },
      headers: asAdmin(),
    });
    const [update] = mock.callsFor("events", "update");
    expect(update.payload).toEqual({ results_locked: true, draft_locked: false });
    expect(mock.eqValue(update, "id")).toBe(EVENT_ID);
  });

  it("leaves unmentioned flags alone", async () => {
    const { updateEvent } = await import("./admin-write.functions");
    await callServerFn(updateEvent, {
      data: { eventId: EVENT_ID, status: "live" },
      headers: asAdmin(),
    });
    expect(mock.callsFor("events", "update")[0].payload).toEqual({ status: "live" });
  });
});
