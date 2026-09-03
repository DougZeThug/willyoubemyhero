// Trophies this device has already thrown a ceremony for.
//
// Stored on the phone, exactly like use-trade-badge.ts and vault-favourites.ts:
// a `wwbh:` key, every touch of storage in a try/catch so a locked private-mode
// browser degrades to "works for this page load", and a custom event because
// `storage` only fires in *other* tabs.
//
// Per-device rather than a column, and for a sharper reason than the trade dot
// has: the trophy row is the permanent fact and it already lives in Postgres.
// This only answers "have I shown you this yet", which is a property of a screen,
// not of a collection.
//
// THE `primed` FLAG IS THE WHOLE DESIGN. Without it there is no way to tell a
// device that has genuinely never seen anything from one whose stored set is
// empty, and the two want opposite behaviour: a phone opening the vault for the
// first time must not fire a ceremony for every set its owner finished last
// summer, while a phone that has been here before must fire for the one that
// arrived overnight. So the first pass seeds and stays silent, and every pass
// after that celebrates what is new.
//
// Keys are `<participantId>:<collection>`, the same composite completedIds()
// uses, so one device shared by two people at a party cannot swallow the other's
// ceremony.

import { useEffect, useState } from "react";

const KEY = "wwbh:trophy-seen";
const CHANGED = "wwbh:trophy-seen-changed";

/** Composite key for one person's trophy in one set. */
export function trophyKey(participantId: string, collection: string): string {
  return `${participantId}:${collection}`;
}

export type TrophySeen = {
  /** False until this device has been through the seeding pass once. */
  primed: boolean;
  ids: readonly string[];
};

const EMPTY: TrophySeen = { primed: false, ids: [] };

// Mirrors vault-favourites.ts's `current`: the last value we set, which is all
// that is left to trust when the write below is refused.
let current: TrophySeen = EMPTY;

function read(): TrophySeen {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    const obj = parsed as { primed?: unknown; ids?: unknown } | null;
    const ids = Array.isArray(obj?.ids)
      ? obj.ids.filter((v): v is string => typeof v === "string")
      : [];
    // `primed` only counts when it is literally true. Junk under our key reads as
    // a fresh device, which seeds silently — the safe direction, because the
    // other one is a ceremony storm.
    return { primed: obj?.primed === true, ids };
  } catch {
    // Blocked storage, or something else wrote junk under our key. A silent first
    // pass is a working page.
    return EMPTY;
  }
}

export function setTrophySeen(next: TrophySeen) {
  // Skip the write and the re-render it would fan out. The watcher calls this on
  // every data settle, so without the guard a focus refetch would rewrite storage
  // and wake every listener several times a minute.
  if (
    next.primed === current.primed &&
    next.ids.length === current.ids.length &&
    next.ids.every((id) => current.ids.includes(id))
  ) {
    return;
  }
  current = { primed: next.primed, ids: [...new Set(next.ids)] };
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* private mode with storage blocked still stops a repeat for this page load */
  }
  window.dispatchEvent(new Event(CHANGED));
}

/**
 * Mark trophies as celebrated without waiting for the watcher to notice them.
 *
 * Called by the pack and trade screens the moment their response comes back,
 * because those two fire their own ceremony from the response payload — with the
 * timing the moment deserves, after the card has been turned over. Recording it
 * here is what stops the global host firing a second one when the same row
 * arrives through realtime a beat later.
 *
 * Marking implies primed: a device that has celebrated something has, by
 * definition, been here.
 */
export function markTrophiesCelebrated(keys: readonly string[]) {
  if (keys.length === 0) return;
  setTrophySeen({ primed: true, ids: [...current.ids, ...keys] });
}

/**
 * Re-file a guest's ceremonies under the player they have just claimed.
 *
 * The pack screen marks a guest's finished set under their PACK identity
 * (`d:<deviceId>`), because that is the only name the device has for them — and
 * `uncelebratedTrophies` above only ever asks about `<participantId>:<set>`. So
 * without this the claim banks the trophy under the participant, the global host
 * finds it uncelebrated, and the guest sees the same ceremony a second time.
 * B-13's fix stopped it being swallowed; this stops it being shown twice.
 *
 * `to` is the bare participant id and NOT the `m:` pack identity, on purpose:
 * this key space belongs to the member the watcher asks about, not to the pack
 * the row was carried with.
 *
 * Reads the module value rather than storage, like markTrophiesCelebrated — the
 * ceremony host is mounted at the root, so every screen that can reach a claim
 * has already primed it.
 */
export function carryTrophySeen(from: string, to: string) {
  if (!from || !to || from === to) return;
  const prefix = `${from}:`;
  const carried = current.ids
    .filter((id) => id.startsWith(prefix))
    .map((id) => `${to}:${id.slice(prefix.length)}`)
    // Already carried. A re-claim on the same handset would otherwise rebuild the
    // identical set and slip past setTrophySeen's no-op guard, which compares
    // lengths — writing storage and waking every listener for nothing.
    .filter((id) => !current.ids.includes(id));
  if (carried.length === 0) return;
  // The guest's own keys stay. Nothing reads them again, and dropping them would
  // make a second call to this — a re-claim on the same handset — a no-op that
  // silently un-marks a set if the first one's write was refused.
  setTrophySeen({ primed: true, ids: [...current.ids, ...carried] });
}

/**
 * Which of this person's trophies have not been celebrated on this device.
 *
 * Pure, so the interesting cases can be tested without a browser. Returns an
 * empty list while the member is unhydrated — `useMemberSession` reports null on
 * the SSR and hydration renders even for a claimed member, and treating that as
 * "none of these are mine" would either prime with somebody else's shelf or fire
 * for every trophy the moment the token settles.
 */
export function uncelebratedTrophies<T extends { participantId: string; collection: string }>(
  trophies: readonly T[],
  participantId: string | null | undefined,
  seen: TrophySeen,
): T[] {
  if (!participantId) return [];
  const already = new Set(seen.ids);
  return trophies.filter(
    (t) =>
      t.participantId === participantId && !already.has(trophyKey(participantId, t.collection)),
  );
}

/** The seen set, reactive. Same hydration dance as useVaultFavourites. */
export function useTrophySeen(): TrophySeen {
  const [seen, setSeen] = useState<TrophySeen>(EMPTY);

  useEffect(() => {
    // Our own writes trust the module value; re-reading storage would hand a
    // private-mode browser back the state it just refused to save, and the same
    // ceremony would fire again on the next refetch.
    const mine = () => setSeen(current);
    // Another tab. That one did save, so storage is the truth.
    const theirs = () => {
      current = read();
      setSeen(current);
    };
    theirs();
    window.addEventListener(CHANGED, mine);
    window.addEventListener("storage", theirs);
    return () => {
      window.removeEventListener(CHANGED, mine);
      window.removeEventListener("storage", theirs);
    };
  }, []);

  return seen;
}
