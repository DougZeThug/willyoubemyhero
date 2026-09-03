// Tier assignment. Nothing here is random — a champion card looks different
// because someone actually won — so every branch is worth pinning.
import { beforeEach, describe, expect, it } from "vitest";
import { rarityMap, rarityStyle, TIER_REASON, type RarityTier } from "./card-rarity";
import {
  makeBundle,
  makeFieldBundle,
  makeParticipant,
  makePenalty,
  makeRun,
  makeSplit,
  makeStation,
  resetFixtureIds,
} from "@/test/fixtures";

const ALL_TIERS: RarityTier[] = ["champion", "podium", "stationKing", "penaltyBox", "dnf", "base"];

beforeEach(resetFixtureIds);

describe("rarityStyle", () => {
  it("still knows exactly the six persisted tier ids", () => {
    // Written out rather than derived from ALL_TIERS: these strings live in
    // event_participants.card_rarity, so a rename orphans every row holding the
    // old one — and an expectation built from the same constant a rename would
    // move pins nothing. Colours and labels are free to change; the ids are not.
    for (const id of ["base", "champion", "dnf", "penaltyBox", "podium", "stationKing"]) {
      expect(rarityStyle(id as RarityTier).tier).toBe(id);
    }
    expect(Object.keys(TIER_REASON).sort()).toEqual([
      "base",
      "champion",
      "dnf",
      "penaltyBox",
      "podium",
      "stationKing",
    ]);
  });

  it("keeps the base tier off the house cyan", () => {
    // --primary is oklch(0.82 0.14 210) and base's foil and accent used to be
    // exactly that, so a base card and a button were the same object on screen.
    // The regression is somebody re-syncing them "back" to the brand colour.
    const base = rarityStyle("base");
    expect(base.holoA).not.toBe("oklch(0.82 0.14 210)");
    expect(base.accent).not.toBe("oklch(0.82 0.14 210)");
  });

  it("glows for the top two tiers and nothing below them", () => {
    // One scale of glow (§8): the tile bloom is what makes a champion special,
    // and it only does that while the rest of the shelf stays flat.
    expect(rarityStyle("champion").glow).toBe(true);
    expect(rarityStyle("podium").glow).toBe(true);
    for (const tier of ["stationKing", "base", "penaltyBox", "dnf"] as const) {
      expect(rarityStyle(tier).glow).toBeFalsy();
    }
  });

  it("returns a style for every tier, with the tier echoed back", () => {
    for (const tier of ALL_TIERS) {
      const style = rarityStyle(tier);
      expect(style.tier).toBe(tier);
      expect(style.label).toBeTruthy();
      expect(style.strength).toBeGreaterThanOrEqual(0);
      expect(style.strength).toBeLessThanOrEqual(1);
      expect(style.sparkle).toBeGreaterThanOrEqual(0);
      expect(style.sparkle).toBeLessThanOrEqual(1);
    }
  });

  it("ranks tiers best to worst with no duplicates", () => {
    const ranks = ALL_TIERS.map((t) => rarityStyle(t).rank);
    expect(new Set(ranks).size).toBe(ALL_TIERS.length);
    expect(rarityStyle("champion").rank).toBeLessThan(rarityStyle("podium").rank);
    expect(rarityStyle("base").rank).toBeLessThan(rarityStyle("dnf").rank);
  });

  it("gives every tier a reason blurb", () => {
    // TIER_REASON and RARITY are two maps over the same union; drift between
    // them shows up as a missing badge on the card back, not a type error.
    for (const tier of ALL_TIERS) {
      expect(TIER_REASON[tier]).toBeTruthy();
    }
    expect(Object.keys(TIER_REASON).sort()).toEqual([...ALL_TIERS].sort());
  });

  it("gives the accent colour of every tier an opaque value", () => {
    // `border` is deliberately translucent for base and dnf; `accent` must not
    // be, or page chrome in that colour is invisible.
    for (const tier of ALL_TIERS) {
      expect(rarityStyle(tier).accent).not.toMatch(/\/\s*\d+%/);
    }
  });
});

describe("rarityMap", () => {
  it("returns an empty map for a missing bundle", () => {
    expect(rarityMap(null).size).toBe(0);
    expect(rarityMap(undefined).size).toBe(0);
  });

  it("returns an empty map when the event has no participants", () => {
    expect(rarityMap(makeBundle()).size).toBe(0);
  });

  it("assigns base to everyone before any official run exists", () => {
    const a = makeParticipant();
    const b = makeParticipant();
    const map = rarityMap(makeBundle({ participants: [a, b] }));
    expect(map.get(a.id)?.tier).toBe("base");
    expect(map.get(b.id)?.tier).toBe("base");
  });

  it("keys the map by event_participant id, not participant id", () => {
    const a = makeParticipant();
    const map = rarityMap(makeBundle({ participants: [a] }));
    expect(map.has(a.id)).toBe(true);
    expect(map.has(a.participant_id)).toBe(false);
  });

  it("awards champion, podium and stationKing off real results", () => {
    const { bundle, alice, bob, carol } = makeFieldBundle();
    const map = rarityMap(bundle);
    expect(map.get(alice.id)?.tier).toBe("champion");
    expect(map.get(bob.id)?.tier).toBe("podium");
    expect(map.get(carol.id)?.tier).toBe("stationKing");
  });

  it("gives third place podium too", () => {
    const first = makeParticipant();
    const second = makeParticipant();
    const third = makeParticipant();
    const bundle = makeBundle({
      participants: [first, second, third],
      runs: [
        makeRun({ participant_id: first.participant_id, official_time_ms: 10_000 }),
        makeRun({ participant_id: second.participant_id, official_time_ms: 20_000 }),
        makeRun({ participant_id: third.participant_id, official_time_ms: 30_000 }),
      ],
    });
    const map = rarityMap(bundle);
    expect(map.get(second.id)?.tier).toBe("podium");
    expect(map.get(third.id)?.tier).toBe("podium");
  });

  it("drops fourth place back to base", () => {
    const parts = [0, 1, 2, 3].map(() => makeParticipant());
    const bundle = makeBundle({
      participants: parts,
      runs: parts.map((p, i) =>
        makeRun({ participant_id: p.participant_id, official_time_ms: (i + 1) * 10_000 }),
      ),
    });
    expect(rarityMap(bundle).get(parts[3].id)?.tier).toBe("base");
  });

  it("ignores unofficial runs and runs with no recorded time", () => {
    const ghost = makeParticipant();
    const real = makeParticipant();
    const bundle = makeBundle({
      participants: [ghost, real],
      runs: [
        // Faster, but not official — must not steal the championship.
        makeRun({ participant_id: ghost.participant_id, official_time_ms: 1_000, is_official: false }), // prettier-ignore
        makeRun({ participant_id: ghost.participant_id, official_time_ms: null }),
        makeRun({ participant_id: real.participant_id, official_time_ms: 50_000 }),
      ],
    });
    const map = rarityMap(bundle);
    expect(map.get(real.id)?.tier).toBe("champion");
    expect(map.get(ghost.id)?.tier).toBe("base");
  });

  it("uses a participant's best run, so a slower re-run cannot demote them", () => {
    const alice = makeParticipant();
    const bob = makeParticipant();
    const bundle = makeBundle({
      participants: [alice, bob],
      runs: [
        makeRun({ participant_id: alice.participant_id, official_time_ms: 10_000 }),
        // Alice runs again and blows up. Her best is still the fastest.
        makeRun({ participant_id: alice.participant_id, official_time_ms: 99_000 }),
        makeRun({ participant_id: bob.participant_id, official_time_ms: 20_000 }),
      ],
    });
    const map = rarityMap(bundle);
    expect(map.get(alice.id)?.tier).toBe("champion");
    expect(map.get(bob.id)?.tier).toBe("podium");
  });

  describe("dnf", () => {
    it.each(["scratched", "dq", "dnp", "absent"])(
      "marks participation_status %s as dnf",
      (status) => {
        const p = makeParticipant({ participation_status: status });
        expect(rarityMap(makeBundle({ participants: [p] })).get(p.id)?.tier).toBe("dnf");
      },
    );

    it("does not mark queued, running or finished as dnf", () => {
      for (const status of ["queued", "running", "finished"]) {
        const p = makeParticipant({ participation_status: status });
        expect(rarityMap(makeBundle({ participants: [p] })).get(p.id)?.tier).toBe("base");
      }
    });

    it("marks a participant with a disqualified run as dnf", () => {
      const p = makeParticipant();
      const bundle = makeBundle({
        participants: [p],
        runs: [makeRun({ participant_id: p.participant_id, status: "dq" })],
      });
      expect(rarityMap(bundle).get(p.id)?.tier).toBe("dnf");
    });

    it("beats a winning time — a dq is a dq even if the clock said otherwise", () => {
      const cheat = makeParticipant();
      const honest = makeParticipant();
      const bundle = makeBundle({
        participants: [cheat, honest],
        runs: [
          makeRun({
            participant_id: cheat.participant_id,
            official_time_ms: 10_000,
            status: "dq",
          }),
          makeRun({ participant_id: honest.participant_id, official_time_ms: 20_000 }),
        ],
      });
      expect(rarityMap(bundle).get(cheat.id)?.tier).toBe("dnf");
    });

    it("hands champion to the fastest legal runner, not just dnf to the cheat", () => {
      // The other half of the test above: the dq'd clock must not keep
      // consuming place 1, or the event ends with no champion at all.
      const cheat = makeParticipant();
      const honest = makeParticipant();
      const third = makeParticipant();
      const bundle = makeBundle({
        participants: [cheat, honest, third],
        runs: [
          makeRun({ participant_id: cheat.participant_id, official_time_ms: 10_000, status: "dq" }), // prettier-ignore
          makeRun({ participant_id: honest.participant_id, official_time_ms: 20_000 }),
          makeRun({ participant_id: third.participant_id, official_time_ms: 30_000 }),
        ],
      });
      const map = rarityMap(bundle);
      expect(map.get(honest.id)?.tier).toBe("champion");
      expect(map.get(third.id)?.tier).toBe("podium");
    });

    it("a scratched roster status gives up its placement slot too", () => {
      // Scratched after posting a time: the override tier was always dnf, but
      // the stale time used to hold a podium place nobody could see.
      const scratched = makeParticipant({ participation_status: "scratched" });
      const runner = makeParticipant();
      const bundle = makeBundle({
        participants: [scratched, runner],
        runs: [
          makeRun({ participant_id: scratched.participant_id, official_time_ms: 10_000 }),
          makeRun({ participant_id: runner.participant_id, official_time_ms: 20_000 }),
        ],
      });
      const map = rarityMap(bundle);
      expect(map.get(scratched.id)?.tier).toBe("dnf");
      expect(map.get(runner.id)?.tier).toBe("champion");
    });
  });

  describe("ties", () => {
    it("a dead heat for first makes both cards champion", () => {
      // Same rule as cardStats' rank: strictly-faster count + 1. Both card
      // backs read "Rank 1", so both bezels must read champion — the old
      // sort-index placing gave one of them podium by sort stability.
      const a = makeParticipant();
      const b = makeParticipant();
      const c = makeParticipant();
      const bundle = makeBundle({
        participants: [a, b, c],
        runs: [
          makeRun({ participant_id: a.participant_id, official_time_ms: 10_000 }),
          makeRun({ participant_id: b.participant_id, official_time_ms: 10_000 }),
          makeRun({ participant_id: c.participant_id, official_time_ms: 20_000 }),
        ],
      });
      const map = rarityMap(bundle);
      expect(map.get(a.id)?.tier).toBe("champion");
      expect(map.get(b.id)?.tier).toBe("champion");
      // c is the second-fastest clock but the third place — still a podium.
      expect(map.get(c.id)?.tier).toBe("podium");
    });

    it("a dead heat for third puts both on the podium", () => {
      const parts = [0, 1, 2, 3, 4].map(() => makeParticipant());
      const times = [10_000, 20_000, 30_000, 30_000, 40_000];
      const bundle = makeBundle({
        participants: parts,
        runs: parts.map((p, i) =>
          makeRun({ participant_id: p.participant_id, official_time_ms: times[i] }),
        ),
      });
      const map = rarityMap(bundle);
      expect(map.get(parts[2].id)?.tier).toBe("podium");
      expect(map.get(parts[3].id)?.tier).toBe("podium");
      // The tie at third pushes the next clock to place 5 — off the podium.
      expect(map.get(parts[4].id)?.tier).toBe("base");
    });
  });

  describe("stationKing", () => {
    it("needs the outright fastest split at a station", () => {
      const station = makeStation();
      const king = makeParticipant();
      const rest = [0, 1, 2].map(() => makeParticipant());
      const kingRun = makeRun({ participant_id: king.participant_id, official_time_ms: 90_000 });
      const restRuns = rest.map((p, i) =>
        makeRun({ participant_id: p.participant_id, official_time_ms: (i + 1) * 10_000 }),
      );
      const bundle = makeBundle({
        participants: [king, ...rest],
        stations: [station],
        runs: [kingRun, ...restRuns],
        splits: [
          makeSplit({ run_id: kingRun.id, station_id: station.id, segment_time_ms: 500 }),
          ...restRuns.map((r) =>
            makeSplit({ run_id: r.id, station_id: station.id, segment_time_ms: 5_000 }),
          ),
        ],
      });
      expect(rarityMap(bundle).get(king.id)?.tier).toBe("stationKing");
    });

    it("ignores splits with no recorded segment time", () => {
      const station = makeStation();
      const p = makeParticipant();
      const run = makeRun({ participant_id: p.participant_id, official_time_ms: 90_000 });
      const bundle = makeBundle({
        participants: [p],
        stations: [station],
        runs: [run],
        splits: [makeSplit({ run_id: run.id, station_id: station.id, segment_time_ms: null })],
      });
      // No timed splits anywhere, so nobody is a station king — and this
      // participant is the only official finisher, so they are the champion.
      expect(rarityMap(bundle).get(p.id)?.tier).toBe("champion");
    });

    it("ignores splits whose run belongs to no known participant", () => {
      const station = makeStation();
      const p = makeParticipant();
      const bundle = makeBundle({
        participants: [p],
        stations: [station],
        runs: [],
        splits: [makeSplit({ run_id: "orphan-run", station_id: station.id, segment_time_ms: 1 })],
      });
      expect(rarityMap(bundle).get(p.id)?.tier).toBe("base");
    });

    it("loses to a podium finish", () => {
      const { bundle, alice } = makeFieldBundle();
      // Alice owns station B outright and is also the champion.
      expect(rarityMap(bundle).get(alice.id)?.tier).toBe("champion");
    });

    it("passes the crown on when the outright fastest split was dq'd", () => {
      // A dq'd split must not hold the station hostage — the crown goes to the
      // fastest split still in contention.
      const station = makeStation();
      const cheat = makeParticipant();
      const king = makeParticipant();
      const rest = [0, 1, 2].map(() => makeParticipant());
      const cheatRun = makeRun({
        participant_id: cheat.participant_id,
        official_time_ms: 5_000,
        status: "dq",
      });
      const kingRun = makeRun({ participant_id: king.participant_id, official_time_ms: 90_000 });
      const restRuns = rest.map((p, i) =>
        makeRun({ participant_id: p.participant_id, official_time_ms: (i + 1) * 10_000 }),
      );
      const bundle = makeBundle({
        participants: [cheat, king, ...rest],
        stations: [station],
        runs: [cheatRun, kingRun, ...restRuns],
        splits: [
          makeSplit({ run_id: cheatRun.id, station_id: station.id, segment_time_ms: 400 }),
          makeSplit({ run_id: kingRun.id, station_id: station.id, segment_time_ms: 500 }),
          ...restRuns.map((r) =>
            makeSplit({ run_id: r.id, station_id: station.id, segment_time_ms: 5_000 }),
          ),
        ],
      });
      const map = rarityMap(bundle);
      expect(map.get(cheat.id)?.tier).toBe("dnf");
      expect(map.get(king.id)?.tier).toBe("stationKing");
    });
  });

  describe("penaltyBox", () => {
    it("goes to whoever took the most penalty time", () => {
      const parts = [0, 1, 2, 3, 4].map(() => makeParticipant());
      const runs = parts.map((p, i) =>
        makeRun({ participant_id: p.participant_id, official_time_ms: (i + 1) * 10_000 }),
      );
      const bundle = makeBundle({
        participants: parts,
        runs,
        // parts[4] finishes 5th (no placing tier) and racks up the most penalties.
        penalties: [
          makePenalty({ run_id: runs[3].id, penalty_ms: 1_000 }),
          makePenalty({ run_id: runs[4].id, penalty_ms: 3_000 }),
          makePenalty({ run_id: runs[4].id, penalty_ms: 4_000 }),
        ],
      });
      const map = rarityMap(bundle);
      expect(map.get(parts[4].id)?.tier).toBe("penaltyBox");
      expect(map.get(parts[3].id)?.tier).toBe("base");
    });

    it("is not awarded when every penalty total is zero", () => {
      const parts = [0, 1, 2, 3].map(() => makeParticipant());
      const runs = parts.map((p, i) =>
        makeRun({ participant_id: p.participant_id, official_time_ms: (i + 1) * 10_000 }),
      );
      const bundle = makeBundle({
        participants: parts,
        runs,
        penalties: [makePenalty({ run_id: runs[3].id, penalty_ms: 0 })],
      });
      expect(rarityMap(bundle).get(parts[3].id)?.tier).toBe("base");
    });

    it("sums penalties across a participant's runs", () => {
      const light = makeParticipant();
      const heavy = makeParticipant();
      const others = [0, 1, 2].map(() => makeParticipant());
      const lightRun = makeRun({ participant_id: light.participant_id, official_time_ms: 40_000 });
      const heavyRunA = makeRun({ participant_id: heavy.participant_id, official_time_ms: 50_000 });
      const heavyRunB = makeRun({ participant_id: heavy.participant_id, official_time_ms: 60_000 });
      const bundle = makeBundle({
        participants: [light, heavy, ...others],
        runs: [
          ...others.map((p, i) =>
            makeRun({ participant_id: p.participant_id, official_time_ms: (i + 1) * 1_000 }),
          ),
          lightRun,
          heavyRunA,
          heavyRunB,
        ],
        penalties: [
          makePenalty({ run_id: lightRun.id, penalty_ms: 9_000 }),
          makePenalty({ run_id: heavyRunA.id, penalty_ms: 5_000 }),
          makePenalty({ run_id: heavyRunB.id, penalty_ms: 5_000 }),
        ],
      });
      expect(rarityMap(bundle).get(heavy.id)?.tier).toBe("penaltyBox");
    });

    it("skips a dq'd runner's penalties so the box goes to the worst eligible offender", () => {
      // A dq'd athlete is already wearing dnf; letting their penalty total win
      // the scan just meant nobody wore the penalty box at all.
      const cheat = makeParticipant();
      const parts = [0, 1, 2, 3].map(() => makeParticipant());
      const cheatRun = makeRun({
        participant_id: cheat.participant_id,
        official_time_ms: 5_000,
        status: "dq",
      });
      const runs = parts.map((p, i) =>
        makeRun({ participant_id: p.participant_id, official_time_ms: (i + 1) * 10_000 }),
      );
      const bundle = makeBundle({
        participants: [cheat, ...parts],
        runs: [cheatRun, ...runs],
        penalties: [
          makePenalty({ run_id: cheatRun.id, penalty_ms: 9_000 }),
          makePenalty({ run_id: runs[3].id, penalty_ms: 5_000 }),
        ],
      });
      const map = rarityMap(bundle);
      expect(map.get(cheat.id)?.tier).toBe("dnf");
      expect(map.get(parts[3].id)?.tier).toBe("penaltyBox");
    });
  });

  describe("admin override", () => {
    it("beats a computed base tier", () => {
      const p = makeParticipant({ card_rarity: "champion" });
      expect(rarityMap(makeBundle({ participants: [p] })).get(p.id)?.tier).toBe("champion");
    });

    it("beats dnf", () => {
      const p = makeParticipant({ participation_status: "scratched", card_rarity: "podium" });
      expect(rarityMap(makeBundle({ participants: [p] })).get(p.id)?.tier).toBe("podium");
    });

    it("can demote a champion", () => {
      const { bundle, alice } = makeFieldBundle();
      alice.card_rarity = "dnf";
      expect(rarityMap(bundle).get(alice.id)?.tier).toBe("dnf");
    });

    it("is ignored when it names a tier that does not exist", () => {
      const p = makeParticipant({ card_rarity: "legendary" });
      expect(rarityMap(makeBundle({ participants: [p] })).get(p.id)?.tier).toBe("base");
    });

    it("is ignored when it names the secret look", () => {
      // Secret cards live outside RARITY on purpose: those six strings are
      // persisted in card_rarity, and a seventh would be a tier the commissioner
      // could hand to a player who never earned it. "secret" is not a tier, so it
      // falls through like any other unknown string.
      const p = makeParticipant({ card_rarity: "secret" });
      expect(rarityMap(makeBundle({ participants: [p] })).get(p.id)?.tier).toBe("base");
    });

    it("is ignored when empty or null", () => {
      const empty = makeParticipant({ card_rarity: "" });
      const missing = makeParticipant({ card_rarity: null });
      const map = rarityMap(makeBundle({ participants: [empty, missing] }));
      expect(map.get(empty.id)?.tier).toBe("base");
      expect(map.get(missing.id)?.tier).toBe("base");
    });
  });
});
