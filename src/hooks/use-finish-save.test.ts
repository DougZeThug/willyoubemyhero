// Saving a finished run. The property that matters most is that a retry sends
// the same time as the first attempt: the server upserts on client_key, so a
// second attempt carrying a recomputed clock would silently rewrite somebody's
// official time.
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVE_RUN_VERSION, type ActiveRun } from "@/lib/active-run";
import type { FinishedRun } from "./use-finish-save";

const saveCompletedRun = vi.fn();

vi.mock("@/lib/admin-write.functions", () => ({
  saveCompletedRun: (...args: unknown[]) => saveCompletedRun(...args),
}));

// useServerFn only exists to bind a server function to the router; in a test the
// function itself is already callable.
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

const EVENT_ID = "event-1";
const START = Date.parse("2026-07-28T12:00:00.000Z");

function makeFinished(over: Partial<FinishedRun> = {}): FinishedRun {
  return {
    v: ACTIVE_RUN_VERSION,
    clientKey: "ck-run",
    eventId: EVENT_ID,
    participantId: "participant-1",
    startedAtIso: "2026-07-28T12:00:00.000Z",
    startedAt: START,
    status: "finished" as const,
    finishedAt: START + 45_000,
    finishedAtIso: "2026-07-28T12:00:45.000Z",
    pauses: [],
    splits: [],
    penalties: [],
    ...over,
  };
}

function makeRunning(over: Partial<ActiveRun> = {}): ActiveRun {
  const { finishedAt: _a, finishedAtIso: _b, ...rest } = makeFinished();
  return { ...rest, status: "running", ...over };
}

beforeEach(() => {
  saveCompletedRun.mockReset().mockResolvedValue({ runId: "run-1" });
});

describe("buildFinishPayload", () => {
  it("takes the recorded time from the run, not from the clock", async () => {
    const { buildFinishPayload } = await import("./use-finish-save");
    const run = makeFinished();
    const first = buildFinishPayload(run);
    vi.setSystemTime(new Date(START + 10 * 60_000));
    const later = buildFinishPayload(run);
    vi.useRealTimers();
    expect(later).toEqual(first);
    expect(first.raw_time_ms).toBe(45_000);
    expect(first.finished_at).toBe("2026-07-28T12:00:45.000Z");
    expect(first.eventId).toBe(EVENT_ID);
  });

  it("subtracts paused time and reports it separately", async () => {
    const { buildFinishPayload } = await import("./use-finish-save");
    const payload = buildFinishPayload(
      makeFinished({ pauses: [{ pausedAt: START + 10_000, resumedAt: START + 20_000 }] }),
    );
    expect(payload.raw_time_ms).toBe(35_000);
    expect(payload.paused_duration_ms).toBe(10_000);
  });

  it("carries every split and penalty with its own idempotency key", async () => {
    const { buildFinishPayload } = await import("./use-finish-save");
    const payload = buildFinishPayload(
      makeFinished({
        splits: [
          {
            clientKey: "ck-split",
            stationId: "st-1",
            cumulative_time_ms: 20_000,
            segment_time_ms: 20_000,
            recorded_at: "2026-07-28T12:00:20.000Z",
          },
        ],
        penalties: [{ clientKey: "ck-pen", stationId: "st-1", penalty_ms: 5_000, reason: "Cone" }],
      }),
    );
    expect(payload.splits).toEqual([
      {
        stationId: "st-1",
        cumulative_time_ms: 20_000,
        segment_time_ms: 20_000,
        clientKey: "ck-split",
        recorded_at: "2026-07-28T12:00:20.000Z",
      },
    ]);
    expect(payload.penalties).toEqual([
      { stationId: "st-1", penalty_ms: 5_000, reason: "Cone", clientKey: "ck-pen" },
    ]);
  });
});

describe("asFinishedRun", () => {
  it("accepts a stopped run and refuses everything else", async () => {
    const { asFinishedRun } = await import("./use-finish-save");
    const run = makeFinished();
    expect(asFinishedRun(run)).toBe(run);
    expect(asFinishedRun(null)).toBeNull();
    expect(asFinishedRun({ ...run, status: "running" })).toBeNull();
    // Without a finish anchor there is no time to re-send, so there is nothing
    // safe to retry — the console offers Discard only.
    expect(asFinishedRun({ ...run, finishedAt: undefined })).toBeNull();
    expect(asFinishedRun({ ...run, finishedAtIso: undefined })).toBeNull();
  });
});

describe("useFinishSave", () => {
  async function setup(onSaved = vi.fn()) {
    const onDraft = vi.fn();
    const { useFinishSave } = await import("./use-finish-save");
    const view = renderHook(() => useFinishSave({ onDraft, onSaved }));
    return { ...view, onSaved, onDraft };
  }

  it("walks idle → saving → idle and reports the run saved", async () => {
    let release!: (v: unknown) => void;
    saveCompletedRun.mockReturnValue(new Promise((r) => (release = r)));
    const { result, onSaved } = await setup();

    expect(result.current.state).toBe("idle");
    let done!: Promise<void>;
    act(() => {
      done = result.current.retry(makeFinished());
    });
    await waitFor(() => expect(result.current.state).toBe("saving"));
    await act(async () => {
      release({ runId: "run-1" });
      await done;
    });
    expect(result.current.state).toBe("idle");
    expect(result.current.error).toBeNull();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("keeps the run and surfaces the reason when the save throws", async () => {
    saveCompletedRun.mockRejectedValue(new Error("Admin PIN required"));
    const { result, onSaved } = await setup();

    await act(async () => {
      await result.current.retry(makeFinished());
    });
    expect(result.current.state).toBe("failed");
    expect(result.current.error).toBe("Admin PIN required");
    // The console clears local storage from onSaved, so it must not fire: this
    // is the only copy of the run left.
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("retries with a payload identical to the failed attempt", async () => {
    saveCompletedRun.mockRejectedValueOnce(new Error("offline"));
    const { result } = await setup();
    const run = makeFinished();

    await act(async () => {
      await result.current.retry(run);
    });
    expect(result.current.state).toBe("failed");

    saveCompletedRun.mockResolvedValueOnce({ runId: "run-1" });
    await act(async () => {
      await result.current.retry(run);
    });
    expect(result.current.state).toBe("idle");
    expect(saveCompletedRun).toHaveBeenCalledTimes(2);
    expect(saveCompletedRun.mock.calls[1][0]).toEqual(saveCompletedRun.mock.calls[0][0]);
  });

  it("ignores a second tap while a save is in flight", async () => {
    let release!: (v: unknown) => void;
    saveCompletedRun.mockReturnValue(new Promise((r) => (release = r)));
    const { result } = await setup();
    const run = makeFinished();

    let first!: Promise<void>;
    act(() => {
      first = result.current.retry(run);
    });
    await act(async () => {
      await result.current.retry(run);
    });
    expect(saveCompletedRun).toHaveBeenCalledTimes(1);
    await act(async () => {
      release({ runId: "run-1" });
      await first;
    });
  });

  it("stops the clock once, however many times Finish is tapped", async () => {
    // The bug this guards: two taps in one tick both hold the pre-finish run,
    // because React state has not committed between them. Each would stamp its
    // own finish time and race the other into the recovery record, and a Retry
    // after a partly written save would then send the loser's time under the
    // winner's client_key — quietly rewriting the official result.
    let release!: (v: unknown) => void;
    saveCompletedRun.mockReturnValue(new Promise((r) => (release = r)));
    const { result, onDraft } = await setup();
    const running = makeRunning();

    let first!: Promise<void>;
    act(() => {
      first = result.current.finish(running);
    });
    await act(async () => {
      await result.current.finish(running);
    });

    // onDraft is called synchronously, before the record is written to this
    // phone; the request itself waits on that write.
    expect(onDraft).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(saveCompletedRun).toHaveBeenCalledTimes(1));
    await act(async () => {
      release({ runId: "run-1" });
      await first;
    });
  });

  it("refuses to finish a run that has already stopped", async () => {
    const { result, onDraft } = await setup();
    await act(async () => {
      await result.current.finish(makeFinished());
    });
    expect(onDraft).not.toHaveBeenCalled();
    expect(saveCompletedRun).not.toHaveBeenCalled();
  });

  it("hands the console the stopped record before the network sees it", async () => {
    // The console persists what it is given, so a save that throws still leaves
    // the run on the phone.
    saveCompletedRun.mockRejectedValue(new Error("offline"));
    const { result, onDraft } = await setup();
    await act(async () => {
      await result.current.finish(makeRunning());
    });
    const draft = onDraft.mock.calls[0][0];
    expect(draft.status).toBe("finished");
    expect(draft.finishedAt).toBeTypeOf("number");
    expect(Date.parse(draft.finishedAtIso)).toBe(draft.finishedAt);
    expect(result.current.state).toBe("failed");
  });

  it("retries a failed finish with the time it was given, not a fresh one", async () => {
    saveCompletedRun.mockRejectedValueOnce(new Error("offline"));
    const { result, onDraft } = await setup();
    await act(async () => {
      await result.current.finish(makeRunning());
    });
    expect(result.current.state).toBe("failed");

    saveCompletedRun.mockResolvedValueOnce({ runId: "run-1" });
    await act(async () => {
      await result.current.retry(onDraft.mock.calls[0][0]);
    });
    expect(saveCompletedRun.mock.calls[1][0]).toEqual(saveCompletedRun.mock.calls[0][0]);
  });

  it("saves against the event the run was actually run at", async () => {
    // A recovered run outlives the page that produced it. Taking the event from
    // whatever happens to be active when Retry is tapped would file an archived
    // event's time against the new one, and would disable recovery outright in
    // the window where no event is active at all.
    const { result } = await setup();
    await act(async () => {
      await result.current.retry(makeFinished({ eventId: "event-from-last-year" }));
    });
    expect(saveCompletedRun.mock.calls[0][0].data.eventId).toBe("event-from-last-year");
  });

  it("reports the run saved even if the caller's cleanup throws", async () => {
    // The row is written by that point; calling it unsaved would invite a retry
    // for a run that is already in the league.
    const onSaved = vi.fn().mockRejectedValue(new Error("IndexedDB is gone"));
    const { result } = await setup(onSaved);
    await act(async () => {
      await result.current.retry(makeFinished()).catch(() => {});
    });
    expect(result.current.state).toBe("idle");
  });

  it("clears a failure on reset", async () => {
    saveCompletedRun.mockRejectedValue(new Error("offline"));
    const { result } = await setup();
    await act(async () => {
      await result.current.retry(makeFinished());
    });
    expect(result.current.state).toBe("failed");
    act(() => result.current.reset());
    expect(result.current.state).toBe("idle");
    expect(result.current.error).toBeNull();
  });
});
