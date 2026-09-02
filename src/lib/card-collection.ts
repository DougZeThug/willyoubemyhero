// Per-device card collection and card-art metadata.
//
// Deliberately a separate IndexedDB from `wwbh-combine` (src/lib/active-run.ts):
// that database holds an in-progress timed run, which is the most safety-critical
// client state in the app. Card data has no business forcing a version upgrade on it.

import { openDB, type IDBPDatabase } from "idb";
import { bestEdition, type Edition } from "./card-edition";

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
  /**
   * Who this pack was dealt to, as `usePackIdentity` returns it.
   *
   * Packs are per-person now, and a phone changes hands mid-party in this league.
   * Without this, whoever picks the handset up next resumes the previous person's
   * pack. Optional so a row written before per-person packs still loads — a
   * missing value counts as a match, so nobody mid-reveal on the day this ships
   * loses their cards.
   */
  identity?: string;
  /**
   * Which card the reveal stand was on.
   *
   * `revealed` cannot answer this on its own: it records which cards have been
   * turned, not which one you are looking at. A card you flipped but had not yet
   * pressed Next on is indistinguishable from one you finished with, so
   * resuming from `revealed` alone dropped you on the *following* card and you
   * never got the one you were holding back. Optional, so a row written before
   * the stand existed still loads and falls back to `resumeCursor`.
   *
   * Its absence is also how a pre-stand row is recognised, which matters beyond
   * the fallback: that ceremony wrote every index into `revealed` the moment the
   * wrapper came off, so resuming one faithfully lands past the end of the stand
   * and renders the finished grid — no wrapper to rip and no cards to step
   * through for the rest of that day, which is indistinguishable from the stand
   * not having shipped. See the resume effect in players.pack.tsx.
   */
  cursor?: number;
};

/**
 * Cards this device has pulled that the server has not been told about.
 *
 * A second row rather than a field on the pack row above, because the two retire
 * at different moments: a pack row lasts the day and is overwritten by the next
 * one, while this lasts until `recordCardPulls` has actually landed — which can
 * be the following morning. `mergeCollection` deletes anything the server does
 * not vouch for, and until that call succeeds the server cannot vouch for these,
 * so without this row one garden dead spot at tear time cost the whole pack on
 * the next load.
 */
export type UnrecordedPulls = {
  /** Local date key the pack was dealt for. */
  dayKey: string;
  /** Who the pack was dealt to, as `usePackIdentity` returns it. */
  identity?: string;
  /** `event_participants.id` for every card the server still owes an answer on. */
  ids: string[];
};

export type CollectedCard = {
  eventParticipantId: string;
  /** ms epoch of the first pull. */
  pulledAt: number;
  /** How many times this card has been pulled. */
  count: number;
  /** Tier at the time of the first pull, for the collection view. */
  tier: string;
  /**
   * Best finish ever pulled of this card. The deliberate opposite rule to `tier`
   * above, and the asymmetry is the point: a tier is a fact about a moment and
   * rewriting it would rewrite history, while an edition is a thing you own and a
   * better one replaces a worse one. The server applies the identical rule in
   * record_card_pulls.
   *
   * OPTIONAL, AND THAT IS WHAT AVOIDS A VERSION BUMP. A row written before
   * editions loads with this undefined, bestEdition reads that as standard, and
   * the first upgrade pull fills it in — so a new field on a plain object in a
   * keyed store needs no schema change. See the note on the version above:
   * bumping it without touching e2e/journeys.spec.ts turns five assertions into a
   * confusing null.
   */
  edition?: string;
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
export async function collectCard(
  eventParticipantId: string,
  tier: string,
  edition: Edition = "standard",
): Promise<void> {
  if (!isBrowser()) return;
  try {
    const db = await getDb();
    const existing = (await db.get(COLLECTED, eventParticipantId)) as CollectedCard | undefined;
    const next: CollectedCard = existing
      ? {
          ...existing,
          count: existing.count + 1,
          // Upgraded, never downgraded — unlike `tier` and `pulledAt`, which the
          // spread deliberately keeps from the first pull.
          edition: bestEdition(existing.edition, edition),
        }
      : { eventParticipantId, pulledAt: Date.now(), count: 1, tier, edition };
    await db.put(COLLECTED, next, eventParticipantId);
  } catch {
    /* a device with IndexedDB blocked simply doesn't collect */
  }
}

/**
 * Delete specific cards from this device's collection.
 *
 * For rows the server has disowned — see `mergeCollection`. Deliberately deletes
 * keys rather than bumping the database version to wipe the store: the version is
 * hardcoded in e2e/journeys.spec.ts (see the note at the top of this file), and a
 * bump would take out the pack state and card art cache along with it.
 */
export async function forgetCards(eventParticipantIds: readonly string[]): Promise<void> {
  if (!isBrowser() || eventParticipantIds.length === 0) return;
  try {
    const db = await getDb();
    const tx = db.transaction(COLLECTED, "readwrite");
    await Promise.all([...eventParticipantIds.map((id) => tx.store.delete(id)), tx.done]);
  } catch {
    /* a device with IndexedDB blocked has nothing to forget */
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
    announcePackState();
  } catch {
    /* ignore */
  }
}

/**
 * Fired after any write to this store.
 *
 * `useMyCollection` reads the unrecorded row to decide what it is not allowed to
 * delete, and it reads it on mount — so a record that finally lands, on a screen
 * the hook is not mounted on, has to say so out loud or the vault goes on
 * protecting ids the server has since vouched for. Same shape and the same
 * reason as `wwbh:member-token-changed` in member-token.ts.
 */
export const PACK_STATE_CHANGED = "wwbh:pack-state-changed";

function announcePackState() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PACK_STATE_CHANGED));
}

/** A second row in the same store, so the pack and its unsent ids expire apart. */
const UNRECORDED_KEY = "unrecorded";

/**
 * The ids this device pulled and never managed to report, or null.
 *
 * Deliberately not scoped to today. An old row still protects its cards: a pull
 * the league has never heard of does not become somebody else's because the date
 * rolled over, and only a record that actually succeeds retires one.
 */
export async function loadUnrecorded(): Promise<UnrecordedPulls | null> {
  if (!isBrowser()) return null;
  try {
    const db = await getDb();
    return ((await db.get(PACK_STATE, UNRECORDED_KEY)) as UnrecordedPulls | undefined) ?? null;
  } catch {
    // Nothing to protect: a device with IndexedDB blocked never wrote the
    // collected rows the prune would have deleted either.
    return null;
  }
}

export async function saveUnrecorded(state: UnrecordedPulls): Promise<void> {
  if (!isBrowser()) return;
  try {
    const db = await getDb();
    await db.put(PACK_STATE, state, UNRECORDED_KEY);
    announcePackState();
  } catch {
    /* ignore */
  }
}

/** Hand the ids back to the merge. Only a successful record may call this. */
export async function clearUnrecorded(): Promise<void> {
  if (!isBrowser()) return;
  try {
    const db = await getDb();
    await db.delete(PACK_STATE, UNRECORDED_KEY);
    announcePackState();
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
