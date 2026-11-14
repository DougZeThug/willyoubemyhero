import { openDB } from "idb";
import { describe, expect, it } from "vitest";
import { resetIndexedDB } from "@/test/idb";
import { cachedDb } from "./idb";

describe("cachedDb", () => {
  it("shares one open between callers", async () => {
    resetIndexedDB();
    const getDb = cachedDb("idb-share", 1, (db) => {
      db.createObjectStore("s");
    });
    expect(await getDb()).toBe(await getDb());
  });

  it("retries after an open fails instead of caching the rejection", async () => {
    resetIndexedDB();
    // Opening below the stored version raises VersionError.
    await openDB("idb-retry", 2);
    const getDb = cachedDb("idb-retry", 1, (db) => {
      db.createObjectStore("s");
    });
    await expect(getDb()).rejects.toThrow();
    resetIndexedDB();
    const db = await getDb();
    expect(db.objectStoreNames.contains("s")).toBe(true);
  });
});
