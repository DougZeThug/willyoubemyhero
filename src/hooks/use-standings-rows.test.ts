import { beforeEach, describe, expect, it } from "vitest";
import { standingsRows } from "./use-standings-rows";
import { makeBundle, makeParticipant, makeRun, resetFixtureIds } from "@/test/fixtures";

describe("standingsRows", () => {
  beforeEach(() => resetFixtureIds());

  it("is empty without a bundle", () => {
    expect(standingsRows(null)).toEqual([]);
  });

  it("pairs each placed run with its roster entry, fastest first", () => {
    const slow = makeParticipant();
    const fast = makeParticipant();
    const bundle = makeBundle({
      participants: [slow, fast],
      runs: [
        makeRun({ participant_id: slow.participant_id, official_time_ms: 90_000 }),
        makeRun({ participant_id: fast.participant_id, official_time_ms: 80_000 }),
      ],
    });
    const rows = standingsRows(bundle);
    expect(rows.map((r) => r.ep)).toEqual([fast, slow]);
    expect(rows.map((r) => r.place)).toEqual([1, 2]);
  });
});
