// The one set of rules the board and the tier both read.
import { describe, it, expect, beforeEach } from "vitest";
import { makeBundle, makeParticipant, makeRun, resetFixtureIds } from "@/test/fixtures";
import { compareOfficialTime, outOfContention, standings } from "./standings";

beforeEach(() => {
  resetFixtureIds();
});

describe("compareOfficialTime", () => {
  it("sorts a run with no time last, not first", () => {
    // The state a live combine passes through: official ticked a beat before the
    // time is typed. `?? 0` showed that runner as the winner on the TV board.
    const rows = [{ official_time_ms: null }, { official_time_ms: 60_000 }];
    expect([...rows].sort(compareOfficialTime)).toEqual([
      { official_time_ms: 60_000 },
      { official_time_ms: null },
    ]);
  });
});

describe("outOfContention", () => {
  it("covers the whole dnf family, not just scratched", () => {
    const parts = ["scratched", "dq", "dnp", "absent", "finished"].map((s) =>
      makeParticipant({ participation_status: s }),
    );
    const out = outOfContention(makeBundle({ participants: parts }));
    expect(out.size).toBe(4);
    expect(out.has(parts[4].participant_id)).toBe(false);
  });

  it("counts a dq'd run even when the roster status is clean", () => {
    const p = makeParticipant({ participation_status: "finished" });
    const bundle = makeBundle({
      participants: [p],
      runs: [makeRun({ participant_id: p.participant_id, status: "dq" })],
    });
    expect(outOfContention(bundle).has(p.participant_id)).toBe(true);
  });
});

describe("standings", () => {
  it("gives a dead heat the same place", () => {
    // Two identical clocks used to draw 1 and 2 from their sort position while
    // both cards wore champion — the board contradicting the card beside it.
    const a = makeParticipant({ participation_status: "finished" });
    const b = makeParticipant({ participation_status: "finished" });
    const rows = standings(
      makeBundle({
        participants: [a, b],
        runs: [
          makeRun({ participant_id: a.participant_id, official_time_ms: 50_000 }),
          makeRun({ participant_id: b.participant_id, official_time_ms: 50_000 }),
        ],
      }),
    );
    expect(rows.map((r) => r.place)).toEqual([1, 1]);
  });

  it("lists a re-timed athlete once, at their best run", () => {
    const a = makeParticipant({ participation_status: "finished" });
    const rows = standings(
      makeBundle({
        participants: [a],
        runs: [
          makeRun({ participant_id: a.participant_id, official_time_ms: 70_000 }),
          makeRun({ participant_id: a.participant_id, official_time_ms: 55_000 }),
        ],
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].run.official_time_ms).toBe(55_000);
  });

  it("drops an athlete who is out of contention even with an official run", () => {
    const clean = makeParticipant({ participation_status: "finished" });
    const gone = makeParticipant({ participation_status: "scratched" });
    const rows = standings(
      makeBundle({
        participants: [clean, gone],
        runs: [
          makeRun({ participant_id: clean.participant_id, official_time_ms: 90_000 }),
          makeRun({ participant_id: gone.participant_id, official_time_ms: 40_000 }),
        ],
      }),
    );
    expect(rows.map((r) => r.participantId)).toEqual([clean.participant_id]);
    expect(rows[0].place).toBe(1);
  });

  it("ignores runs that are not official, and officials with no time", () => {
    const a = makeParticipant({ participation_status: "finished" });
    const b = makeParticipant({ participation_status: "finished" });
    const rows = standings(
      makeBundle({
        participants: [a, b],
        runs: [
          makeRun({ participant_id: a.participant_id, is_official: false }),
          makeRun({ participant_id: b.participant_id, official_time_ms: null }),
        ],
      }),
    );
    expect(rows).toEqual([]);
  });

  it("returns nothing for a bundle that has not landed", () => {
    expect(standings(null)).toEqual([]);
  });
});
