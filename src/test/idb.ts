// A fresh in-memory IndexedDB per test.
//
// Both card-collection.ts and active-run.ts cache their opened database in a
// module-level promise, so a test that wants a clean database has to reset the
// module registry *and* swap the factory underneath it.
//
// fake-indexeddb ships typings for `lib/FDBFactory` but its package.json
// "exports" map has no "types" condition for the subpath, so TypeScript under
// Bundler resolution cannot see them. The import is correct at runtime.
// @ts-expect-error -- see above
import FDBFactory from "fake-indexeddb/lib/FDBFactory";

/** Point `globalThis.indexedDB` at an empty database. */
export function resetIndexedDB() {
  globalThis.indexedDB = new FDBFactory() as IDBFactory;
}
