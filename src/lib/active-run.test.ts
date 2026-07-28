// The in-progress timed run — the most safety-critical client state in the app.
// If this drifts, somebody's combine time is wrong and there is no recovering it
// after the fact.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeElapsedMs, type ActiveRun } from "./active-run";

function makeRun(over: Partial<ActiveRun> = {}): ActiveRun {
  return {
    clientKey: "ck-1",
    eventId: "event-1",
    participantId: "participant-1",
    startedAtIso: "2026-07-28T12:00:00.000Z",
    startedAtPerf: 1_000,
    status: "running",
    pauses: [],
    splits: [],
    penalties: [],
    ...over,
  };
}

describe("computeElapsedMs", () => {
  it("is the raw delta when the run never paused", () => {
    expect(computeElapsedMs(makeRun(), 61_000)).toBe(60_000);
  });

  it("is zero at the moment the clock starts", () => {
    expect(computeElapsedMs(makeRun(), 1_000)).toBe(0);
  });

  it("subtracts a completed pause", () => {
    const run = makeRun({ pauses: [{ pausedAt: 11_000, resumedAt: 21_000 }] });
    expect(computeElapsedMs(run, 61_000)).toBe(50_000);
  });

  it("subtracts several completed pauses", () => {
    const run = makeRun({
      pauses: [
        { pausedAt: 11_000, resumedAt: 16_000 },
        { pausedAt: 21_000, resumedAt: 26_000 },
      ],
    });
    expect(computeElapsedMs(run, 61_000)).toBe(50_000);
  });

  it("subtracts an open pause up to now, so a paused clock stops moving", () => {
    const run = makeRun({ status: "paused", pauses: [{ pausedAt: 31_000, resumedAt: null }] });
    expect(computeElapsedMs(run, 61_000)).toBe(30_000);
    // Ten more seconds of wall clock, still paused, still 30 seconds.
    expect(computeElapsedMs(run, 71_000)).toBe(30_000);
  });

  it("freezes a finished run at its finish time", () => {
    const run = makeRun({ status: "finished", finishedAtPerf: 46_000 });
    expect(computeElapsedMs(run, 46_000)).toBe(45_000);
    // Time keeps passing; the recorded run does not.
    expect(computeElapsedMs(run, 999_000)).toBe(45_000);
  });

  it("subtracts pauses from a finished run too", () => {
    const run = makeRun({
      status: "finished",
      finishedAtPerf: 61_000,
      pauses: [{ pausedAt: 11_000, resumedAt: 21_000 }],
    });
    expect(computeElapsedMs(run, 999_000)).toBe(50_000);
  });

  it("falls back to live timing when a finished run has no finish anchor", () => {
    const run = makeRun({ status: "finished" });
    expect(computeElapsedMs(run, 61_000)).toBe(60_000);
  });

  it("never returns a negative elapsed time", () => {
    // A clock that reads backwards would render as a wildly negative time on
    // the HUD; clamping keeps it at zero instead.
    expect(computeElapsedMs(makeRun(), 0)).toBe(0);
    const overPaused = makeRun({ pauses: [{ pausedAt: 0, resumedAt: 999_000 }] });
    expect(computeElapsedMs(overPaused, 61_000)).toBe(0);
  });

  it("returns whole milliseconds", () => {
    expect(computeElapsedMs(makeRun({ startedAtPerf: 1_000.6 }), 61_000.4)).toBe(59_999);
  });
});

describe("persistence", () => {
  // Each test needs its own module instance: active-run caches the opened
  // database in a module-level promise, and fake-indexeddb is reset per test.
  async function freshModule() {
    vi.resetModules();
    const { resetIndexedDB } = await import("@/test/idb");
    resetIndexedDB();
    return import("./active-run");
  }

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips a run through IndexedDB", async () => {
    const mod = await freshModule();
    const run = makeRun({ splits: [], penalties: [] });
    await mod.saveActiveRun(run);
    expect(await mod.loadActiveRun()).toEqual(run);
  });

  it("also mirrors the run into localStorage", async () => {
    const mod = await freshModule();
    const run = makeRun();
    await mod.saveActiveRun(run);
    expect(JSON.parse(window.localStorage.getItem("wwbh-active-run")!)).toEqual(run);
  });

  it("falls back to the localStorage copy when IndexedDB is unavailable", async () => {
    // A phone in private mode can lose IndexedDB mid-combine. The run has to
    // survive that; it is the only copy of a time that was actually run.
    const run = makeRun({ status: "paused" });
    window.localStorage.setItem("wwbh-active-run", JSON.stringify(run));

    vi.resetModules();
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("IndexedDB is disabled");
      },
    });
    const mod = await import("./active-run");
    expect(await mod.loadActiveRun()).toEqual(run);
  });

  it("returns null when neither store has anything", async () => {
    const mod = await freshModule();
    expect(await mod.loadActiveRun()).toBeNull();
  });

  it("returns null rather than throwing on corrupt localStorage", async () => {
    window.localStorage.setItem("wwbh-active-run", "{not json");
    vi.resetModules();
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("IndexedDB is disabled");
      },
    });
    const mod = await import("./active-run");
    expect(await mod.loadActiveRun()).toBeNull();
  });

  it("clears both stores", async () => {
    const mod = await freshModule();
    await mod.saveActiveRun(makeRun());
    await mod.clearActiveRun();
    expect(await mod.loadActiveRun()).toBeNull();
    expect(window.localStorage.getItem("wwbh-active-run")).toBeNull();
  });

  it("overwrites rather than accumulating runs", async () => {
    const mod = await freshModule();
    await mod.saveActiveRun(makeRun({ clientKey: "first" }));
    await mod.saveActiveRun(makeRun({ clientKey: "second" }));
    expect((await mod.loadActiveRun())?.clientKey).toBe("second");
  });

  it("no-ops on the server, where there is no window", async () => {
    vi.resetModules();
    vi.stubGlobal("window", undefined);
    const mod = await import("./active-run");
    expect(await mod.loadActiveRun()).toBeNull();
    await expect(mod.saveActiveRun(makeRun())).resolves.toBeUndefined();
    await expect(mod.clearActiveRun()).resolves.toBeUndefined();
  });
});
