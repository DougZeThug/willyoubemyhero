// The one place an admin drives the live timer. The dangerous state is the
// selected participant id: a realtime roster update can remove that athlete
// while the picker still holds their id, and starting a run against a ghost row
// used to crash inside a silent catch and leave an orphaned local timer.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "@/test/query";
import { makeBundle, makeParticipant, resetFixtureIds, uuid } from "@/test/fixtures";

const setParticipantStatus = vi.hoisted(() => vi.fn());
const resetParticipantRuns = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-write.functions", () => ({
  setParticipantStatus: (...args: unknown[]) => setParticipantStatus(...args),
  resetParticipantRuns: (...args: unknown[]) => resetParticipantRuns(...args),
}));

const useServerFn = vi.hoisted(() => vi.fn((fn: unknown) => fn));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn,
}));

const toastError = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { error: toastError, success: toastSuccess },
}));

const loadActiveRun = vi.hoisted(() => vi.fn());
const saveActiveRun = vi.hoisted(() => vi.fn());
const clearActiveRun = vi.hoisted(() => vi.fn());
vi.mock("@/lib/active-run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/active-run")>()),
  loadActiveRun,
  saveActiveRun,
  clearActiveRun,
}));

const newClientKey = vi.hoisted(() => vi.fn(() => "ck-test"));
vi.mock("@/lib/format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/format")>()),
  newClientKey,
}));

const useEventBundle = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-event-bundle", () => ({ useEventBundle }));

const finish = vi.hoisted(() => vi.fn());
const retry = vi.hoisted(() => vi.fn());
const reset = vi.hoisted(() => vi.fn());
const asFinishedRun = vi.hoisted(() => vi.fn(() => null));
vi.mock("@/hooks/use-finish-save", () => ({
  asFinishedRun,
  useFinishSave: () => ({ state: "idle", error: null, finish, retry, reset }),
}));

const EVENT_ID = "00000000-0000-4000-8000-0000000000ff";

function setupBundle(participants: ReturnType<typeof makeParticipant>[]) {
  return {
    event: { id: EVENT_ID, name: "Draft Combine", year: 2026, active: true },
    bundle: makeBundle({ participants, stations: [] }),
    loading: false,
    error: null,
    failedTables: [],
    realtimeDegraded: false,
    refetch: vi.fn(),
  };
}

beforeEach(() => {
  resetFixtureIds();
  setParticipantStatus.mockReset().mockResolvedValue({ ok: true });
  resetParticipantRuns.mockReset().mockResolvedValue({ clearedRuns: 1 });
  loadActiveRun.mockReset().mockResolvedValue(null);
  saveActiveRun.mockReset().mockResolvedValue(undefined);
  clearActiveRun.mockReset().mockResolvedValue(undefined);
  finish.mockReset().mockResolvedValue(undefined);
  retry.mockReset().mockResolvedValue(undefined);
  reset.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
  asFinishedRun.mockReset().mockReturnValue(null);
});

describe("useRunConsole", () => {
  async function mount(participants: ReturnType<typeof makeParticipant>[]) {
    useEventBundle.mockReturnValue(setupBundle(participants));
    const { useRunConsole } = await import("./use-run-console");
    const { wrapper } = createQueryWrapper();
    return renderHook(() => useRunConsole(), { wrapper });
  }

  it("starts a run and tells the server the athlete is running", async () => {
    const alice = makeParticipant({ participant: { id: uuid(), name: "Alice", nickname: null } });
    const { result } = await mount([alice]);

    act(() => result.current.setSelected(alice.participant_id));
    await act(async () => {
      await result.current.startRun();
    });

    expect(result.current.run).not.toBeNull();
    expect(result.current.run?.participantId).toBe(alice.participant_id);
    // startRun saves explicitly, then the run-change effect saves the same record again.
    expect(saveActiveRun).toHaveBeenCalledTimes(2);
    expect(setParticipantStatus).toHaveBeenCalledTimes(1);
    expect(setParticipantStatus).toHaveBeenCalledWith({
      data: { eventId: EVENT_ID, eventParticipantId: alice.id, status: "running" },
    });
  });

  it("starts the athlete it is handed, with nothing picked", async () => {
    // Live's bar never writes its default to the selection — it shows whoever is
    // next and hands that athlete over on the tap. Reading the selection alone
    // meant the common case, one tap on Start, wrote no run at all.
    const alice = makeParticipant({ participant: { id: uuid(), name: "Alice", nickname: null } });
    const { result } = await mount([alice]);

    expect(result.current.selectedParticipantId).toBe("");
    await act(async () => {
      await result.current.startRun(alice.participant_id);
    });

    expect(result.current.run?.participantId).toBe(alice.participant_id);
    expect(setParticipantStatus).toHaveBeenCalledWith({
      data: { eventId: EVENT_ID, eventParticipantId: alice.id, status: "running" },
    });
  });

  it("prefers the athlete it is handed over the one already picked", async () => {
    // The bar passes whatever its picker is showing, which IS the selection once
    // the commissioner has touched it — but if the two ever disagree, the one the
    // person is looking at wins.
    const alice = makeParticipant({ participant: { id: uuid(), name: "Alice", nickname: null } });
    const bob = makeParticipant({ participant: { id: uuid(), name: "Bob", nickname: null } });
    const { result } = await mount([alice, bob]);

    act(() => result.current.setSelected(alice.participant_id));
    await act(async () => {
      await result.current.startRun(bob.participant_id);
    });

    expect(result.current.run?.participantId).toBe(bob.participant_id);
  });

  it("does not crash or call the server when the selected athlete is removed from the roster", async () => {
    const alice = makeParticipant({ participant: { id: uuid(), name: "Alice", nickname: null } });
    const bob = makeParticipant({ participant: { id: uuid(), name: "Bob", nickname: null } });

    const { result, rerender } = await mount([alice, bob]);
    act(() => result.current.setSelected(alice.participant_id));
    expect(result.current.selectedParticipantId).toBe(alice.participant_id);

    // A realtime update removes Alice while the picker still holds her id.
    useEventBundle.mockReturnValue(setupBundle([bob]));
    rerender();

    // The stale selection is dropped automatically, so a subsequent Start Run
    // is a no-op rather than a crash or an orphaned local timer.
    await act(async () => {
      await result.current.startRun();
    });

    expect(result.current.selectedParticipantId).toBe("");
    expect(result.current.run).toBeNull();
    expect(saveActiveRun).not.toHaveBeenCalled();
    expect(setParticipantStatus).not.toHaveBeenCalled();
  });

  it("clears the selected athlete automatically when they disappear from the roster", async () => {
    const alice = makeParticipant({ participant: { id: uuid(), name: "Alice", nickname: null } });
    const bob = makeParticipant({ participant: { id: uuid(), name: "Bob", nickname: null } });

    const { result, rerender } = await mount([alice, bob]);
    act(() => result.current.setSelected(alice.participant_id));
    expect(result.current.selectedParticipantId).toBe(alice.participant_id);

    useEventBundle.mockReturnValue(setupBundle([bob]));
    rerender();

    await waitFor(() => expect(result.current.selectedParticipantId).toBe(""));
  });

  it("refuses to start an athlete who was scratched out from under the selection", async () => {
    // A scratch keeps the roster row, so the effect above never fires and the
    // selection stays pointing at them. Starting writes "running", which
    // un-scratches them and puts them back on the crowd clock — from a button
    // whose own card had already stopped listing them.
    const alice = makeParticipant({ participant: { id: uuid(), name: "Alice", nickname: null } });
    const bob = makeParticipant({ participant: { id: uuid(), name: "Bob", nickname: null } });

    const { result, rerender } = await mount([alice, bob]);
    act(() => result.current.setSelected(alice.participant_id));

    useEventBundle.mockReturnValue(
      setupBundle([{ ...alice, participation_status: "scratched" }, bob]),
    );
    rerender();

    await act(async () => {
      await result.current.startRun();
    });

    expect(toastError).toHaveBeenCalledWith("That athlete is out of the field.");
    expect(result.current.selectedParticipantId).toBe("");
    expect(result.current.run).toBeNull();
    expect(saveActiveRun).not.toHaveBeenCalled();
    expect(setParticipantStatus).not.toHaveBeenCalled();
  });

  it.each(["finished", "dq", "dnp", "absent"])(
    "refuses to start a %s athlete named outright",
    async (status) => {
      // Live's bar passes the athlete explicitly rather than through the
      // selection, so the guard has to sit in startRun itself.
      const alice = makeParticipant({
        participant: { id: uuid(), name: "Alice", nickname: null },
        participation_status: status,
      });
      const { result } = await mount([alice]);

      await act(async () => {
        await result.current.startRun(alice.participant_id);
      });

      expect(setParticipantStatus).not.toHaveBeenCalled();
      expect(result.current.run).toBeNull();
    },
  );

  it("takes the local run back when the server refuses the start", async () => {
    // The client check reads THIS device's last bundle, so another phone
    // scratching the athlete in between gets past it and the server refuses. The
    // timer is already running and saved by then — and a run left standing writes
    // the athlete to "finished" when it is finished, undoing the scratch through
    // a door the server guard does not cover.
    const alice = makeParticipant({ participant: { id: uuid(), name: "Alice", nickname: null } });
    setParticipantStatus.mockRejectedValue(new Error("That athlete is out of the field."));

    const { result } = await mount([alice]);
    act(() => result.current.setSelected(alice.participant_id));
    await act(async () => {
      await result.current.startRun();
    });

    expect(result.current.run).toBeNull();
    expect(clearActiveRun).toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("That athlete is out of the field.");
  });

  it("keeps the local run when the start write only failed on the network", async () => {
    // The other half of the same branch, and the reason it is a branch at all: a
    // commissioner is standing in a garden with somebody already running, and a
    // blip must not take the timer away.
    const alice = makeParticipant({ participant: { id: uuid(), name: "Alice", nickname: null } });
    setParticipantStatus.mockRejectedValue(new Error("Failed to fetch"));

    const { result } = await mount([alice]);
    act(() => result.current.setSelected(alice.participant_id));
    await act(async () => {
      await result.current.startRun();
    });

    expect(result.current.run?.participantId).toBe(alice.participant_id);
    expect(result.current.run?.status).toBe("running");
    expect(clearActiveRun).not.toHaveBeenCalled();
  });

  it("pauses and resumes the active run", async () => {
    const alice = makeParticipant({ participant: { id: uuid(), name: "Alice", nickname: null } });
    const { result } = await mount([alice]);

    act(() => result.current.setSelected(alice.participant_id));
    await act(async () => {
      await result.current.startRun();
    });

    act(() => result.current.togglePause());
    expect(result.current.run?.status).toBe("paused");

    act(() => result.current.togglePause());
    expect(result.current.run?.status).toBe("running");
    expect(result.current.run?.pauses[0].resumedAt).toBeTypeOf("number");
  });

  it("records a split only while the run is running", async () => {
    const station = {
      id: uuid(),
      event_id: EVENT_ID,
      name: "Sled",
      short_name: null,
      station_order: 1,
      active: true,
      split_enabled: true,
      penalty_amount_ms: 0,
    };
    const alice = makeParticipant({ participant: { id: uuid(), name: "Alice", nickname: null } });

    useEventBundle.mockReturnValue({
      ...setupBundle([alice]),
      bundle: makeBundle({ participants: [alice], stations: [station] }),
    });
    const { useRunConsole } = await import("./use-run-console");
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useRunConsole(), { wrapper });

    act(() => result.current.setSelected(alice.participant_id));
    await act(async () => {
      await result.current.startRun();
    });

    act(() => result.current.togglePause());
    act(() => result.current.recordSplit(station.id));
    expect(result.current.run?.splits).toHaveLength(0);

    act(() => result.current.togglePause());
    act(() => result.current.recordSplit(station.id));
    expect(result.current.run?.splits).toHaveLength(1);
    expect(result.current.run?.splits[0].stationId).toBe(station.id);
  });

  it("undoes the last split", async () => {
    const station = {
      id: uuid(),
      event_id: EVENT_ID,
      name: "Sled",
      short_name: null,
      station_order: 1,
      active: true,
      split_enabled: true,
      penalty_amount_ms: 0,
    };
    const alice = makeParticipant({ participant: { id: uuid(), name: "Alice", nickname: null } });

    useEventBundle.mockReturnValue({
      ...setupBundle([alice]),
      bundle: makeBundle({ participants: [alice], stations: [station] }),
    });
    const { useRunConsole } = await import("./use-run-console");
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useRunConsole(), { wrapper });

    act(() => result.current.setSelected(alice.participant_id));
    await act(async () => {
      await result.current.startRun();
    });
    act(() => result.current.recordSplit(station.id));
    expect(result.current.run?.splits).toHaveLength(1);

    act(() => result.current.undoLastSplit());
    expect(result.current.run?.splits).toHaveLength(0);
  });

  it("finishes the active run and clears local storage on save", async () => {
    const alice = makeParticipant({ participant: { id: uuid(), name: "Alice", nickname: null } });
    const { result } = await mount([alice]);

    act(() => result.current.setSelected(alice.participant_id));
    await act(async () => {
      await result.current.startRun();
    });

    finish.mockImplementation(async () => {
      // Simulate useFinishSave calling onSaved after a successful save.
      await clearActiveRun();
    });

    await act(async () => {
      await result.current.finishRun();
    });

    expect(finish).toHaveBeenCalledTimes(1);
    expect(clearActiveRun).toHaveBeenCalled();
  });

  it("cancels the active run and puts the athlete back to waiting", async () => {
    const alice = makeParticipant({ participant: { id: uuid(), name: "Alice", nickname: null } });
    const { result } = await mount([alice]);

    act(() => result.current.setSelected(alice.participant_id));
    await act(async () => {
      await result.current.startRun();
    });

    await act(async () => {
      await result.current.cancelRun();
    });

    expect(result.current.run).toBeNull();
    expect(clearActiveRun).toHaveBeenCalled();
    // "waiting", the schema default and the word players see. This was the only
    // reset in the app that wrote "queued"; both behave identically, and one
    // vocabulary is worth more than the coin-flip.
    expect(setParticipantStatus).toHaveBeenCalledWith({
      data: { eventId: EVENT_ID, eventParticipantId: alice.id, status: "waiting" },
    });
  });

  // Only one athlete is ever on the crowd's clock, and nothing below this hook
  // enforces it: the column has no CHECK and setParticipantStatus writes the one
  // row it is handed. setOnClock has always demoted before promoting; startRun
  // did not, so staging one athlete and starting another left two rows "running"
  // and the spectator screens reading the wrong one.
  it("takes the athlete already on the clock off it before starting somebody else", async () => {
    const alice = makeParticipant({
      participant: { id: uuid(), name: "Alice", nickname: null },
      running_order: 1,
      participation_status: "running",
      on_clock_since: "2026-08-22T00:00:00.000Z",
    });
    const bob = makeParticipant({
      participant: { id: uuid(), name: "Bob", nickname: null },
      running_order: 2,
    });
    const { result } = await mount([alice, bob]);

    act(() => result.current.setSelected(bob.participant_id));
    await act(async () => {
      await result.current.startRun();
    });

    expect(setParticipantStatus).toHaveBeenCalledWith({
      data: { eventId: EVENT_ID, eventParticipantId: alice.id, status: "waiting" },
    });
    expect(setParticipantStatus).toHaveBeenCalledWith({
      data: { eventId: EVENT_ID, eventParticipantId: bob.id, status: "running" },
    });
  });

  // The ordinary path: stage somebody, then start them. Demoting first would
  // clear on_clock_since and re-stamp it at the Start tap, throwing away the
  // moment they stepped up — which is the one thing setParticipantStatus goes
  // out of its way to preserve.
  it("leaves the clock alone when the athlete starting is the one already on it", async () => {
    const alice = makeParticipant({
      participant: { id: uuid(), name: "Alice", nickname: null },
      participation_status: "running",
      on_clock_since: "2026-08-22T00:00:00.000Z",
    });
    const { result } = await mount([alice]);

    act(() => result.current.setSelected(alice.participant_id));
    await act(async () => {
      await result.current.startRun();
    });

    const statuses = setParticipantStatus.mock.calls.map(
      (c: unknown[]) => (c[0] as { data: { status: string } }).data.status,
    );
    expect(statuses).toEqual(["running"]);
  });

  // The start is what the crowd is waiting on. A cleanup write that fails is a
  // stale name on the spectator screens; a start that fails with it is a stopped
  // clock for a run that is genuinely under way.
  it("still starts the run when taking the previous athlete off the clock fails", async () => {
    const alice = makeParticipant({
      participant: { id: uuid(), name: "Alice", nickname: null },
      running_order: 1,
      participation_status: "running",
    });
    const bob = makeParticipant({
      participant: { id: uuid(), name: "Bob", nickname: null },
      running_order: 2,
    });
    setParticipantStatus
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ ok: true });
    const { result } = await mount([alice, bob]);

    act(() => result.current.setSelected(bob.participant_id));
    await act(async () => {
      await result.current.startRun();
    });

    expect(setParticipantStatus).toHaveBeenCalledWith({
      data: { eventId: EVENT_ID, eventParticipantId: bob.id, status: "running" },
    });
    expect(result.current.run?.participantId).toBe(bob.participant_id);
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe("which stations the console offers", () => {
  // "Record a split here" saved faithfully and changed nothing: the panel wrote
  // split_enabled, the console filtered on `active` alone, and the switch was a
  // control that confirmed and lied.
  function station(over: Record<string, unknown>) {
    return {
      id: uuid(),
      event_id: EVENT_ID,
      name: "Sled",
      short_name: null,
      station_order: 1,
      active: true,
      split_enabled: true,
      penalty_amount_ms: 0,
      ...over,
    };
  }

  it("skips a station with split recording switched off", async () => {
    const on = station({ name: "Sled", station_order: 1 });
    const off = station({ name: "Wall", station_order: 2, split_enabled: false });
    const inactive = station({ name: "Rings", station_order: 3, active: false });
    const alice = makeParticipant({ participant: { id: uuid(), name: "Alice", nickname: null } });

    useEventBundle.mockReturnValue({
      ...setupBundle([alice]),
      bundle: makeBundle({ participants: [alice], stations: [on, off, inactive] }),
    });
    const { useRunConsole } = await import("./use-run-console");
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useRunConsole(), { wrapper });

    expect(result.current.stations.map((s) => s.name)).toEqual(["Sled"]);
  });
});
