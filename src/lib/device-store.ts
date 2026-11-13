// A preference kept on this device: one `wwbh:` localStorage key, a module value,
// and a React hook over both.
//
// Every touch of storage is in a try/catch so a locked private-mode browser
// degrades to "works for this page load", and a custom event announces writes
// because `storage` only fires in *other* tabs.

import { useEffect, useLayoutEffect, useState } from "react";

export type DeviceStore<T> = {
  /**
   * The module value: the last thing set or loaded, and the only thing left to
   * trust when a write is refused. Reading it never touches storage.
   */
  get(): T;
  /** Catch the module value up with storage. Call to hydrate before any hook mounts. */
  load(): T;
  set(next: T): void;
  /**
   * Reactive view. Starts at `empty` so the server and the first client render
   * agree, then loads in an effect — SSR has no localStorage, and a mismatched
   * first paint is the bug use-photo-urls.ts is written around.
   *
   * `afterLoad` runs once the value is loaded and BEFORE the listeners attach, so
   * a write it makes does not repaint this hook.
   */
  useValue(options?: { afterLoad?: (value: T) => void }): T;
};

export function createDeviceStore<T>(config: {
  key: string;
  /** What an unwritten, unparseable or unreadable key means. */
  empty: T;
  /** Receives the raw string; may throw or return `empty` on junk someone else wrote. */
  parse: (raw: string) => T;
  serialize: (value: T) => string;
  /**
   * Load before paint rather than after. Load-bearing for a value the first frame
   * must already show: a passive effect runs after the browser has painted, so the
   * default would flash for one frame before correcting.
   */
  layout?: boolean;
  /** When given, a `set` of an equal value skips the write and the re-render it would fan out. */
  equals?: (a: T, b: T) => boolean;
}): DeviceStore<T> {
  const { key, empty, parse, serialize, equals } = config;
  const useLoad = config.layout && typeof window !== "undefined" ? useLayoutEffect : useEffect;
  const changed = `${key}-changed`;
  let current = empty;

  function read(): T {
    if (typeof window === "undefined") return empty;
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? empty : parse(raw);
    } catch {
      return empty;
    }
  }

  function load() {
    current = read();
    return current;
  }

  function set(next: T) {
    if (equals?.(current, next)) return;
    current = next;
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, serialize(next));
    } catch {
      /* private mode with storage blocked still holds the value for this page load */
    }
    window.dispatchEvent(new Event(changed));
  }

  function useValue(options: { afterLoad?: (value: T) => void } = {}) {
    const [value, setValue] = useState<T>(empty);
    useLoad(() => {
      // Our own writes trust the module value; re-reading storage would hand a
      // private-mode browser back what it just refused to save, and the thing
      // would visibly undo itself under the thumb that changed it.
      const mine = () => setValue(current);
      const reread = () => setValue(load());
      // Another tab, and only if it touched OUR key. `storage` fires for every key
      // the other tab writes, and re-reading clobbers the in-memory hold with
      // whatever storage holds. A null key is localStorage.clear(), which does
      // concern us.
      const theirs = (e: StorageEvent) => {
        if (e.key !== null && e.key !== key) return;
        reread();
      };
      reread();
      options.afterLoad?.(current);
      window.addEventListener(changed, mine);
      window.addEventListener("storage", theirs);
      return () => {
        window.removeEventListener(changed, mine);
        window.removeEventListener("storage", theirs);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- options are fixed per call site
    }, []);

    return value;
  }

  return { get: () => current, load, set, useValue };
}

/** `{ ids: string[] }` as stored by the pinned/seen id lists; junk reads as an empty list. */
export function parseIdList(raw: string): readonly string[] {
  const ids = (JSON.parse(raw) as { ids?: unknown } | null)?.ids;
  return Array.isArray(ids) ? ids.filter((v): v is string => typeof v === "string") : [];
}

/** True for a string-valued boolean flag stored as "1". */
export const parseFlag = (raw: string) => raw === "1";

/** `localStorage.getItem` that reads as absent where storage is blocked or there is no window. */
export function readStored(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
