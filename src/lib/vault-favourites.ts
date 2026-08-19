// Cards this device has pinned to the top of the vault.
//
// A preference, like the shelf order in vault-layout.ts, and stored the same way:
// a `wwbh:` key, every touch of storage in a try/catch so a locked private-mode
// browser degrades to "works for this page load", and a custom event because
// `storage` only fires in *other* tabs.
//
// Its own key rather than a third field on VaultLayout. The layout is about
// sections and this is about cards, so the two change on completely different
// cadences — and if favourites ever want to follow the member instead of the
// phone, swapping this one module out is the whole job.
//
// Only ever ids. Never the edition a card is wearing: card_pulls.edition is
// best-of-copies and a trade can take the good copy away, so a cached finish
// would strand a favourite wearing metal its owner no longer holds.

import { useCallback, useEffect, useMemo, useState } from "react";

const KEY = "wwbh:vault-favourites";
const CHANGED = "wwbh:vault-favourites-changed";

/**
 * Prefixed so a roster card and a secret can never collide, and distinct from
 * vault-layout's `secret:<collection>` section ids so the two id spaces do not
 * read as one thing.
 */
export function rosterFavouriteId(eventParticipantId: string): string {
  return `p:${eventParticipantId}`;
}

export function secretFavouriteId(secretCardId: string): string {
  return `s:${secretCardId}`;
}

// Mirrors vault-layout.ts's `current`: the last value we set, which is all that
// is left to trust when the write below is refused.
let current: readonly string[] = [];

function read(): readonly string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    const ids = (parsed as { ids?: unknown } | null)?.ids;
    if (!Array.isArray(ids)) return [];
    return ids.filter((v): v is string => typeof v === "string");
  } catch {
    // Blocked storage, or something else wrote junk under our key. An empty
    // shelf is a working page.
    return [];
  }
}

export function setVaultFavourites(next: readonly string[]) {
  current = next;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ids: next }));
  } catch {
    /* private mode with storage blocked still pins for this page load */
  }
  window.dispatchEvent(new Event(CHANGED));
}

/**
 * On, or off again.
 *
 * Appends rather than unshifts: the shelf reads in the order things were pinned,
 * so a card you favourited weeks ago does not get shoved down the page every time
 * you pin another. Ordering the shelf by rarity instead would mean ranking an
 * Edition against a SecretTier, and those two vocabularies are kept apart on
 * purpose — see the headers of card-edition.ts and secret-rarity.ts.
 */
export function toggleFavourite(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/** The pinned ids, reactive. Same hydration dance as useVaultLayout. */
export function useVaultFavourites() {
  const [ids, setIds] = useState<readonly string[]>([]);

  useEffect(() => {
    // Our own writes trust the module value; re-reading storage would hand a
    // private-mode browser back the list it just refused to save, and the star
    // would visibly un-fill under the thumb that tapped it.
    const mine = () => setIds(current);
    // Another tab. That one did save, so storage is the truth.
    const theirs = () => {
      current = read();
      setIds(current);
    };
    theirs();
    window.addEventListener(CHANGED, mine);
    window.addEventListener("storage", theirs);
    return () => {
      window.removeEventListener(CHANGED, mine);
      window.removeEventListener("storage", theirs);
    };
  }, []);

  const set = useMemo(() => new Set(ids), [ids]);
  const isFavourite = useCallback((id: string) => set.has(id), [set]);
  const toggle = useCallback((id: string) => setVaultFavourites(toggleFavourite(ids, id)), [ids]);

  return { ids, isFavourite, toggle };
}
