// Per-device card collection and daily pack state.
//
// The module caches its database handle and its card-meta map at module scope,
// so every test takes a fresh module against a fresh fake-indexeddb rather than
// leaking state into the next one.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function freshModule() {
  vi.resetModules();
  const { resetIndexedDB } = await import("@/test/idb");
  resetIndexedDB();
  return import("./card-collection");
}

async function serverModule() {
  vi.resetModules();
  vi.stubGlobal("window", undefined);
  return import("./card-collection");
}

const CARD_A = "card-a";
const CARD_B = "card-b";

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("collection", () => {
  it("starts empty", async () => {
    const mod = await freshModule();
    expect(await mod.loadCollection()).toEqual({});
  });

  it("records the first pull with a count of one", async () => {
    const mod = await freshModule();
    await mod.collectCard(CARD_A, "champion");
    const collection = await mod.loadCollection();
    expect(collection[CARD_A]).toMatchObject({
      eventParticipantId: CARD_A,
      count: 1,
      tier: "champion",
    });
    expect(collection[CARD_A].pulledAt).toBeGreaterThan(0);
  });

  it("increments the count on a duplicate pull", async () => {
    const mod = await freshModule();
    await mod.collectCard(CARD_A, "base");
    await mod.collectCard(CARD_A, "base");
    await mod.collectCard(CARD_A, "base");
    expect((await mod.loadCollection())[CARD_A].count).toBe(3);
  });

  it("keeps the tier and timestamp from the first pull", async () => {
    // The collection view shows what the card was when you pulled it. A later
    // pull, after the player's tier has moved, must not rewrite history.
    const mod = await freshModule();
    await mod.collectCard(CARD_A, "base");
    const first = (await mod.loadCollection())[CARD_A];
    await mod.collectCard(CARD_A, "champion");
    const second = (await mod.loadCollection())[CARD_A];
    expect(second.tier).toBe("base");
    expect(second.pulledAt).toBe(first.pulledAt);
  });

  it("tracks cards independently", async () => {
    const mod = await freshModule();
    await mod.collectCard(CARD_A, "base");
    await mod.collectCard(CARD_B, "podium");
    await mod.collectCard(CARD_B, "podium");
    const collection = await mod.loadCollection();
    expect(collection[CARD_A].count).toBe(1);
    expect(collection[CARD_B].count).toBe(2);
  });

  it("clears everything", async () => {
    const mod = await freshModule();
    await mod.collectCard(CARD_A, "base");
    await mod.clearCollection();
    expect(await mod.loadCollection()).toEqual({});
  });
});

describe("pack state", () => {
  it("is null before a pack has ever been opened", async () => {
    const mod = await freshModule();
    expect(await mod.loadPackState()).toBeNull();
  });

  it("round-trips the dealt cards and reveal progress", async () => {
    const mod = await freshModule();
    const state = { dayKey: "2026-07-28", ids: [CARD_A, CARD_B, "card-c"], revealed: [0, 2] };
    await mod.savePackState(state);
    expect(await mod.loadPackState()).toEqual(state);
  });

  it("keeps a single row, so today overwrites yesterday", async () => {
    const mod = await freshModule();
    await mod.savePackState({ dayKey: "2026-07-27", ids: [CARD_A], revealed: [0] });
    await mod.savePackState({ dayKey: "2026-07-28", ids: [CARD_B], revealed: [] });
    expect(await mod.loadPackState()).toEqual({
      dayKey: "2026-07-28",
      ids: [CARD_B],
      revealed: [],
    });
  });

  it("stores the dealt ids rather than a seed", async () => {
    // The last slot is swapped for a card the user had not collected at the
    // moment the pack was dealt, so re-deriving from the seed after revealing
    // would pick a different card than the one actually pulled.
    const mod = await freshModule();
    await mod.savePackState({ dayKey: "2026-07-28", ids: [CARD_A, CARD_B], revealed: [] });
    expect((await mod.loadPackState())?.ids).toEqual([CARD_A, CARD_B]);
  });
});

describe("card meta", () => {
  it("returns null before priming", async () => {
    const mod = await freshModule();
    expect(mod.cachedCardMeta(CARD_A)).toBeNull();
  });

  it("returns null for an undefined id", async () => {
    const mod = await freshModule();
    expect(mod.cachedCardMeta(undefined)).toBeNull();
  });

  it("caches a saved aspect ratio synchronously", async () => {
    // A vault grid reads 30+ of these during a single render pass; the whole
    // point is that a revisit sizes its cards on the first frame.
    const mod = await freshModule();
    await mod.saveCardMeta(CARD_A, { aspect: 0.72 });
    expect(mod.cachedCardMeta(CARD_A)).toEqual({ aspect: 0.72 });
  });

  it("restores saved ratios into memory on prime", async () => {
    const mod = await freshModule();
    await mod.saveCardMeta(CARD_A, { aspect: 0.72 });
    await mod.saveCardMeta(CARD_B, { aspect: 1.4 });

    // Same database, fresh module: nothing in the in-memory cache yet.
    vi.resetModules();
    const reloaded = await import("./card-collection");
    expect(reloaded.cachedCardMeta(CARD_A)).toBeNull();
    await reloaded.primeCardMeta();
    expect(reloaded.cachedCardMeta(CARD_A)).toEqual({ aspect: 0.72 });
    expect(reloaded.cachedCardMeta(CARD_B)).toEqual({ aspect: 1.4 });
  });

  it("primes only once, however many callers ask", async () => {
    const mod = await freshModule();
    const [a, b] = await Promise.all([mod.primeCardMeta(), mod.primeCardMeta()]);
    expect(a).toBeUndefined();
    expect(b).toBeUndefined();
  });
});

describe("when IndexedDB is unavailable", () => {
  async function blockedModule() {
    vi.resetModules();
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("IndexedDB is disabled");
      },
    });
    return import("./card-collection");
  }

  it("reports an empty collection instead of throwing", async () => {
    const mod = await blockedModule();
    expect(await mod.loadCollection()).toEqual({});
  });

  it("swallows a collect attempt", async () => {
    const mod = await blockedModule();
    await expect(mod.collectCard(CARD_A, "base")).resolves.toBeUndefined();
  });

  it("hands out a fresh pack rather than no pack at all", async () => {
    // Better failure mode: a device with storage blocked can't be held to one
    // pack a day, but it still gets to open one.
    const mod = await blockedModule();
    expect(await mod.loadPackState()).toBeNull();
    await expect(
      mod.savePackState({ dayKey: "2026-07-28", ids: [], revealed: [] }),
    ).resolves.toBeUndefined();
  });

  it("still caches card meta in memory", async () => {
    const mod = await blockedModule();
    await mod.saveCardMeta(CARD_A, { aspect: 0.72 });
    expect(mod.cachedCardMeta(CARD_A)).toEqual({ aspect: 0.72 });
  });
});

describe("on the server", () => {
  it("returns empty defaults without touching storage", async () => {
    const mod = await serverModule();
    expect(await mod.loadCollection()).toEqual({});
    expect(await mod.loadPackState()).toBeNull();
    await expect(mod.collectCard(CARD_A, "base")).resolves.toBeUndefined();
    await expect(mod.clearCollection()).resolves.toBeUndefined();
    await expect(mod.primeCardMeta()).resolves.toBeUndefined();
  });
});
