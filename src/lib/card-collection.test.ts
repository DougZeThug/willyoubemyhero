// Per-device card collection and daily pack state.
//
// The module caches its database handle and its card-meta map at module scope,
// so every test takes a fresh module against a fresh fake-indexeddb rather than
// leaking state into the next one.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDB } from "idb";

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

  it("defaults a pull with no finish named to standard", async () => {
    const mod = await freshModule();
    await mod.collectCard(CARD_A, "base");
    expect((await mod.loadCollection())[CARD_A].edition).toBe("standard");
  });

  it("records the finish the pull came out as", async () => {
    const mod = await freshModule();
    await mod.collectCard(CARD_A, "base", "gold");
    expect((await mod.loadCollection())[CARD_A].edition).toBe("gold");
  });

  it("upgrades the finish on a better duplicate", async () => {
    const mod = await freshModule();
    await mod.collectCard(CARD_A, "base", "bronze");
    await mod.collectCard(CARD_A, "base", "platinum");
    expect((await mod.loadCollection())[CARD_A].edition).toBe("platinum");
  });

  it("does not downgrade the finish on a worse duplicate", async () => {
    // The deliberate asymmetry with `tier` directly above: a tier is a fact about
    // a moment and must not be rewritten, while a finish is a thing you own and a
    // worse duplicate is a duplicate, not a demotion. Both rules are right; do not
    // "fix" one to match the other.
    const mod = await freshModule();
    await mod.collectCard(CARD_A, "base", "platinum");
    await mod.collectCard(CARD_A, "base", "standard");
    expect((await mod.loadCollection())[CARD_A].edition).toBe("platinum");
  });

  it("upgrades a row stored before finishes existed", async () => {
    // No IndexedDB version bump backs this field, so the migration path is simply
    // that an old row loads with it undefined and the next pull fills it in.
    const mod = await freshModule();
    await mod.collectCard(CARD_A, "base");
    // The name and version spelled out rather than imported, the same way
    // e2e/journeys.spec.ts opens this database — and a reminder that opening it
    // below a stored version raises VersionError, which is why the field is
    // optional instead of versioned.
    const db = await openDB("wwbh-cards", 2);
    const legacy = await db.get("collected", CARD_A);
    delete (legacy as Record<string, unknown>).edition;
    await db.put("collected", legacy, CARD_A);
    db.close();

    expect((await mod.loadCollection())[CARD_A].edition).toBeUndefined();
    await mod.collectCard(CARD_A, "base", "silver");
    expect((await mod.loadCollection())[CARD_A].edition).toBe("silver");
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

  it("forgets only the cards it is given", async () => {
    // How the rows left behind by collect-on-sight get removed once the server
    // has disowned them. See collection-merge.ts.
    const mod = await freshModule();
    await mod.collectCard(CARD_A, "base");
    await mod.collectCard(CARD_B, "podium");
    await mod.forgetCards([CARD_A]);
    expect(Object.keys(await mod.loadCollection())).toEqual([CARD_B]);
  });

  it("shrugs at an empty list and at a card it has never seen", async () => {
    const mod = await freshModule();
    await mod.collectCard(CARD_A, "base");
    await mod.forgetCards([]);
    await mod.forgetCards(["never-dealt"]);
    expect(Object.keys(await mod.loadCollection())).toEqual([CARD_A]);
  });

  it("does nothing on the server, where there is no IndexedDB", async () => {
    const mod = await serverModule();
    await expect(mod.forgetCards([CARD_A])).resolves.toBeUndefined();
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

  it("round-trips whether today's secret has been turned over", async () => {
    const mod = await freshModule();
    const state = {
      dayKey: "2026-07-28",
      ids: [CARD_A, CARD_B, "card-c"],
      revealed: [0, 1, 2],
      secretRevealed: true,
    };
    await mod.savePackState(state);
    expect(await mod.loadPackState()).toEqual(state);
  });

  it("loads a row written before secret cards existed", async () => {
    // savePackState is a pure passthrough, so an old row simply has no
    // secretRevealed key — it must not come back defaulted to anything.
    const mod = await freshModule();
    const legacy = { dayKey: "2026-07-28", ids: [CARD_A], revealed: [0] };
    await mod.savePackState(legacy);
    const loaded = await mod.loadPackState();
    expect(loaded).toEqual(legacy);
    expect(loaded).not.toHaveProperty("secretRevealed");
  });

  it("only stores the flag, never which secret it was", async () => {
    // The card itself is a Postgres row keyed on the claimed member, so it
    // follows you to a new phone. An id here would be a second source of truth.
    const mod = await freshModule();
    await mod.savePackState({
      dayKey: "2026-07-28",
      ids: [CARD_A],
      revealed: [0],
      secretRevealed: true,
    });
    expect(Object.keys((await mod.loadPackState())!).sort()).toEqual([
      "dayKey",
      "ids",
      "revealed",
      "secretRevealed",
    ]);
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

describe("unrecorded pulls", () => {
  const UNRECORDED = { dayKey: "2026-07-28", identity: "m:p-alice", ids: [CARD_A, CARD_B] };

  it("is null before a pack has ever failed to record", async () => {
    const mod = await freshModule();
    expect(await mod.loadUnrecorded()).toBeNull();
  });

  it("round-trips the ids the server has not been told about", async () => {
    const mod = await freshModule();
    await mod.addUnrecorded(UNRECORDED);
    expect(await mod.loadUnrecorded()).toEqual(UNRECORDED);
  });

  it("is retired by the record that took it, and only then", async () => {
    const mod = await freshModule();
    await mod.addUnrecorded(UNRECORDED);
    await mod.retireUnrecorded([CARD_A, CARD_B]);
    expect(await mod.loadUnrecorded()).toBeNull();
  });

  it("retires only the ids the league actually took", async () => {
    // A record posts one pack, so it can only vouch for one pack. Monday's cards
    // are not adjudicated by Tuesday's call.
    const mod = await freshModule();
    await mod.addUnrecorded(UNRECORDED);
    await mod.retireUnrecorded([CARD_A]);
    expect((await mod.loadUnrecorded())?.ids).toEqual([CARD_B]);
  });

  it("keeps an earlier day's pack when a later one is filed", async () => {
    // The hole this closes: a pack that failed to record on Monday used to lose
    // its protection the moment Tuesday's was dealt, and Monday's is never
    // re-sent — so nothing would ever have vouched for those cards again.
    const mod = await freshModule();
    await mod.addUnrecorded({ dayKey: "2026-07-27", identity: "m:p-alice", ids: [CARD_A] });
    await mod.addUnrecorded({ dayKey: "2026-07-28", identity: "m:p-alice", ids: [CARD_B] });
    const row = (await mod.loadUnrecorded())!;
    expect(row.ids.sort()).toEqual([CARD_A, CARD_B].sort());
    expect(row.dayKey).toBe("2026-07-28");
  });

  it("does not file the same card twice", async () => {
    const mod = await freshModule();
    await mod.addUnrecorded(UNRECORDED);
    await mod.addUnrecorded(UNRECORDED);
    expect((await mod.loadUnrecorded())?.ids).toEqual([CARD_A, CARD_B]);
  });

  it("gives the row to the next person when the handset changes hands", async () => {
    // The one thing that replaces rather than merges. The previous member's
    // unreported cards are not this one's to hold on to — and mergeCollection
    // disowns their collected rows on this handset either way.
    const mod = await freshModule();
    await mod.addUnrecorded({ dayKey: "2026-07-28", identity: "m:p-alice", ids: [CARD_A] });
    await mod.addUnrecorded({ dayKey: "2026-07-28", identity: "m:p-bob", ids: [CARD_B] });
    const row = (await mod.loadUnrecorded())!;
    expect(row).toEqual({ dayKey: "2026-07-28", identity: "m:p-bob", ids: [CARD_B] });
  });

  it("lives beside the pack row rather than inside it", async () => {
    // Two rows in one store, because they retire at different moments: a pack
    // row lasts the day, an unrecorded row lasts until the league takes it. One
    // must never overwrite or shorten the other.
    const mod = await freshModule();
    const pack = { dayKey: "2026-07-28", ids: [CARD_A], revealed: [0] };
    await mod.savePackState(pack);
    await mod.addUnrecorded(UNRECORDED);
    expect(await mod.loadPackState()).toEqual(pack);

    await mod.retireUnrecorded([CARD_A, CARD_B]);
    expect(await mod.loadPackState()).toEqual(pack);
    expect(await mod.loadUnrecorded()).toBeNull();
  });

  it("leaves an existing collection alone", async () => {
    // The new key shares a store with the pack row, not with the collection —
    // and nothing here may bump the database version, because e2e/journeys.spec.ts
    // opens it at a hardcoded 2. See the note at the top of card-collection.ts.
    const mod = await freshModule();
    await mod.collectCard(CARD_A, "champion", "gold");
    await mod.addUnrecorded(UNRECORDED);
    const collection = await mod.loadCollection();
    // The exact key set, not just that CARD_A survived: loadCollection hands back
    // every key in the store, so a row written into the wrong one would sail past
    // an assertion that only looks at the card it already expects.
    expect(Object.keys(collection)).toEqual([CARD_A]);
    expect(collection[CARD_A]).toMatchObject({ tier: "champion", count: 1 });
  });

  it("announces every write, so an open vault re-reads what it may not delete", async () => {
    // useMyCollection holds these ids out of the prune and reads them on mount.
    // A record that lands on the pack screen has to reach a vault in another tab.
    const mod = await freshModule();
    const heard: string[] = [];
    const listen = () => heard.push("changed");
    window.addEventListener(mod.PACK_STATE_CHANGED, listen);
    try {
      await mod.addUnrecorded(UNRECORDED);
      await mod.retireUnrecorded([CARD_A, CARD_B]);
      await mod.savePackState({ dayKey: "2026-07-28", ids: [CARD_A], revealed: [] });
      expect(heard).toHaveLength(3);
    } finally {
      window.removeEventListener(mod.PACK_STATE_CHANGED, listen);
    }
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

  it("protects nothing, having collected nothing", async () => {
    // Symmetrical with the collection above: a device that cannot write a
    // collected row has none for the prune to delete either.
    const mod = await blockedModule();
    expect(await mod.loadUnrecorded()).toBeNull();
    await expect(
      mod.addUnrecorded({ dayKey: "2026-07-28", ids: [CARD_A] }),
    ).resolves.toBeUndefined();
    await expect(mod.retireUnrecorded([CARD_A])).resolves.toBeUndefined();
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
    expect(await mod.loadUnrecorded()).toBeNull();
    await expect(mod.collectCard(CARD_A, "base")).resolves.toBeUndefined();
    await expect(mod.clearCollection()).resolves.toBeUndefined();
    await expect(mod.primeCardMeta()).resolves.toBeUndefined();
  });
});
