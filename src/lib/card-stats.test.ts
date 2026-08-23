// Per-station comparison maths behind the card back and the player breakdown.
import { beforeEach, describe, expect, it } from "vitest";
import { bestTimesByParticipant, cardStats, median } from "./card-stats";
import {
  makeBundle,
  makeFieldBundle,
  makeParticipant,
  makeRun,
  makeSplit,
  makeStation,
  resetFixtureIds,
} from "@/test/fixtures";

beforeEach(resetFixtureIds);

describe("median", () => {
  it("returns null for an empty list", () => {
    expect(median([])).toBeNull();
  });

  it("returns the single value for a one-element list", () => {
    expect(median([42])).toBe(42);
  });

  it("takes the middle of an odd-length list", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("averages the middle pair of an even-length list", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("sorts numerically, not lexicographically", () => {
    // [9, 10, 100] sorts to ["10", "100", "9"] under the default comparator.
    expect(median([100, 9, 10])).toBe(10);
  });

  it("does not mutate its input", () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe("bestTimesByParticipant", () => {
  it("is empty when nobody has an official time", () => {
    const p = makeParticipant();
    const bundle = makeBundle({
      runs: [makeRun({ participant_id: p.participant_id, is_official: false })],
    });
    expect(bestTimesByParticipant(bundle).size).toBe(0);
  });

  it("keeps each participant's fastest official run", () => {
    const p = makeParticipant();
    const bundle = makeBundle({
      runs: [
        makeRun({ participant_id: p.participant_id, official_time_ms: 30_000 }),
        makeRun({ participant_id: p.participant_id, official_time_ms: 20_000 }),
        makeRun({ participant_id: p.participant_id, official_time_ms: 40_000 }),
      ],
    });
    const best = bestTimesByParticipant(bundle);
    expect(best.size).toBe(1);
    expect(best.get(p.participant_id)).toBe(20_000);
  });

  it("skips runs with no recorded time", () => {
    const p = makeParticipant();
    const bundle = makeBundle({
      runs: [
        makeRun({ participant_id: p.participant_id, official_time_ms: null }),
        makeRun({ participant_id: p.participant_id, official_time_ms: 25_000 }),
      ],
    });
    expect(bestTimesByParticipant(bundle).get(p.participant_id)).toBe(25_000);
  });
});

describe("cardStats", () => {
  it("returns the empty shape without a bundle", () => {
    expect(cardStats(null, "someone")).toEqual({
      bestRun: null,
      ladder: [],
      rank: null,
      fieldSize: 0,
    });
  });

  it("returns the empty shape without a participant", () => {
    const { bundle } = makeFieldBundle();
    expect(cardStats(bundle, null)).toEqual({
      bestRun: null,
      ladder: [],
      rank: null,
      fieldSize: 0,
    });
  });

  it("ranks the fastest participant first", () => {
    const { bundle, alice } = makeFieldBundle();
    const stats = cardStats(bundle, alice.participant_id);
    expect(stats.rank).toBe(1);
    expect(stats.fieldSize).toBe(4);
    expect(stats.bestRun?.official_time_ms).toBe(50_000);
  });

  it("ranks by how many people are strictly faster", () => {
    const { bundle, carol } = makeFieldBundle();
    expect(cardStats(bundle, carol.participant_id).rank).toBe(4);
  });

  it("gives tied times the same rank", () => {
    const a = makeParticipant();
    const b = makeParticipant();
    const c = makeParticipant();
    const bundle = makeBundle({
      runs: [
        makeRun({ participant_id: a.participant_id, official_time_ms: 10_000 }),
        makeRun({ participant_id: b.participant_id, official_time_ms: 10_000 }),
        makeRun({ participant_id: c.participant_id, official_time_ms: 20_000 }),
      ],
    });
    expect(cardStats(bundle, a.participant_id).rank).toBe(1);
    expect(cardStats(bundle, b.participant_id).rank).toBe(1);
    expect(cardStats(bundle, c.participant_id).rank).toBe(3);
  });

  it("has no rank and no best run for someone who never ran", () => {
    const { bundle, dave } = makeFieldBundle();
    const stats = cardStats(bundle, dave.participant_id);
    expect(stats.rank).toBeNull();
    expect(stats.bestRun).toBeNull();
    // The ladder still lists every station, just with no times of their own.
    expect(stats.ladder).toHaveLength(2);
    expect(stats.ladder.every((row) => row.ms === null)).toBe(true);
  });

  it("uses the participant's best run, not their most recent", () => {
    const p = makeParticipant();
    const other = makeParticipant();
    const bundle = makeBundle({
      runs: [
        makeRun({ participant_id: p.participant_id, official_time_ms: 90_000 }),
        makeRun({ participant_id: p.participant_id, official_time_ms: 30_000 }),
        makeRun({ participant_id: other.participant_id, official_time_ms: 60_000 }),
      ],
    });
    const stats = cardStats(bundle, p.participant_id);
    expect(stats.bestRun?.official_time_ms).toBe(30_000);
    expect(stats.rank).toBe(1);
  });

  describe("ladder", () => {
    it("follows station_order, not insertion order", () => {
      const first = makeStation({ name: "First", station_order: 1 });
      const second = makeStation({ name: "Second", station_order: 2 });
      const third = makeStation({ name: "Third", station_order: 3 });
      const bundle = makeBundle({ stations: [third, first, second] });
      const p = makeParticipant();
      expect(cardStats(bundle, p.participant_id).ladder.map((r) => r.label)).toEqual([
        "First",
        "Second",
        "Third",
      ]);
    });

    it("prefers short_name for the label and falls back to name", () => {
      const { bundle, alice } = makeFieldBundle();
      expect(cardStats(bundle, alice.participant_id).ladder.map((r) => r.label)).toEqual([
        "SLED",
        "BEER",
      ]);

      const named = makeStation({ name: "Tyre Flip", short_name: null });
      const solo = makeBundle({ stations: [named] });
      expect(cardStats(solo, alice.participant_id).ladder[0].label).toBe("Tyre Flip");
    });

    it("reports a negative delta for a faster-than-median split", () => {
      const station = makeStation();
      const fast = makeParticipant();
      const mid = makeParticipant();
      const slow = makeParticipant();
      const runs = [fast, mid, slow].map((p, i) =>
        makeRun({ participant_id: p.participant_id, official_time_ms: (i + 1) * 10_000 }),
      );
      const bundle = makeBundle({
        stations: [station],
        runs,
        splits: [
          makeSplit({ run_id: runs[0].id, station_id: station.id, segment_time_ms: 1_000 }),
          makeSplit({ run_id: runs[1].id, station_id: station.id, segment_time_ms: 2_000 }),
          makeSplit({ run_id: runs[2].id, station_id: station.id, segment_time_ms: 3_000 }),
        ],
      });
      // Median of [1000, 2000, 3000] is 2000.
      expect(cardStats(bundle, fast.participant_id).ladder[0].deltaMs).toBe(-1_000);
      expect(cardStats(bundle, mid.participant_id).ladder[0].deltaMs).toBe(0);
      expect(cardStats(bundle, slow.participant_id).ladder[0].deltaMs).toBe(1_000);
    });

    it("leaves the delta null when the participant has no split there", () => {
      const { bundle, dave } = makeFieldBundle();
      expect(cardStats(bundle, dave.participant_id).ladder[0].deltaMs).toBeNull();
    });

    it("flags the fastest split at a station as best", () => {
      const { bundle, carol, alice } = makeFieldBundle();
      const carolLadder = cardStats(bundle, carol.participant_id).ladder;
      // Carol owns station A (10s vs everyone else's 20s+).
      expect(carolLadder[0].best).toBe(true);
      expect(carolLadder[1].best).toBe(false);
      expect(cardStats(bundle, alice.participant_id).ladder[0].best).toBe(false);
    });

    it("flags a tie for fastest as best for both", () => {
      const station = makeStation();
      const a = makeParticipant();
      const b = makeParticipant();
      const runs = [a, b].map((p, i) =>
        makeRun({ participant_id: p.participant_id, official_time_ms: (i + 1) * 10_000 }),
      );
      const bundle = makeBundle({
        stations: [station],
        runs,
        splits: runs.map((r) =>
          makeSplit({ run_id: r.id, station_id: station.id, segment_time_ms: 5_000 }),
        ),
      });
      expect(cardStats(bundle, a.participant_id).ladder[0].best).toBe(true);
      expect(cardStats(bundle, b.participant_id).ladder[0].best).toBe(true);
    });

    it("places each split against everyone who ran that station", () => {
      const station = makeStation();
      const fast = makeParticipant();
      const mid = makeParticipant();
      const slow = makeParticipant();
      const runs = [fast, mid, slow].map((p, i) =>
        makeRun({ participant_id: p.participant_id, official_time_ms: (i + 1) * 10_000 }),
      );
      const bundle = makeBundle({
        stations: [station],
        runs,
        splits: [
          makeSplit({ run_id: runs[0].id, station_id: station.id, segment_time_ms: 1_000 }),
          makeSplit({ run_id: runs[1].id, station_id: station.id, segment_time_ms: 2_000 }),
          makeSplit({ run_id: runs[2].id, station_id: station.id, segment_time_ms: 3_000 }),
        ],
      });
      expect(cardStats(bundle, fast.participant_id).ladder[0].place).toBe(1);
      expect(cardStats(bundle, mid.participant_id).ladder[0].place).toBe(2);
      expect(cardStats(bundle, slow.participant_id).ladder[0].place).toBe(3);
      expect(cardStats(bundle, fast.participant_id).ladder[0].fieldCount).toBe(3);
    });

    it("shares a place on a dead heat", () => {
      const station = makeStation();
      const a = makeParticipant();
      const b = makeParticipant();
      const runs = [a, b].map((p, i) =>
        makeRun({ participant_id: p.participant_id, official_time_ms: (i + 1) * 10_000 }),
      );
      const bundle = makeBundle({
        stations: [station],
        runs,
        splits: runs.map((r) =>
          makeSplit({ run_id: r.id, station_id: station.id, segment_time_ms: 5_000 }),
        ),
      });
      expect(cardStats(bundle, a.participant_id).ladder[0].place).toBe(1);
      expect(cardStats(bundle, b.participant_id).ladder[0].place).toBe(1);
    });

    it("leaves the place null when the participant has no split there", () => {
      const { bundle, dave } = makeFieldBundle();
      expect(cardStats(bundle, dave.participant_id).ladder[0].place).toBeNull();
    });



    it("does not let a participant's re-run skew the field median", () => {
      // One participant recording a second, much slower split at a station
      // would otherwise drag the median up and flatter everybody.
      const station = makeStation();
      const a = makeParticipant();
      const b = makeParticipant();
      const c = makeParticipant();
      const aRun = makeRun({ participant_id: a.participant_id, official_time_ms: 10_000 });
      const aRerun = makeRun({ participant_id: a.participant_id, official_time_ms: 99_000 });
      const bRun = makeRun({ participant_id: b.participant_id, official_time_ms: 20_000 });
      const cRun = makeRun({ participant_id: c.participant_id, official_time_ms: 30_000 });
      const bundle = makeBundle({
        stations: [station],
        runs: [aRun, aRerun, bRun, cRun],
        splits: [
          makeSplit({ run_id: aRun.id, station_id: station.id, segment_time_ms: 1_000 }),
          makeSplit({ run_id: aRerun.id, station_id: station.id, segment_time_ms: 90_000 }),
          makeSplit({ run_id: bRun.id, station_id: station.id, segment_time_ms: 2_000 }),
          makeSplit({ run_id: cRun.id, station_id: station.id, segment_time_ms: 3_000 }),
        ],
      });
      // One split per participant: [1000, 2000, 3000] → median 2000, not the
      // [1000, 2000, 3000, 90000] → 2500 a naive pass would produce.
      expect(cardStats(bundle, b.participant_id).ladder[0].deltaMs).toBe(0);
    });

    it("ignores splits with no recorded segment time", () => {
      const station = makeStation();
      const p = makeParticipant();
      const run = makeRun({ participant_id: p.participant_id, official_time_ms: 10_000 });
      const bundle = makeBundle({
        stations: [station],
        runs: [run],
        splits: [makeSplit({ run_id: run.id, station_id: station.id, segment_time_ms: null })],
      });
      const row = cardStats(bundle, p.participant_id).ladder[0];
      expect(row.ms).toBeNull();
      expect(row.deltaMs).toBeNull();
      expect(row.best).toBe(false);
    });
  });
});
