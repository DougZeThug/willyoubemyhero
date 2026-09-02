import { describe, expect, it } from "vitest";
import { mergeCollection } from "./collection-merge";
import type { CollectedCard } from "./card-collection";
import type { MyCard } from "./card-pulls";

/** Two ages of local row, from either side of the collect-on-sight removal. */
const AFTER = Date.UTC(2026, 6, 31);
const BEFORE = Date.UTC(2026, 6, 20);

function card(id: string, pulledAt = AFTER, count = 1, tier = "base"): CollectedCard {
  return { eventParticipantId: id, pulledAt, count, tier };
}

function served(
  id: string,
  pullCount = 1,
  firstPulledAt = "2026-07-31T18:16:03.777Z",
  edition = "standard",
): MyCard {
  return { eventParticipantId: id, pullCount, edition, firstPulledAt };
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
  it("never deletes anything, however old the row is", () => {
    // There is no server record to adjudicate a guest's rows, and a browse and a
    // pull wrote identical ones before collect-on-sight was removed. Guessing
    // wrong deletes a card nothing can restore, so nothing is guessed.
    const ids = roster(18);
    const { collection, stale } = mergeCollection(localFor(ids, BEFORE), null, new Set(ids));
    expect(Object.keys(collection)).toHaveLength(18);
    expect(stale).toEqual([]);
  });

  it("hands back the local store untouched, old and new alike", () => {
    const ids = roster(3);
    const local = {
      [ids[0]]: card(ids[0], BEFORE),
      [ids[1]]: card(ids[1], AFTER),
      [ids[2]]: card(ids[2], BEFORE, 4, "champion"),
    };
    const { collection, stale } = mergeCollection(local, null, new Set(ids));
    expect(collection).toEqual(local);
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

describe("mergeCollection, reconciling a finish", () => {
  const withEdition = (id: string, edition: string): CollectedCard => ({
    ...card(id),
    edition,
  });

  it("adopts the server's finish for a card this device knows nothing about", () => {
    const { collection } = mergeCollection(
      {},
      [served("ep-0", 1, "2026-07-31T18:16:03.777Z", "gold")],
      new Set(["ep-0"]),
    );
    expect(collection["ep-0"].edition).toBe("gold");
  });

  it("takes the server's finish even when the local one is better", () => {
    // THIS USED TO ASSERT THE OPPOSITE, and trading is why it flipped.
    //
    // `card_pulls.edition` is derived from the copies you hold, so trading your
    // only platinum away lowers it — correctly. Taking the better of the two would
    // pin that platinum on the giver's own device forever: a card they no longer
    // own, in a finish that now belongs to somebody else.
    //
    // The cost, stated honestly: a pull this device recorded locally but never
    // managed to report is now demoted rather than preserved. That is the same
    // bargain `count` has always made a line above — it takes the server's number
    // outright — and having the two disagree was the real inconsistency.
    const { collection } = mergeCollection(
      { "ep-0": withEdition("ep-0", "platinum") },
      [served("ep-0", 1, "2026-07-31T18:16:03.777Z", "standard")],
      new Set(["ep-0"]),
    );
    expect(collection["ep-0"].edition).toBe("standard");
  });

  it("takes the server's finish when it is the better of the two", () => {
    // The other direction: pulled on a second phone, so this device has never
    // seen the good copy.
    const { collection } = mergeCollection(
      { "ep-0": withEdition("ep-0", "bronze") },
      [served("ep-0", 1, "2026-07-31T18:16:03.777Z", "gold")],
      new Set(["ep-0"]),
    );
    expect(collection["ep-0"].edition).toBe("gold");
  });

  it("falls back to standard when neither side has one", () => {
    const { collection } = mergeCollection(
      { "ep-0": card("ep-0") },
      [served("ep-0")],
      new Set(["ep-0"]),
    );
    expect(collection["ep-0"].edition).toBe("standard");
  });

  it("leaves a guest's finishes alone, having nothing to reconcile against", () => {
    // server === null is "not a claimed member", not "you own nothing".
    const local = { "ep-0": withEdition("ep-0", "platinum") };
    const { collection } = mergeCollection(local, null, new Set(["ep-0"]));
    expect(collection["ep-0"].edition).toBe("platinum");
  });
});

describe("mergeCollection, holding a pull the server has not been told about", () => {
  // `recordCardPulls` is fire-and-forget and can fail for a whole day. The rule
  // above — the server replaces the local store outright — then deleted exactly
  // the pulls nobody had managed to report, which are the ones with no second
  // copy anywhere. Silence from a server that was never asked is not a verdict.
  const ids = roster(4);

  it("keeps a protected card the server does not list, and never calls it stale", () => {
    const { collection, stale } = mergeCollection(
      localFor(ids, AFTER),
      [served(ids[0])],
      new Set(ids),
      new Set([ids[1]]),
    );

    expect(collection[ids[1]]).toBeDefined();
    expect(stale).not.toContain(ids[1]);
  });

  it("hands the protected card back exactly as this device recorded it", () => {
    // Straight out of `local`. There is no server row to take anything from —
    // that is the whole situation — so the tier and count the pull was made at
    // are all there is.
    const mine = card(ids[0], AFTER, 2, "champion");
    const { collection } = mergeCollection({ [ids[0]]: mine }, [], new Set(ids), new Set([ids[0]]));
    expect(collection[ids[0]]).toEqual(mine);
  });

  it("still disowns everything the protection does not cover", () => {
    // The protection is a named list of ids, not an amnesty. A collect-on-sight
    // row beside a genuine unreported pull is still a collect-on-sight row.
    const { collection, stale } = mergeCollection(
      localFor(ids, BEFORE),
      [served(ids[0])],
      new Set(ids),
      new Set([ids[1]]),
    );

    expect(stale.sort()).toEqual([ids[2], ids[3]].sort());
    expect(collection[ids[2]]).toBeUndefined();
  });

  it("gives way to the server the moment it does list the card", () => {
    // The record landed after all. Protection buys a card the benefit of the
    // doubt until the league answers, never a better number than the league's.
    const { collection, stale } = mergeCollection(
      { [ids[0]]: card(ids[0], AFTER, 9, "champion") },
      [served(ids[0], 2)],
      new Set(ids),
      new Set([ids[0]]),
    );

    expect(collection[ids[0]].count).toBe(2);
    expect(collection[ids[0]].tier).toBe("champion");
    expect(stale).toEqual([]);
  });

  it("protects nothing for a guest, who was never being pruned", () => {
    const local = localFor(ids, BEFORE);
    const { collection, stale } = mergeCollection(local, null, new Set(ids), new Set([ids[0]]));
    expect(collection).toEqual(local);
    expect(stale).toEqual([]);
  });

  it("does not invent a card the device never collected", () => {
    // A dealt id is protected from the moment the pack is filed, but a card that
    // has not been turned over yet has no local row — and this must not conjure
    // one, or the vault would light up cards nobody has looked at.
    const { collection } = mergeCollection({}, [], new Set(ids), new Set([ids[0]]));
    expect(collection).toEqual({});
  });
});
