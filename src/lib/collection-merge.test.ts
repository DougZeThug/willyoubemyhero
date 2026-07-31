import { describe, expect, it } from "vitest";
import { LEGACY_CUTOFF_MS, mergeCollection } from "./collection-merge";
import type { CollectedCard } from "./card-collection";
import type { MyCard } from "./card-pulls";

const AFTER = LEGACY_CUTOFF_MS + 86_400_000;
const BEFORE = LEGACY_CUTOFF_MS - 86_400_000;

function card(id: string, pulledAt = AFTER, count = 1, tier = "base"): CollectedCard {
  return { eventParticipantId: id, pulledAt, count, tier };
}

function served(id: string, pullCount = 1, firstPulledAt = "2026-07-31T18:16:03.777Z"): MyCard {
  return { eventParticipantId: id, pullCount, firstPulledAt };
}

const roster = (n: number) => Array.from({ length: n }, (_, i) => `ep-${i}`);
const localFor = (ids: string[], pulledAt = BEFORE) =>
  Object.fromEntries(ids.map((id) => [id, card(id, pulledAt)]));

describe("mergeCollection, for a claimed member", () => {
  it("takes eighteen browsed cards down to the three that were actually pulled", () => {
    // The bug this whole module exists for. Collect-on-sight wrote one row per
    // card walked; the server has one row per card pulled. A live check found
    // exactly three rows against a device claiming all eighteen.
    const ids = roster(18);
    const { collection, stale } = mergeCollection(
      localFor(ids),
      [served(ids[0]), served(ids[1]), served(ids[2])],
      new Set(ids),
    );

    expect(Object.keys(collection).sort()).toEqual([ids[0], ids[1], ids[2]].sort());
    expect(stale).toHaveLength(15);
    expect(stale).not.toContain(ids[0]);
  });

  it("disowns a recent local row too — the server is the whole truth, not a floor", () => {
    // A row written after the cutoff is not automatically genuine: a guest pull
    // on a shared phone lands there, and it is not this member's card.
    const ids = roster(3);
    const { collection, stale } = mergeCollection(
      { [ids[0]]: card(ids[0], AFTER), [ids[1]]: card(ids[1], AFTER) },
      [served(ids[0])],
      new Set(ids),
    );
    expect(Object.keys(collection)).toEqual([ids[0]]);
    expect(stale).toEqual([ids[1]]);
  });

  it("adopts a card pulled on another phone, which is the point of the server round trip", () => {
    const ids = roster(2);
    const { collection, stale } = mergeCollection({}, [served(ids[1], 2)], new Set(ids));
    expect(collection[ids[1]].count).toBe(2);
    expect(stale).toEqual([]);
  });

  it("keeps the server's pull count rather than the device's", () => {
    const ids = roster(1);
    const { collection } = mergeCollection(
      { [ids[0]]: card(ids[0], AFTER, 9) },
      [served(ids[0], 2)],
      new Set(ids),
    );
    expect(collection[ids[0]].count).toBe(2);
  });

  it("borrows tier from the local row, and falls back to base when there is none", () => {
    // Postgres has no column for it — it is a colour, not a number.
    const ids = roster(2);
    const { collection } = mergeCollection(
      { [ids[0]]: card(ids[0], AFTER, 1, "champion") },
      [served(ids[0]), served(ids[1])],
      new Set(ids),
    );
    expect(collection[ids[0]].tier).toBe("champion");
    expect(collection[ids[1]].tier).toBe("base");
  });

  it("dates a card from the server's first pull", () => {
    const ids = roster(1);
    const { collection } = mergeCollection(
      { [ids[0]]: card(ids[0], BEFORE) },
      [served(ids[0], 1, "2026-07-31T18:16:03.777Z")],
      new Set(ids),
    );
    expect(collection[ids[0]].pulledAt).toBe(Date.parse("2026-07-31T18:16:03.777Z"));
  });

  it("leaves another event's cards alone, and never deletes them", () => {
    const ids = roster(2);
    const { collection, stale } = mergeCollection(
      { ...localFor(ids), "other-event-ep": card("other-event-ep", BEFORE) },
      [served(ids[0])],
      new Set(ids),
    );
    expect(collection["other-event-ep"]).toBeDefined();
    expect(stale).toEqual([ids[1]]);
  });

  it("empties a collection the server has no rows for", () => {
    const ids = roster(18);
    const { collection, stale } = mergeCollection(localFor(ids), [], new Set(ids));
    expect(collection).toEqual({});
    expect(stale).toHaveLength(18);
  });
});

describe("mergeCollection, for a guest", () => {
  it("drops the pre-cutoff rows and keeps the genuine ones", () => {
    // No identity, so the deploy date of the collect-on-sight fix is the only
    // evidence there is.
    const ids = roster(3);
    const { collection, stale } = mergeCollection(
      {
        [ids[0]]: card(ids[0], BEFORE),
        [ids[1]]: card(ids[1], AFTER),
        [ids[2]]: card(ids[2], BEFORE),
      },
      null,
      new Set(ids),
    );
    expect(Object.keys(collection)).toEqual([ids[1]]);
    expect(stale.sort()).toEqual([ids[0], ids[2]].sort());
  });

  it("keeps a row written exactly on the cutoff", () => {
    const ids = roster(1);
    const { collection, stale } = mergeCollection(
      { [ids[0]]: card(ids[0], LEGACY_CUTOFF_MS) },
      null,
      new Set(ids),
    );
    expect(collection[ids[0]]).toBeDefined();
    expect(stale).toEqual([]);
  });

  it("does not judge a card outside this event's roster", () => {
    const { collection, stale } = mergeCollection(
      { stranger: card("stranger", BEFORE) },
      null,
      new Set(["ep-0"]),
    );
    expect(collection.stranger).toBeDefined();
    expect(stale).toEqual([]);
  });

  it("handles an empty store without inventing work", () => {
    expect(mergeCollection({}, null, new Set(roster(3)))).toEqual({ collection: {}, stale: [] });
  });
});
