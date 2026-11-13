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
    // Blocked storage still holds the value for this page load, in `current`.
    writeStored(key, serialize(next));
    emitLocal(changed);
  }

  function useValue(options: { afterLoad?: (value: T) => void } = {}) {
    const [value, setValue] = useState<T>(empty);
    useLoad(() => {
      // Our own writes trust the module value; re-reading storage would hand a
      // private-mode browser back what it just refused to save, and the thing
      // would visibly undo itself under the thumb that changed it.
      const mine = () => setValue(current);
      const reread = () => setValue(load());
      reread();
      options.afterLoad?.(current);
      const offHere = onLocal(changed, mine);
      const offTheirs = onOtherTab([key], reread);
      return () => {
        offHere();
        offTheirs();
      };
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

/** Guarded `localStorage.setItem`: where storage is blocked the write is simply lost. */
export function writeStored(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode with storage blocked: nothing to persist to */
  }
}

/** Guarded `localStorage.removeItem`. */
export function removeStored(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* private mode with storage blocked: nothing to remove */
  }
}

// `storage` only fires in OTHER tabs, so a write needs a window event of its own
// to reach this tab's listeners. This pair is that convention, in one place.
export function emitLocal(name: string) {
  window.dispatchEvent(new Event(name));
}

export function onLocal(name: string, listener: () => void): () => void {
  window.addEventListener(name, listener);
  return () => window.removeEventListener(name, listener);
}

/**
 * Another tab changed one of `keys`.
 *
 * `storage` fires for every key the other tab writes, so a listener that does not
 * filter re-reads (and re-notifies) on unrelated writes -- and, for a store that
 * holds a value in memory, clobbers that hold with whatever storage says. A null
 * key is localStorage.clear(), which concerns every store.
 */
export function onOtherTab(keys: readonly string[], listener: () => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key !== null && !keys.includes(e.key)) return;
    listener();
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
