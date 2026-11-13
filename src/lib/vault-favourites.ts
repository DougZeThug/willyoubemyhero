// Cards this device has pinned to the top of the vault.
//
// Stored on the device like every preference here; see device-store.ts.
//
// Its own key rather than a third field on VaultLayout. The layout is about
// sections and this is about cards, so the two change on completely different
// cadences — and if favourites ever want to follow the member instead of the
// phone, swapping this one module out is the whole job.
//
// Only ever ids. Never the edition a card is wearing: card_pulls.edition is
// best-of-copies and a trade can take the good copy away, so a cached finish
// would strand a favourite wearing metal its owner no longer holds.

import { useCallback, useMemo } from "react";
import { createDeviceStore, parseIdList } from "./device-store";
import { STORAGE_KEYS } from "./storage-keys";

const store = createDeviceStore<readonly string[]>({
  key: STORAGE_KEYS.vaultFavourites,
  empty: [],
  parse: parseIdList,
  serialize: (ids) => JSON.stringify({ ids }),
});

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

export const setVaultFavourites = store.set;

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

export function useVaultFavourites() {
  const ids = store.useValue();

  const set = useMemo(() => new Set(ids), [ids]);
  const isFavourite = useCallback((id: string) => set.has(id), [set]);
  const toggle = useCallback((id: string) => setVaultFavourites(toggleFavourite(ids, id)), [ids]);

  return { ids, isFavourite, toggle };
}
