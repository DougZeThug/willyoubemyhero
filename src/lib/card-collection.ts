// Per-device card collection and card-art metadata.
//
// Deliberately a separate IndexedDB from `wwbh-combine` (src/lib/active-run.ts):
// that database holds an in-progress timed run, which is the most safety-critical
// client state in the app. Card data has no business forcing a version upgrade on it.

import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "wwbh-cards";
const COLLECTED = "collected";
const CARD_META = "card-meta";

/** Aspect ratio of a player's card art, cached so revisits never re-measure or jump. */
export type CardMeta = { aspect: number };

export type CollectedCard = {
  eventParticipantId: string;
  /** ms epoch of the first pull. */
  pulledAt: number;
  /** How many times this card has been pulled. */
  count: number;
  /** Tier at the time of the first pull, for the collection view. */
  tier: string;
};

function isBrowser() {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

let dbPromise: Promise<IDBPDatabase> | null = null;
function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(COLLECTED)) db.createObjectStore(COLLECTED);
        if (!db.objectStoreNames.contains(CARD_META)) db.createObjectStore(CARD_META);
      },
    });
  }
  return dbPromise;
}

export async function loadCollection(): Promise<Record<string, CollectedCard>> {
  if (!isBrowser()) return {};
  try {
    const db = await getDb();
    const keys = await db.getAllKeys(COLLECTED);
    const values = await db.getAll(COLLECTED);
    const out: Record<string, CollectedCard> = {};
    keys.forEach((k, i) => {
      out[String(k)] = values[i] as CollectedCard;
    });
    return out;
  } catch {
    return {};
  }
}

/** Record a pull. Idempotent per card except for the pull counter. */
export async function collectCard(eventParticipantId: string, tier: string): Promise<void> {
  if (!isBrowser()) return;
  try {
    const db = await getDb();
    const existing = (await db.get(COLLECTED, eventParticipantId)) as CollectedCard | undefined;
    const next: CollectedCard = existing
      ? { ...existing, count: existing.count + 1 }
      : { eventParticipantId, pulledAt: Date.now(), count: 1, tier };
    await db.put(COLLECTED, next, eventParticipantId);
  } catch {
    /* a device with IndexedDB blocked simply doesn't collect */
  }
}

export async function clearCollection(): Promise<void> {
  if (!isBrowser()) return;
  try {
    const db = await getDb();
    await db.clear(COLLECTED);
  } catch {
    /* ignore */
  }
}

// Aspect ratios are read by every card on screen at once — a vault grid is 30+.
// One `getAll` on first use beats 30 separate IndexedDB round trips, and the
// synchronous cache lets a revisit size its cards on the very first render
// instead of laying out at the default ratio and reflowing a frame later.
const metaCache = new Map<string, CardMeta>();
let primePromise: Promise<void> | null = null;

/** Pull the whole card-meta store into memory once per page load. */
export function primeCardMeta(): Promise<void> {
  if (!primePromise) {
    primePromise = (async () => {
      if (!isBrowser()) return;
      try {
        const db = await getDb();
        const [keys, values] = await Promise.all([db.getAllKeys(CARD_META), db.getAll(CARD_META)]);
        keys.forEach((k, i) => metaCache.set(String(k), values[i] as CardMeta));
      } catch {
        /* a device with IndexedDB blocked just measures from the image */
      }
    })();
  }
  return primePromise;
}

/** Whatever is already in memory. Null until `primeCardMeta` has resolved. */
export function cachedCardMeta(eventParticipantId: string | undefined): CardMeta | null {
  if (!eventParticipantId) return null;
  return metaCache.get(eventParticipantId) ?? null;
}

export async function saveCardMeta(eventParticipantId: string, meta: CardMeta): Promise<void> {
  metaCache.set(eventParticipantId, meta);
  if (!isBrowser()) return;
  try {
    const db = await getDb();
    await db.put(CARD_META, meta, eventParticipantId);
  } catch {
    /* ignore */
  }
}
