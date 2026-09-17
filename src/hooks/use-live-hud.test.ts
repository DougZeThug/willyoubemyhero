// Gathers what /live needs to know about the commissioner's console before it
// renders: whether this device is the commissioner's, and whether a run is
// being timed on it. Spectators must come out of here with nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { ACTIVE_RUN_VERSION, type ActiveRun } from "@/lib/active-run";
import { useLiveHud } from "./use-live-hud";

const EVENT_ID = "event-1";
const START = Date.parse("2026-07-28T12:00:00.000Z");

const adminSession = vi.fn();
const runConsole = vi.fn();

vi.mock("@/lib/admin-token", () => ({ useAdminSession: () => adminSession() }));
vi.mock("@/hooks/use-run-console", () => ({ useRunConsole: () => runConsole() }));

function makeRun(over: Partial<ActiveRun> = {}): ActiveRun {
  return {
    v: ACTIVE_RUN_VERSION,
    clientKey: "ck-run",
    eventId: EVENT_ID,
    participantId: "participant-1",
    startedAtIso: "2026-07-28T12:00:00.000Z",
    startedAt: START,
    status: "running",
    pauses: [],
    splits: [],
    penalties: [],
    ...over,
  };
}

const CURRENT_EP = { id: "ep-1", participant_id: "participant-1" };

/** The console as /live reads it — only `run` and `currentEp` are ever touched. */
function withRun(run: ActiveRun | null) {
  return { run, currentEp: run ? CURRENT_EP : null };
}

beforeEach(() => {
  adminSession.mockReturnValue(null);
  runConsole.mockReturnValue(withRun(null));
  vi.spyOn(Date, "now").mockReturnValue(START + 5_000);
});

afterEach(() => {
  vi.restoreAllMocks();
  adminSession.mockReset();
  runConsole.mockReset();
});

describe("useLiveHud", () => {
  it("gives a spectator nothing at all", () => {
    runConsole.mockReturnValue(withRun(makeRun()));
    const { result } = renderHook(() => useLiveHud(EVENT_ID));
    // A run in IndexedDB is not this device's business without the token that
    // says so — /live is the public screen behind the QR code.
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.adminRun).toBeNull();
    expect(result.current.runBaseMs).toBeNull();
    expect(result.current.timedEp).toBeNull();
  });

  it("does not take a token for one event as authority over another", () => {
    adminSession.mockReturnValue({ eventId: "some-other-event" });
    runConsole.mockReturnValue(withRun(makeRun()));
    const { result } = renderHook(() => useLiveHud(EVENT_ID));
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.adminRun).toBeNull();
  });

  it("is nobody's console before the event has loaded", () => {
    adminSession.mockReturnValue({ eventId: EVENT_ID });
    runConsole.mockReturnValue(withRun(makeRun()));
    const { result } = renderHook(() => useLiveHud(null));
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.adminRun).toBeNull();
  });

  it("hands the commissioner the run they are timing", () => {
    adminSession.mockReturnValue({ eventId: EVENT_ID });
    const run = makeRun();
    runConsole.mockReturnValue(withRun(run));
    const { result } = renderHook(() => useLiveHud(EVENT_ID));
    expect(result.current.isAdmin).toBe(true);
    expect(result.current.adminRun).toBe(run);
    expect(result.current.runBaseMs).toBe(5_000);
    expect(result.current.timedEp).toBe(CURRENT_EP);
  });

  it("keeps the controls but drops the run once it has finished", () => {
    // A finished run is waiting for its result to be saved, not being timed, so
    // the big ring goes back to the crowd's clock instead of freezing on the
    // last athlete's time. The commissioner still needs the bar to save it.
    adminSession.mockReturnValue({ eventId: EVENT_ID });
    runConsole.mockReturnValue(withRun(makeRun({ status: "finished", finishedAt: START + 3_000 })));
    const { result } = renderHook(() => useLiveHud(EVENT_ID));
    expect(result.current.isAdmin).toBe(true);
    expect(result.current.adminRun).toBeNull();
    expect(result.current.runBaseMs).toBeNull();
    expect(result.current.timedEp).toBeNull();
  });

  it("still reports a paused run as the one being timed", () => {
    adminSession.mockReturnValue({ eventId: EVENT_ID });
    const run = makeRun({
      status: "paused",
      pauses: [{ pausedAt: START + 2_000, resumedAt: null }],
    });
    runConsole.mockReturnValue(withRun(run));
    const { result } = renderHook(() => useLiveHud(EVENT_ID));
    expect(result.current.adminRun).toBe(run);
    expect(result.current.runBaseMs).toBe(2_000);
  });
});
