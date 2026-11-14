import { openDB, type IDBPDatabase, type OpenDBCallbacks } from "idb";

export function isBrowser() {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

/**
 * Run a device write and swallow whatever it throws.
 *
 * For persistence that is a convenience, where a blocked or full store means
 * "this device just doesn't remember". The call site says why that is acceptable.
 */
export async function bestEffort(write: () => unknown): Promise<void> {
  try {
    await write();
  } catch {
    /* the caller's comment says why losing this write is fine */
  }
}

/**
 * A lazily opened database whose open promise is shared by every caller.
 *
 * A rejected open is dropped rather than cached: one transient failure (a
 * blocked upgrade, a private-mode hiccup) would otherwise fail every later read
 * until the tab is reloaded, so a retry could never succeed.
 */
export function cachedDb(
  name: string,
  version: number,
  upgrade: OpenDBCallbacks<unknown>["upgrade"],
): () => Promise<IDBPDatabase> {
  let promise: Promise<IDBPDatabase> | null = null;
  return () => {
    if (!promise) {
      const opened = openDB(name, version, { upgrade });
      promise = opened;
      opened.catch(() => {
        if (promise === opened) promise = null;
      });
    }
    return promise;
  };
}
