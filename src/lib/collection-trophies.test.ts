import { describe, expect, it } from "vitest";
import {
  completedIds,
  trophiesFor,
  trophySizeLabel,
  TROPHY_VIA,
  type CollectionTrophy,
} from "./collection-trophies";

const trophy = (over: Partial<CollectionTrophy> = {}): CollectionTrophy => ({
  participantId: "alice",
  collection: "pets",
  label: "Pets",
  size: 9,
  completedOn: "2026-07-28",
  via: "pull",
  ...over,
});

describe("TROPHY_VIA", () => {
  it("matches the CHECK constraint the column is stored against", () => {
    // The value lives in collection_trophies.via, so this list is append-only for
    // the same reason award category ids are: renaming one orphans every row
    // carrying it. If a migration adds a fifth source, it is added here too —
    // never renamed.
    expect([...TROPHY_VIA]).toEqual(["pull", "trade", "grant", "claim"]);
  });
});

describe("trophySizeLabel", () => {
  it("says how big the set was, in the singular when it was one card", () => {
    expect(trophySizeLabel(9)).toBe("9 cards");
    expect(trophySizeLabel(1)).toBe("1 card");
  });
});

describe("trophiesFor", () => {
  it("keeps only this person's, newest first", () => {
    const mine = trophy({ collection: "pets", completedOn: "2026-07-28" });
    const older = trophy({ collection: "wags", label: "WAGs", completedOn: "2026-07-01" });
    const theirs = trophy({ participantId: "bob", collection: "cornhole" });

    expect(trophiesFor([older, theirs, mine], "alice").map((t) => t.collection)).toEqual([
      "pets",
      "wags",
    ]);
  });

  it("breaks a same-day tie on the label, so the shelf does not reshuffle itself", () => {
    // Two sets finished by the same trade land on the same date. Without a second
    // key the order is whatever Postgres returned, which changes between refetches
    // and makes a shelf that visibly jumps.
    const a = trophy({ collection: "wags", label: "WAGs" });
    const b = trophy({ collection: "pets", label: "Pets" });
    expect(trophiesFor([a, b], "alice").map((t) => t.label)).toEqual(["Pets", "WAGs"]);
  });

  it("is empty for a device with no identity yet", () => {
    // Not an error: a phone that has not claimed a player has no trophies, and
    // the shelf simply does not appear.
    expect(trophiesFor([trophy()], null)).toEqual([]);
    expect(trophiesFor([trophy()], undefined)).toEqual([]);
  });
});

describe("completedIds", () => {
  it("answers 'is this set done' for the card back and the shelf heading", () => {
    const ids = completedIds(
      [trophy(), trophy({ participantId: "bob", collection: "wags" })],
      "alice",
    );
    expect(ids.has("pets")).toBe(true);
    // Bob's finished set is not Alice's badge.
    expect(ids.has("wags")).toBe(false);
  });
});
