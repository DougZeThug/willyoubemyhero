// How one device arranges the vault's sections: what order they sit in and which
// of them are rolled up.
//
// A preference, not data — it never leaves the phone it was set on, the way the
// sound toggle in card-sfx.ts never does. This file is that file's shape on
// purpose: a `wwbh:` key, every touch of storage inside a try/catch so a locked
// private-mode browser degrades to "works for this page load" instead of a blank
// screen, and a custom event because `storage` only fires in *other* tabs.

import { useCallback, useEffect, useMemo, useState } from "react";

const KEY = "wwbh:vault-layout";
const CHANGED = "wwbh:vault-layout-changed";

export type VaultLayout = {
  /** Section ids, in the order this device arranged them. Ids never seen are absent. */
  order: readonly string[];
  /** Ids that are rolled up. Closed rather than open — see the note on read(). */
  collapsed: readonly string[];
};

const EMPTY: VaultLayout = { order: [], collapsed: [] };

/** The roster grid's section id. Stored, so it is add-only like a collection id. */
export const ROSTER_SECTION = "roster";

/** The pinned shelf. Only present once this device has favourited something. */
export const FAVOURITES_SECTION = "favourites";

/**
 * A secret set's section id. Prefixed so it can never collide with `roster`, and
 * the unsorted pile gets the empty suffix rather than a word — `null` is not a
 * collection id and must not start looking like one.
 */
export function secretSectionId(collection: string | null): string {
  return `secret:${collection ?? ""}`;
}

// Mirrors card-sfx.ts's module-level `muted`: the last value we set, which is the
// only thing left to trust when the write below is refused.
let current: VaultLayout = EMPTY;

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Collapsed ids are stored, not open ones, so a set appearing for the first time
 * — somebody's first Pets pull — arrives open. Storing open ids would hide every
 * new shelf behind a tap nobody knows to make.
 */
function read(): VaultLayout {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return EMPTY;
    const { order, collapsed } = parsed as Record<string, unknown>;
    return { order: strings(order), collapsed: strings(collapsed) };
  } catch {
    // Blocked storage, or something else wrote junk under our key. Either way the
    // default layout is a working page.
    return EMPTY;
  }
}

export function setVaultLayout(next: VaultLayout) {
  current = next;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode with storage blocked still rearranges for this page load */
  }
  window.dispatchEvent(new Event(CHANGED));
}

/**
 * Merge the sections actually on screen with the order this device chose.
 *
 * Stored ids that no longer render are dropped, and sections the device has never
 * seen fall in behind in their default order. New sets landing at the end is the
 * predictable rule rather than the clever one: the alternative — restoring a new
 * set to its default neighbours — guesses at an intent the owner never expressed,
 * and moving it takes one tap.
 */
export function orderSections(present: readonly string[], stored: readonly string[]): string[] {
  const here = new Set(present);
  const taken = new Set<string>();
  const out: string[] = [];
  for (const id of stored) {
    if (here.has(id) && !taken.has(id)) {
      out.push(id);
      taken.add(id);
    }
  }
  for (const id of present) {
    if (!taken.has(id)) {
      out.push(id);
      taken.add(id);
    }
  }
  return out;
}

/** One step up (-1) or down (+1). Clamped: an end-of-list move is a no-op, not a wrap. */
export function moveSection(order: readonly string[], id: string, delta: number): string[] {
  const from = order.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return [...order];
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/**
 * The vault's layout, reactive.
 *
 * Starts at the default so the server and the first client render agree, then
 * reads storage in an effect — the same hydration dance every other preference in
 * this app does, and for the same reason: SSR has no localStorage and a
 * mismatched first paint is the bug use-photo-urls.ts is written around. The page
 * already settles once when the collection reconciles; this settles with it.
 */
export function useVaultLayout(present: readonly string[]) {
  const [layout, setLayout] = useState<VaultLayout>(EMPTY);

  useEffect(() => {
    // Our own writes: trust the module value. Re-reading storage here would hand
    // a private-mode browser back the layout it just refused to save, and the
    // section would visibly spring back under the thumb that moved it.
    const mine = () => setLayout(current);
    // Another tab. That one did save, so storage is the truth.
    const theirs = () => {
      current = read();
      setLayout(current);
    };
    theirs();
    window.addEventListener(CHANGED, mine);
    window.addEventListener("storage", theirs);
    return () => {
      window.removeEventListener(CHANGED, mine);
      window.removeEventListener("storage", theirs);
    };
  }, []);

  const order = useMemo(() => orderSections(present, layout.order), [present, layout.order]);
  const collapsed = useMemo(() => new Set(layout.collapsed), [layout.collapsed]);

  const toggle = useCallback(
    (id: string) => {
      const next = collapsed.has(id)
        ? layout.collapsed.filter((x) => x !== id)
        : [...layout.collapsed, id];
      // Keeps `layout.order` rather than the merged one: opening a shelf is not a
      // statement about where it sits, and pinning the order here would freeze a
      // layout the owner never arranged.
      setVaultLayout({ order: layout.order, collapsed: next });
    },
    [collapsed, layout],
  );

  const move = useCallback(
    (id: string, delta: number) => {
      // The merged order, so the first move pins everything currently on screen
      // instead of writing a one-item list the merge would scatter next time.
      setVaultLayout({ order: moveSection(order, id, delta), collapsed: layout.collapsed });
    },
    [order, layout.collapsed],
  );

  return { order, collapsed, toggle, move };
}
