// What happens when a save is still out and the commissioner moves on.
//
// Separate from use-run-console.test.tsx on purpose: that file mocks
// useFinishSave away entirely — `state` is a hardcoded "idle" and finish/reset
// are bare vi.fn()s — so it structurally cannot see anything about a save that
// is still in flight. Here the real hook runs against the real IndexedDB
// record, and only the network call is stubbed, because the whole defect lives
// in the seam between the two.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "@/test/query";
import { makeBundle, makeParticipant, resetFixtureIds, uuid } from "@/test/fixtures";

const saveCompletedRun = vi.hoisted(() => vi.fn());
const setParticipantStatus = vi.hoisted(() => vi.fn());
const resetParticipantRuns = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-write.functions", () => ({
  saveCompletedRun: (...args: unknown[]) => saveCompletedRun(...args),
  setParticipantStatus: (...args: unknown[]) => setParticipantStatus(...args),
  resetParticipantRuns: (...args: unknown[]) => resetParticipantRuns(...args),
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));

const toastError = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError, success: toastSuccess } }));

const useEventBundle = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-event-bundle", () => ({ useEventBundle }));

const EVENT_ID = "00000000-0000-4000-8000-0000000000ff";

/** A deferred stand-in for the save request, released by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("cancelling a run while its save is still out", () => {
  /**
   * A fresh module graph per test.
   *
   * active-run caches the opened database in a module-level promise, so the
   * registry has to be reset and the factory swapped underneath it — the same
   * dance active-run.test.ts does. Everything downstream of that (the console,
   * the finish hook) has to be re-imported after the reset or it closes over
   * the old database.
   */
  async function freshConsole(participants: ReturnType<typeof makeParticipant>[]) {
    vi.resetModules();
    const { resetIndexedDB } = await import("@/test/idb");
    resetIndexedDB();
    const activeRun = await import("@/lib/active-run");
    const { useRunConsole } = await import("./use-run-console");

    useEventBundle.mockReturnValue({
      event: { id: EVENT_ID, name: "Draft Combine", year: 2026, active: true },
      bundle: makeBundle({ participants, stations: [] }),
      loading: false,
      error: null,
      failedTables: [],
      realtimeDegraded: false,
      refetch: vi.fn(),
    });

    const { wrapper } = createQueryWrapper();
    return { ...renderHook(() => useRunConsole(), { wrapper }), activeRun };
  }

  function athlete(name: string) {
    return makeParticipant({
      participation_status: "waiting",
      participant: { id: uuid(), name, nickname: null },
    });
  }

  beforeEach(() => {
    resetFixtureIds();
    saveCompletedRun.mockReset().mockResolvedValue({ runId: "run-1" });
    setParticipantStatus.mockReset().mockResolvedValue({ ok: true });
    resetParticipantRuns.mockReset().mockResolvedValue({ clearedRuns: 1 });
    toastError.mockReset();
    toastSuccess.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not let the abandoned save wipe the athlete who replaced them", async () => {
    // The whole bug: reset() cleared the visible state but left the request
    // running, and when it came back it called onSaved — which clears the
    // ACTIVE run. The timer for the athlete now on the course vanished
    // mid-count, under a "Run saved" toast belonging to somebody else.
    const alice = athlete("Alice");
    const bob = athlete("Bob");
    const save = deferred<{ runId: string }>();
    saveCompletedRun.mockReturnValue(save.promise);

    const { result, activeRun } = await freshConsole([alice, bob]);

    await act(async () => {
      await result.current.startRun(alice.participant_id);
    });
    // Not awaited: the request is deliberately still out, which is the point.
    let saving!: Promise<void>;
    act(() => {
      saving = result.current.finishRun();
    });
    await waitFor(() => expect(saveCompletedRun).toHaveBeenCalledTimes(1));

    // Reset timer, then straight on to the next athlete.
    await act(async () => {
      await result.current.cancelRun();
    });
    await act(async () => {
      await result.current.startRun(bob.participant_id);
    });
    expect(result.current.run?.participantId).toBe(bob.participant_id);

    await act(async () => {
      save.resolve({ runId: "run-1" });
      await saving;
    });

    expect(result.current.run?.participantId).toBe(bob.participant_id);
    expect(await activeRun.loadActiveRun()).toMatchObject({
      participantId: bob.participant_id,
    });
    expect(toastSuccess).not.toHaveBeenCalledWith("Run saved");
  });

  it("lets the next athlete's Finish reach the server", async () => {
    // The second symptom, and the one visible before any data is lost: reset()
    // left the in-flight latch set, so Finish on the new run was an enabled
    // button that early-returned and did nothing.
    const alice = athlete("Alice");
    const bob = athlete("Bob");
    const save = deferred<{ runId: string }>();
    saveCompletedRun.mockReturnValue(save.promise);

    const { result } = await freshConsole([alice, bob]);

    await act(async () => {
      await result.current.startRun(alice.participant_id);
    });
    let saving!: Promise<void>;
    act(() => {
      saving = result.current.finishRun();
    });
    await waitFor(() => expect(saveCompletedRun).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.cancelRun();
    });
    saveCompletedRun.mockResolvedValue({ runId: "run-2" });
    await act(async () => {
      await result.current.startRun(bob.participant_id);
    });
    await act(async () => {
      await result.current.finishRun();
    });

    await waitFor(() => expect(saveCompletedRun).toHaveBeenCalledTimes(2));
    expect(saveCompletedRun.mock.calls[1]?.[0]?.data).toMatchObject({
      participantId: bob.participant_id,
    });

    await act(async () => {
      save.resolve({ runId: "run-1" });
      await saving;
    });
  });
});
