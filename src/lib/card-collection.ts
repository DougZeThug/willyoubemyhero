// Per-device card collection and card-art metadata.
//
// Deliberately a separate IndexedDB from `wwbh-combine` (src/lib/active-run.ts):
// that database holds an in-progress timed run, which is the most safety-critical
// client state in the app. Card data has no business forcing a version upgrade on it.

import { openDB, type IDBPDatabase } from "idb";

// The name, the version and the store names below are read directly by
// e2e/journeys.spec.ts, which opens this database itself to assert what a pack
// left behind. Opening it there at a version *below* the one stored raises
// VersionError, so bumping this without touching that file turns five assertions
// into a confusing null.
const DB_NAME = "wwbh-cards";
const COLLECTED = "collected";
const CARD_META = "card-meta";
const PACK_STATE = "pack-state";

/** Aspect ratio of a player's card art, cached so revisits never re-measure or jump. */
export type CardMeta = { aspect: number };

/**
 * Today's pack, and how far through it this device got.
 *
 * The dealt cards are stored rather than re-derived. The seed alone is not
 * enough: the last slot is swapped for a card the user had not collected *at
 * the moment the pack was dealt*, so re-deriving after the pack is revealed —
 * when those cards are in the collection — picks a different final card than
 * the one actually pulled.
 */
export type PackState = {
  /** Local date key the pack was dealt for. A different key means a new pack. */
  dayKey: string;
  /** `event_participants.id` for each card in the pack, in dealt order. */
  ids: string[];
  /** Indices already flipped face-up. */
  revealed: number[];
  /**
   * Whether today's secret card has been turned over *on this device*.
   *
   * Only a flag. Which secret it is lives in a Postgres row keyed on the claimed
   * member, so it follows you to a new phone — an id here would be a second
   * source of truth that could disagree with the first. Optional so a row written
   * before secret cards existed still loads, and so `savePackState` can stay a
   * pure passthrough of whatever the caller handed it.
   */
  secretRevealed?: boolean;
};

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
    dbPromise = openDB(DB_NAME, 2, {
      // Guarded rather than switched on `oldVersion`: a device upgrading from v1
      // and a device creating the database fresh both land here, and the only
      // thing that matters is that all three stores exist afterwards.
      upgrade(db) {
        if (!db.objectStoreNames.contains(COLLECTED)) db.createObjectStore(COLLECTED);
        if (!db.objectStoreNames.contains(CARD_META)) db.createObjectStore(CARD_META);
        if (!db.objectStoreNames.contains(PACK_STATE)) db.createObjectStore(PACK_STATE);
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

/**
 * Record a pull. Idempotent per card except for the pull counter.
 *
 * Opening a pack is the only thing that calls this. A card page used to collect
 * on sight, which made the whole vault a one-tap collect-everything path and
 * left `count` meaning "times seen" rather than "times pulled".
 */
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

/** A single row, so today's state simply overwrites yesterday's. */
const PACK_STATE_KEY = "today";

/** Today's pack progress, or null if this device has not opened one. */
export async function loadPackState(): Promise<PackState | null> {
  if (!isBrowser()) return null;
  try {
    const db = await getDb();
    return ((await db.get(PACK_STATE, PACK_STATE_KEY)) as PackState | undefined) ?? null;
  } catch {
    // A device with IndexedDB blocked can't be held to one pack a day. It gets
    // a fresh pack every load, which is a better failure than no pack at all.
    return null;
  }
}

export async function savePackState(state: PackState): Promise<void> {
  if (!isBrowser()) return;
  try {
    const db = await getDb();
    await db.put(PACK_STATE, state, PACK_STATE_KEY);
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
