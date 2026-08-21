// The in-progress timed run — the most safety-critical client state in the app.
// If this drifts, somebody's combine time is wrong and there is no recovering it
// after the fact.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVE_RUN_VERSION,
  computeElapsedMs,
  migrateActiveRun,
  type ActiveRun,
} from "./active-run";

/** Epoch of 2026-07-28T12:00:00.000Z — the fixtures' start instant. */
const START = Date.parse("2026-07-28T12:00:00.000Z");

function makeRun(over: Partial<ActiveRun> = {}): ActiveRun {
  return {
    v: ACTIVE_RUN_VERSION,
    clientKey: "ck-1",
    eventId: "event-1",
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

/** A record as v1 wrote it: every anchor a performance.now() reading. */
function makeLegacyRun(over: Record<string, unknown> = {}) {
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
    expect(computeElapsedMs(makeRun(), START + 60_000)).toBe(60_000);
  });

  it("is zero at the moment the clock starts", () => {
    expect(computeElapsedMs(makeRun(), START)).toBe(0);
  });

  it("subtracts a completed pause", () => {
    const run = makeRun({ pauses: [{ pausedAt: START + 10_000, resumedAt: START + 20_000 }] });
    expect(computeElapsedMs(run, START + 60_000)).toBe(50_000);
  });

  it("subtracts several completed pauses", () => {
    const run = makeRun({
      pauses: [
        { pausedAt: START + 10_000, resumedAt: START + 15_000 },
        { pausedAt: START + 20_000, resumedAt: START + 25_000 },
      ],
    });
    expect(computeElapsedMs(run, START + 60_000)).toBe(50_000);
  });

  it("subtracts an open pause up to now, so a paused clock stops moving", () => {
    const run = makeRun({
      status: "paused",
      pauses: [{ pausedAt: START + 30_000, resumedAt: null }],
    });
    expect(computeElapsedMs(run, START + 60_000)).toBe(30_000);
    // Ten more seconds of wall clock, still paused, still 30 seconds.
    expect(computeElapsedMs(run, START + 70_000)).toBe(30_000);
  });

  it("freezes a finished run at its finish time", () => {
    const run = makeRun({ status: "finished", finishedAt: START + 45_000 });
    expect(computeElapsedMs(run, START + 45_000)).toBe(45_000);
    // Time keeps passing; the recorded run does not.
    expect(computeElapsedMs(run, START + 999_000)).toBe(45_000);
  });

  it("subtracts pauses from a finished run too", () => {
    const run = makeRun({
      status: "finished",
      finishedAt: START + 60_000,
      pauses: [{ pausedAt: START + 10_000, resumedAt: START + 20_000 }],
    });
    expect(computeElapsedMs(run, START + 999_000)).toBe(50_000);
  });

  it("falls back to live timing when a finished run has no finish anchor", () => {
    const run = makeRun({ status: "finished" });
    expect(computeElapsedMs(run, START + 60_000)).toBe(60_000);
  });

  it("never returns a negative elapsed time", () => {
    // A clock that reads backwards would render as a wildly negative time on
    // the HUD; clamping keeps it at zero instead.
    expect(computeElapsedMs(makeRun(), START - 1_000)).toBe(0);
    const overPaused = makeRun({ pauses: [{ pausedAt: START, resumedAt: START + 999_000 }] });
    expect(computeElapsedMs(overPaused, START + 60_000)).toBe(0);
  });

  it("returns whole milliseconds", () => {
    expect(computeElapsedMs(makeRun({ startedAt: START + 0.6 }), START + 60_000.4)).toBe(59_999);
  });
});

describe("migrateActiveRun", () => {
  it("keeps a v1 run's elapsed time across a reload", () => {
    // The bug this schema bump exists for: performance.now() restarts at zero
    // on reload, so the old record read 00.00 sixty seconds into a live run and
    // then recorded that as the official time.
    const migrated = migrateActiveRun(makeLegacyRun())!;
    expect(migrated.v).toBe(ACTIVE_RUN_VERSION);
    expect(migrated.startedAt).toBe(START);
    expect(computeElapsedMs(migrated, START + 60_000)).toBe(60_000);
  });

  it("converts completed pauses onto the epoch timeline", () => {
    const legacy = makeLegacyRun({
      pauses: [{ pausedAt: 11_000, resumedAt: 21_000 }],
    });
    const migrated = migrateActiveRun(legacy)!;
    expect(migrated.pauses).toEqual([{ pausedAt: START + 10_000, resumedAt: START + 20_000 }]);
    expect(computeElapsedMs(migrated, START + 60_000)).toBe(50_000);
  });

  it("keeps an open pause open, so a reload mid-pause stays paused", () => {
    const legacy = makeLegacyRun({
      status: "paused",
      pauses: [{ pausedAt: 31_000, resumedAt: null }],
    });
    const migrated = migrateActiveRun(legacy)!;
    expect(migrated.pauses[0].resumedAt).toBeNull();
    expect(computeElapsedMs(migrated, START + 60_000)).toBe(30_000);
    expect(computeElapsedMs(migrated, START + 70_000)).toBe(30_000);
  });

  it("preserves a finished run's recorded time exactly", () => {
    const legacy = makeLegacyRun({
      status: "finished",
      finishedAtPerf: 46_000,
      finishedAtIso: "2026-07-28T12:00:45.000Z",
    });
    const migrated = migrateActiveRun(legacy)!;
    expect(migrated.finishedAt).toBe(START + 45_000);
    expect(migrated.finishedAtIso).toBe("2026-07-28T12:00:45.000Z");
    expect(computeElapsedMs(migrated, START + 999_000)).toBe(45_000);
  });

  it("falls back to finishedAtIso when the perf anchor is missing", () => {
    const legacy = makeLegacyRun({
      status: "finished",
      finishedAtIso: "2026-07-28T12:00:45.000Z",
    });
    expect(migrateActiveRun(legacy)!.finishedAt).toBe(START + 45_000);
  });

  it("is a no-op on a record that is already current", () => {
    const run = makeRun({ pauses: [{ pausedAt: START + 1_000, resumedAt: null }] });
    expect(migrateActiveRun(run)).toEqual(run);
  });

  it("refuses a v1 record whose start instant cannot be read", () => {
    // Without startedAtIso there is nothing to anchor the perf timeline to, and
    // a guessed start is worse than no clock at all.
    expect(migrateActiveRun(makeLegacyRun({ startedAtIso: "not a date" }))).toBeNull();
    const { startedAtPerf: _drop, ...noAnchor } = makeLegacyRun();
    expect(migrateActiveRun(noAnchor)).toBeNull();
  });

  it("refuses a version it has never heard of", () => {
    // Only a newer build could have written it. Guessing at its clock is worse
    // than showing nothing; the record itself is left in storage for that build.
    expect(migrateActiveRun({ ...makeRun(), v: 99 })).toBeNull();
  });

  it("refuses junk rather than throwing", () => {
    expect(migrateActiveRun(null)).toBeNull();
    expect(migrateActiveRun("nope")).toBeNull();
    expect(migrateActiveRun({})).toBeNull();
    expect(migrateActiveRun({ ...makeRun(), startedAt: "soon" })).toBeNull();
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

  it("migrates a v1 record stored in IndexedDB", async () => {
    const mod = await freshModule();
    const { openDB } = await import("idb");
    const db = await openDB("wwbh-combine", 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains("active-run")) d.createObjectStore("active-run");
      },
    });
    await db.put("active-run", makeLegacyRun(), "current");
    const loaded = await mod.loadActiveRun();
    expect(loaded?.v).toBe(ACTIVE_RUN_VERSION);
    expect(computeElapsedMs(loaded!, START + 60_000)).toBe(60_000);
  });

  it("migrates a v1 record stored in localStorage", async () => {
    window.localStorage.setItem("wwbh-active-run", JSON.stringify(makeLegacyRun()));
    vi.resetModules();
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("IndexedDB is disabled");
      },
    });
    const mod = await import("./active-run");
    const loaded = await mod.loadActiveRun();
    expect(loaded?.v).toBe(ACTIVE_RUN_VERSION);
    expect(computeElapsedMs(loaded!, START + 60_000)).toBe(60_000);
  });

  it("leaves an unreadable record in storage rather than dropping it", async () => {
    // loadActiveRun returning null must never mean "deleted": the record could
    // be the only copy of a run somebody actually did.
    const future = { ...makeRun(), v: 99 };
    window.localStorage.setItem("wwbh-active-run", JSON.stringify(future));
    vi.resetModules();
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("IndexedDB is disabled");
      },
    });
    const mod = await import("./active-run");
    expect(await mod.loadActiveRun()).toBeNull();
    expect(JSON.parse(window.localStorage.getItem("wwbh-active-run")!)).toEqual(future);
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
