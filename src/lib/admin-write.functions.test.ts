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

/**
 * The row lookups the handlers make to prove a payload id belongs to the
 * authorized event. Present by default so each test can say what it is about;
 * a test that wants the foreign-row path overrides them with `{ data: null }`
 * or `{ data: [] }`.
 */
const IN_EVENT: SupabaseResponses = {
  // Two different reads land on this key: setParticipantStatus asks for one row
  // with `.maybeSingle()`, setRunningOrder asks which of a list belong to the
  // event with `.in("id", …)`. The list form echoes back whatever it was asked
  // about, so a reorder naming this event's rows passes.
  "event_participants.select": (call) =>
    call.terminal === "maybeSingle"
      ? { data: { participation_status: "queued" } }
      : {
          data: ((call.filters.find((f) => f.method === "in")?.args[1] as string[]) ?? []).map(
            (id) => ({ id }),
          ),
        },
  "event_participants.update": { data: [{ id: EVENT_PARTICIPANT_ID }] },
  "event_participants.delete": { data: [{ id: EVENT_PARTICIPANT_ID }] },
  "stations.update": { data: [{ id: STATION_ID }] },
  "stations.delete": { data: [{ id: STATION_ID }] },
  "runs.delete": { data: [{ id: RUN_ID }] },
};

function withDb(responses: SupabaseResponses = {}) {
  mock = createSupabaseMock({ ...IN_EVENT, ...responses });
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
  addPlayerToRoster: { eventId: EVENT_ID, name: "Doug" },
  upsertStation: {
    eventId: EVENT_ID,
    name: "Sled Push",
    station_order: 1,
    split_enabled: true,
    penalty_amount_ms: 5_000,
    active: true,
  },
  swapStationOrder: { eventId: EVENT_ID, aId: STATION_ID, bId: RUN_ID },
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
  // Both halves live in one Postgres statement now: numbering, the selection row
  // and the roster stamp. A stamp that failed after the insert used to leave a
  // square reading Open that UNIQUE(event_id, draft_position) refused forever,
  // and selection_order was count + 1 with no constraint behind it.
  it("takes the pick in one statement", async () => {
    withDb({ "rpc.record_draft_selection": { data: 5 } });
    const { recordDraftSelection } = await import("./admin-write.functions");
    const res = await callServerFn(recordDraftSelection, {
      data: { eventId: EVENT_ID, participantId: PARTICIPANT_ID, draftPosition: 3 },
      headers: asAdmin(),
    });
    expect(res).toEqual({ ok: true, selectionOrder: 5 });
    expect(mock.rpcCalls("record_draft_selection")[0]).toEqual({
      _event_id: EVENT_ID,
      _participant_id: PARTICIPANT_ID,
      _draft_position: 3,
    });
    expect(mock.callsFor("draft_selections", "insert")).toHaveLength(0);
  });

  it("surfaces a refused pick rather than reporting one", async () => {
    withDb({
      "rpc.record_draft_selection": { error: { message: "That athlete is not on this roster" } },
    });
    const { recordDraftSelection } = await import("./admin-write.functions");
    await expect(
      callServerFn(recordDraftSelection, {
        data: { eventId: EVENT_ID, participantId: PARTICIPANT_ID, draftPosition: 3 },
        headers: asAdmin(),
      }),
    ).rejects.toThrow("not on this roster");
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

  it("undo names the pick it gave back", async () => {
    withDb({ "rpc.undo_last_draft_selection": { data: PARTICIPANT_ID } });
    const { undoLastDraftSelection } = await import("./admin-write.functions");
    expect(
      await callServerFn(undoLastDraftSelection, {
        data: { eventId: EVENT_ID },
        headers: asAdmin(),
      }),
    ).toEqual({ ok: true, participantId: PARTICIPANT_ID });
  });

  it("undo on an empty draft says so instead of claiming a success", async () => {
    // This used to return ok, so the screen said "Undid last pick" over a draft
    // nobody had started.
    withDb({ "rpc.undo_last_draft_selection": { data: null } });
    const { undoLastDraftSelection } = await import("./admin-write.functions");
    expect(
      await callServerFn(undoLastDraftSelection, {
        data: { eventId: EVENT_ID },
        headers: asAdmin(),
      }),
    ).toEqual({ ok: false, reason: "nothing-to-undo" });
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
      data: { eventId: EVENT_ID, results_locked: true, splits_enabled: false },
      headers: asAdmin(),
    });
    const [update] = mock.callsFor("events", "update");
    expect(update.payload).toEqual({ results_locked: true, splits_enabled: false });
    expect(mock.eqValue(update, "id")).toBe(EVENT_ID);
  });

  it("refuses the two lock flags nothing could ever set", async () => {
    // draft_locked and running_order_locked were accepted here and written by
    // nothing, and this handler has no caller in the app at all — so a "locked
    // draft" was a capability the league was told about and could not reach.
    const { updateEvent } = await import("./admin-write.functions");
    await callServerFn(updateEvent, {
      data: { eventId: EVENT_ID, draft_locked: true, running_order_locked: true },
      headers: asAdmin(),
    });
    expect(mock.callsFor("events", "update")[0].payload).toEqual({});
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

/**
 * The guard has to be as narrow as the write it protects.
 *
 * Each of these handlers checks the admin token against `data.eventId` and then
 * matched its row by that row's own id, with nothing tying the two together — so
 * an admin session for last year's combine could set a status, reorder the
 * field, rename or delete a station, or delete a run in this year's. Bounded
 * hard by one active event and a shared PIN today, which is exactly why it is
 * worth pinning: the deployment is the only thing holding it shut.
 */
describe("an admin token is only good for its own event", () => {
  it("scopes every roster and station write to the authorized event", async () => {
    const {
      setParticipantStatus,
      removeParticipantFromEvent,
      upsertStation,
      deleteStation,
      deleteRun,
    } = await import("./admin-write.functions");

    await callServerFn(setParticipantStatus, {
      data: { eventId: EVENT_ID, eventParticipantId: EVENT_PARTICIPANT_ID, status: "finished" },
      headers: asAdmin(),
    });
    expect(mock.eqValue(mock.callsFor("event_participants", "update")[0], "event_id")).toBe(
      EVENT_ID,
    );

    withDb({ "card_copies.select": { count: 0 }, "card_pulls.select": { count: 0 } });
    await callServerFn(removeParticipantFromEvent, {
      data: { eventId: EVENT_ID, eventParticipantId: EVENT_PARTICIPANT_ID },
      headers: asAdmin(),
    });
    expect(mock.eqValue(mock.callsFor("event_participants", "delete")[0], "event_id")).toBe(
      EVENT_ID,
    );

    withDb();
    await callServerFn(upsertStation, {
      data: { ...VALID_PAYLOADS.upsertStation, id: STATION_ID },
      headers: asAdmin(),
    });
    expect(mock.eqValue(mock.callsFor("stations", "update")[0], "event_id")).toBe(EVENT_ID);

    withDb({ "splits.select": { count: 0 }, "penalties.select": { count: 0 } });
    await callServerFn(deleteStation, {
      data: { eventId: EVENT_ID, id: STATION_ID },
      headers: asAdmin(),
    });
    expect(mock.eqValue(mock.callsFor("stations", "delete")[0], "event_id")).toBe(EVENT_ID);

    withDb();
    await callServerFn(deleteRun, {
      data: { eventId: EVENT_ID, runId: RUN_ID },
      headers: asAdmin(),
    });
    expect(mock.eqValue(mock.callsFor("runs", "delete")[0], "event_id")).toBe(EVENT_ID);
  });

  it("refuses a status change for somebody outside the event", async () => {
    withDb({ "event_participants.select": { data: null } });
    const { setParticipantStatus } = await import("./admin-write.functions");
    await expect(
      callServerFn(setParticipantStatus, {
        data: { eventId: EVENT_ID, eventParticipantId: EVENT_PARTICIPANT_ID, status: "finished" },
        headers: asAdmin(),
      }),
    ).rejects.toThrow("not part of this event");
    expect(mock.callsFor("event_participants", "update")).toHaveLength(0);
  });

  // The filter alone would affect nothing and return ok, which is the same shrug
  // as no guard at all — so these writes ask for their rows back.
  it("refuses to delete a station belonging to another event", async () => {
    withDb({
      "splits.select": { count: 0 },
      "penalties.select": { count: 0 },
      "stations.delete": { data: [] },
    });
    const { deleteStation } = await import("./admin-write.functions");
    await expect(
      callServerFn(deleteStation, {
        data: { eventId: EVENT_ID, id: STATION_ID },
        headers: asAdmin(),
      }),
    ).rejects.toThrow("not part of this event");
  });

  it("refuses to delete a run belonging to another event", async () => {
    withDb({ "runs.delete": { data: [] } });
    const { deleteRun } = await import("./admin-write.functions");
    await expect(
      callServerFn(deleteRun, { data: { eventId: EVENT_ID, runId: RUN_ID }, headers: asAdmin() }),
    ).rejects.toThrow("not part of this event");
  });

  it("refuses a reorder that names anybody outside the event", async () => {
    withDb({ "event_participants.select": { data: [] } });
    const { setRunningOrder } = await import("./admin-write.functions");
    await expect(
      callServerFn(setRunningOrder, {
        data: { eventId: EVENT_ID, order: [{ id: EVENT_PARTICIPANT_ID, running_order: 1 }] },
        headers: asAdmin(),
      }),
    ).rejects.toThrow("outside this event");
    expect(mock.callsFor("event_participants", "update")).toHaveLength(0);
  });
});

/**
 * Deleting a station cascades to every split recorded at it, and a station crown
 * is computed from splits — so this delete can silently demote somebody's
 * stationKing card to base. The stations panel refuses it too; a check that
 * lives only in a screen is not a check.
 */
describe("deleteStation refuses a station that has been run", () => {
  it.each([
    ["splits", { "splits.select": { count: 2 }, "penalties.select": { count: 0 } }],
    ["penalties", { "splits.select": { count: 0 }, "penalties.select": { count: 1 } }],
  ])("refuses when it has %s", async (_label, responses) => {
    withDb(responses);
    const { deleteStation } = await import("./admin-write.functions");
    await expect(
      callServerFn(deleteStation, {
        data: { eventId: EVENT_ID, id: STATION_ID },
        headers: asAdmin(),
      }),
    ).rejects.toThrow("already has recorded times");
    expect(mock.callsFor("stations", "delete")).toHaveLength(0);
  });

  it("deletes a station nobody ever ran", async () => {
    withDb({ "splits.select": { count: 0 }, "penalties.select": { count: 0 } });
    const { deleteStation } = await import("./admin-write.functions");
    await expect(
      callServerFn(deleteStation, {
        data: { eventId: EVENT_ID, id: STATION_ID },
        headers: asAdmin(),
      }),
    ).resolves.toEqual({ ok: true });
  });
});

describe("addPlayerToRoster", () => {
  it("reuses the person the league already knows rather than making a second", async () => {
    // Two writes from the screen with nothing tying them together meant a
    // failure between them left somebody created and off the roster — and
    // retyping the name created a duplicate, in a league of thirteen.
    withDb({
      "participants.select": { data: { id: PARTICIPANT_ID, nickname: "Dougie" } },
      "event_participants.select": { data: null },
    });
    const { addPlayerToRoster } = await import("./admin-write.functions");
    const res = await callServerFn(addPlayerToRoster, {
      data: { eventId: EVENT_ID, name: "doug" },
      headers: asAdmin(),
    });
    expect(res).toMatchObject({ participantId: PARTICIPANT_ID, created: false });
    expect(mock.callsFor("participants", "insert")).toHaveLength(0);
    const [insert] = mock.callsFor("event_participants", "insert");
    expect(insert.payload).toMatchObject({
      event_id: EVENT_ID,
      participant_id: PARTICIPANT_ID,
      running_order: 1,
    });
  });

  it("creates the person when the league has never heard of them", async () => {
    withDb({
      "participants.select": { data: null },
      "participants.insert": { data: { id: PARTICIPANT_ID } },
      "event_participants.select": { data: null },
    });
    const { addPlayerToRoster } = await import("./admin-write.functions");
    const res = await callServerFn(addPlayerToRoster, {
      data: { eventId: EVENT_ID, name: "Alice", nickname: "Al" },
      headers: asAdmin(),
    });
    expect(res).toMatchObject({ created: true, alreadyOnRoster: false });
    expect(mock.callsFor("participants", "insert")[0].payload).toEqual({
      name: "Alice",
      nickname: "Al",
    });
  });

  it("treats a name with LIKE metacharacters as literal text", async () => {
    // ilike is a PATTERN match: `_` and `%` are wildcards, so adding "AJ_"
    // would match an existing "AJX" and put that unrelated person on the roster
    // instead of creating the one that was asked for.
    withDb({
      "participants.select": { data: null },
      "participants.insert": { data: { id: PARTICIPANT_ID } },
      "event_participants.select": { data: null },
    });
    const { addPlayerToRoster } = await import("./admin-write.functions");
    await callServerFn(addPlayerToRoster, {
      data: { eventId: EVENT_ID, name: "AJ_%\\x" },
      headers: asAdmin(),
    });
    const [lookup] = mock.callsFor("participants", "select");
    expect(lookup.filters.find((f) => f.method === "ilike")?.args).toEqual([
      "name",
      "AJ\\_\\%\\\\x",
    ]);
  });

  it("is a no-op for somebody already on this roster", async () => {
    // The double tap on a phone, which used to add a second roster row.
    withDb({
      "participants.select": { data: { id: PARTICIPANT_ID, nickname: null } },
      "event_participants.select": { data: { id: EVENT_PARTICIPANT_ID } },
    });
    const { addPlayerToRoster } = await import("./admin-write.functions");
    const res = await callServerFn(addPlayerToRoster, {
      data: { eventId: EVENT_ID, name: "Doug" },
      headers: asAdmin(),
    });
    expect(res).toMatchObject({ alreadyOnRoster: true });
    expect(mock.callsFor("event_participants", "insert")).toHaveLength(0);
  });
});
