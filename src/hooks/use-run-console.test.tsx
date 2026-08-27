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
