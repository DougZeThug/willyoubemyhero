// Client-side active-run persistence via IndexedDB with a localStorage fallback.
import { openDB, type IDBPDatabase } from "idb";

export type ActivePenalty = {
  clientKey: string;
  stationId: string | null;
  penalty_ms: number;
  reason: string | null;
};

export type ActiveSplit = {
  clientKey: string;
  stationId: string;
  cumulative_time_ms: number;
  segment_time_ms: number | null;
  recorded_at: string;
};

/** Epoch-ms anchors, so a pause survives the page that opened it. */
export type ActivePause = { pausedAt: number; resumedAt: number | null };

/**
 * Bumped whenever the stored shape changes. v1 anchored the clock on
 * `performance.now()`, which restarts at zero on every page load — a phone that
 * reloaded mid-run read 00.00 and then recorded that as the official time.
 */
export const ACTIVE_RUN_VERSION = 2;

export type ActiveRun = {
  v: typeof ACTIVE_RUN_VERSION;
  clientKey: string;
  eventId: string;
  participantId: string;
  startedAtIso: string;
  /**
   * Epoch ms. Not monotonic — an NTP step mid-run skews the time — but a reload
   * on a phone in a garden is common and used to corrupt the run every single
   * time, where a clock step during a forty-second run is rare.
   */
  startedAt: number;
  status: "running" | "paused" | "finished";
  pauses: ActivePause[];
  splits: ActiveSplit[];
  penalties: ActivePenalty[];
  finishedAtIso?: string;
  finishedAt?: number;
};

/** The v1 record: identical fields, but every anchor was a performance.now() value. */
type LegacyActiveRun = Omit<ActiveRun, "v" | "startedAt" | "finishedAt"> & {
  startedAtPerf: number;
  finishedAtPerf?: number;
};

const DB_NAME = "wwbh-combine";
const STORE = "active-run";

function isBrowser() {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

let dbPromise: Promise<IDBPDatabase> | null = null;
function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      },
    });
  }
  return dbPromise;
}

const KEY = "current";
const LS_KEY = "wwbh-active-run";

/**
 * Bring a stored record up to the current schema, or refuse it.
 *
 * Refusing never deletes anything: the caller leaves the record in storage,
 * because it may be the only copy of a time somebody actually ran.
 */
export function migrateActiveRun(raw: unknown): ActiveRun | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Partial<ActiveRun> & Partial<LegacyActiveRun>;
  if (
    typeof rec.clientKey !== "string" ||
    typeof rec.eventId !== "string" ||
    typeof rec.participantId !== "string" ||
    typeof rec.startedAtIso !== "string"
  ) {
    return null;
  }

  if (rec.v === ACTIVE_RUN_VERSION) {
    return typeof rec.startedAt === "number" ? (rec as ActiveRun) : null;
  }
  // A version this build has never heard of can only have been written by a
  // newer one. Guessing at its clock is worse than showing nothing.
  if (rec.v !== undefined) return null;

  // v1. Every anchor sat on one performance.now() timeline and startedAtIso is
  // the epoch of startedAtPerf, so the conversion is exact rather than a guess.
  if (typeof rec.startedAtPerf !== "number") return null;
  const startedAt = Date.parse(rec.startedAtIso);
  if (Number.isNaN(startedAt)) return null;
  const perfBase = rec.startedAtPerf;
  const toEpoch = (perf: number) => startedAt + (perf - perfBase);

  const pauses: ActivePause[] = (rec.pauses ?? []).map((p) => ({
    pausedAt: toEpoch(p.pausedAt),
    resumedAt: p.resumedAt == null ? null : toEpoch(p.resumedAt),
  }));
  const finishedAt =
    typeof rec.finishedAtPerf === "number"
      ? toEpoch(rec.finishedAtPerf)
      : rec.finishedAtIso
        ? Date.parse(rec.finishedAtIso)
        : undefined;

  return {
    v: ACTIVE_RUN_VERSION,
    clientKey: rec.clientKey,
    eventId: rec.eventId,
    participantId: rec.participantId,
    startedAtIso: rec.startedAtIso,
    startedAt,
    status: rec.status ?? "running",
    pauses,
    splits: rec.splits ?? [],
    penalties: rec.penalties ?? [],
    ...(rec.finishedAtIso ? { finishedAtIso: rec.finishedAtIso } : {}),
    ...(finishedAt != null && !Number.isNaN(finishedAt) ? { finishedAt } : {}),
  };
}

export async function loadActiveRun(): Promise<ActiveRun | null> {
  if (!isBrowser()) return null;
  try {
    const db = await getDb();
    const v = await db.get(STORE, KEY);
    if (v) return migrateActiveRun(v);
  } catch {
    /* fall through */
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? migrateActiveRun(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export async function saveActiveRun(run: ActiveRun): Promise<void> {
  if (!isBrowser()) return;
  try {
    const db = await getDb();
    await db.put(STORE, run, KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(run));
  } catch {
    /* ignore */
  }
}

/**
 * Any screen that clears the run also has to tell the mounted consoles, or the
 * timer keeps counting a run that no longer exists on this phone — which is
 * exactly what made a reset "not stick" until a reload.
 */
export const ACTIVE_RUN_CLEARED_EVENT = "wwbh:active-run-cleared";

export async function clearActiveRun(): Promise<void> {
  if (!isBrowser()) return;
  try {
    const db = await getDb();
    await db.delete(STORE, KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event(ACTIVE_RUN_CLEARED_EVENT));
  } catch {
    /* ignore */
  }
}


/** `nowMs` is epoch ms — `Date.now()`, not `performance.now()`. */
export function computeElapsedMs(run: ActiveRun, nowMs: number): number {
  if (run.status === "finished" && run.finishedAt != null) {
    nowMs = run.finishedAt;
  }
  const totalPaused = run.pauses.reduce((s, p) => s + ((p.resumedAt ?? nowMs) - p.pausedAt), 0);
  return Math.max(0, Math.floor(nowMs - run.startedAt - totalPaused));
}
