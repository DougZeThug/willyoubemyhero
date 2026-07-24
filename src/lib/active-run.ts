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

export type ActivePause = { pausedAt: number; resumedAt: number | null };

export type ActiveRun = {
  clientKey: string;
  eventId: string;
  participantId: string;
  startedAtIso: string; // server-clock ISO
  startedAtPerf: number; // performance.now() anchor on this device
  status: "running" | "paused" | "finished";
  pauses: ActivePause[];
  splits: ActiveSplit[];
  penalties: ActivePenalty[];
  finishedAtIso?: string;
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

export async function loadActiveRun(): Promise<ActiveRun | null> {
  if (!isBrowser()) return null;
  try {
    const db = await getDb();
    const v = (await db.get(STORE, KEY)) as ActiveRun | undefined;
    if (v) return v;
  } catch {
    /* fall through */
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as ActiveRun) : null;
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
}

export function computeElapsedMs(run: ActiveRun, nowPerf: number): number {
  if (run.status === "finished" && run.finishedAtPerf != null) {
    nowPerf = run.finishedAtPerf;
  }
  const totalPaused = run.pauses.reduce(
    (s, p) => s + ((p.resumedAt ?? nowPerf) - p.pausedAt),
    0,
  );
  return Math.max(0, Math.floor(nowPerf - run.startedAtPerf - totalPaused));
}