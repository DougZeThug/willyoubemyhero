// The 40-99 ratings behind the card front. Everything here is field-relative,
// so most of these tests are about what happens when the field is degenerate —
// one runner, no runners, everybody tied — because all three happen on the day.
import { beforeEach, describe, expect, it } from "vitest";
import { ATTRIBUTE_KEYS, attributeMap, type AttrBundle } from "./card-attributes";
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

beforeEach(resetFixtureIds);

describe("attributeMap", () => {
  it("returns an empty map without a bundle", () => {
    expect(attributeMap(null).size).toBe(0);
    expect(attributeMap(undefined).size).toBe(0);
  });

  it("is keyed by event_participant id, not participant id", () => {
    const { bundle, alice } = makeFieldBundle();
    const map = attributeMap(bundle);
    expect(map.has(alice.id)).toBe(true);
    expect(map.has(alice.participant_id)).toBe(false);
  });

  it("gives the fastest runner the top Speed and the slowest the floor", () => {
    const { bundle, alice, carol } = makeFieldBundle();
    const map = attributeMap(bundle);
    expect(map.get(alice.id)?.ratings.speed).toBe(99);
    expect(map.get(carol.id)?.ratings.speed).toBe(40);
  });

  it("orders Speed by finishing position", () => {
    const { bundle, alice, bob, erin, carol } = makeFieldBundle();
    const map = attributeMap(bundle);
    const speeds = [alice, bob, erin, carol].map((p) => map.get(p.id)!.ratings.speed!);
    expect(speeds).toEqual([...speeds].sort((a, b) => b - a));
    expect(new Set(speeds).size).toBe(4);
  });

  it("rates Burst off the best single station, not the overall time", () => {
    // Carol is last overall but owns the fastest split at station A.
    const { bundle, carol } = makeFieldBundle();
    const carolRatings = attributeMap(bundle).get(carol.id)!;
    expect(carolRatings.ratings.speed).toBe(40);
    expect(carolRatings.ratings.burst).toBe(99);
  });

  it("punishes a spiky field profile in Consistency", () => {
    // Carol is first at one station and last at the other — maximum spread.
    // Alice is near the top at both.
    const { bundle, alice, carol } = makeFieldBundle();
    const map = attributeMap(bundle);
    expect(map.get(carol.id)!.ratings.consistency).toBe(40);
    expect(map.get(alice.id)!.ratings.consistency).toBeGreaterThan(
      map.get(carol.id)!.ratings.consistency!,
    );
  });

  it("rewards finishing above your own average in Clutch", () => {
    // Alice's last station is her stronger one; Carol falls apart on hers.
    const { bundle, alice, carol } = makeFieldBundle();
    const map = attributeMap(bundle);
    expect(map.get(alice.id)!.ratings.clutch).toBeGreaterThan(map.get(carol.id)!.ratings.clutch!);
  });

  it("composes an OVR from the ratings that resolved", () => {
    const { bundle, alice, carol } = makeFieldBundle();
    const map = attributeMap(bundle);
    const aliceOvr = map.get(alice.id)!.ovr!;
    expect(aliceOvr).toBeGreaterThan(map.get(carol.id)!.ovr!);
    expect(aliceOvr).toBeGreaterThanOrEqual(40);
    expect(aliceOvr).toBeLessThanOrEqual(99);
  });

  it("leaves every rating null for someone who did not finish", () => {
    const { bundle, dave } = makeFieldBundle();
    const attrs = attributeMap(bundle).get(dave.id)!;
    expect(attrs.ovr).toBeNull();
    for (const key of ATTRIBUTE_KEYS) expect(attrs.ratings[key]).toBeNull();
  });

  it("treats a disqualified run as a DNF even when the status says finished", () => {
    const p = makeParticipant({ participation_status: "finished" });
    const bundle: AttrBundle = makeBundle({
      participants: [p],
      runs: [makeRun({ participant_id: p.participant_id, status: "dq" })],
    });
    expect(attributeMap(bundle).get(p.id)!.ovr).toBeNull();
  });

  it("rates nobody before anyone has run", () => {
    const p = makeParticipant();
    const bundle: AttrBundle = makeBundle({ participants: [p] });
    const attrs = attributeMap(bundle).get(p.id)!;
    expect(attrs.ovr).toBeNull();
    expect(attrs.settled).toBe(false);
  });

  it("hands a field of one the top of the scale", () => {
    const p = makeParticipant();
    const bundle: AttrBundle = makeBundle({
      participants: [p],
      runs: [makeRun({ participant_id: p.participant_id, official_time_ms: 90_000 })],
    });
    expect(attributeMap(bundle).get(p.id)!.ratings.speed).toBe(99);
  });

  it("ties everyone at the top when every time is identical", () => {
    const a = makeParticipant();
    const b = makeParticipant();
    const bundle: AttrBundle = makeBundle({
      participants: [a, b],
      runs: [
        makeRun({ participant_id: a.participant_id, official_time_ms: 60_000 }),
        makeRun({ participant_id: b.participant_id, official_time_ms: 60_000 }),
      ],
    });
    const map = attributeMap(bundle);
    expect(map.get(a.id)!.ratings.speed).toBe(99);
    expect(map.get(b.id)!.ratings.speed).toBe(99);
  });

  it("will not invent a spread from a single station", () => {
    const station = makeStation();
    const a = makeParticipant();
    const b = makeParticipant();
    const aRun = makeRun({ participant_id: a.participant_id, official_time_ms: 50_000 });
    const bRun = makeRun({ participant_id: b.participant_id, official_time_ms: 60_000 });
    const bundle: AttrBundle = makeBundle({
      participants: [a, b],
      stations: [station],
      runs: [aRun, bRun],
      splits: [
        makeSplit({ run_id: aRun.id, station_id: station.id, segment_time_ms: 20_000 }),
        makeSplit({ run_id: bRun.id, station_id: station.id, segment_time_ms: 30_000 }),
      ],
    });
    const attrs = attributeMap(bundle).get(a.id)!;
    expect(attrs.ratings.burst).toBe(99);
    expect(attrs.ratings.consistency).toBeNull();
    expect(attrs.ratings.clutch).toBeNull();
    // Speed still resolves — it never needed splits.
    expect(attrs.ratings.speed).toBe(99);
  });

  it("scores Discipline against the clean runners too, not just the offenders", () => {
    const { bundle, alice, carol, carolRun } = makeFieldBundle();
    const penalised: AttrBundle = {
      ...bundle,
      penalties: [makePenalty({ run_id: carolRun.id, penalty_ms: 10_000 })],
    };
    const map = attributeMap(penalised);
    expect(map.get(carol.id)!.ratings.discipline).toBe(40);
    expect(map.get(alice.id)!.ratings.discipline).toBe(99);
  });

  it("ignores a penalty attached to a run nobody on the roster owns", () => {
    const { bundle, alice } = makeFieldBundle();
    const stray: AttrBundle = {
      ...bundle,
      penalties: [makePenalty({ penalty_ms: 30_000 })],
    };
    expect(attributeMap(stray).get(alice.id)!.ratings.discipline).toBe(99);
  });

  describe("settled", () => {
    it("is false while a roster member still has a run to post", () => {
      const ran = makeParticipant();
      const waiting = makeParticipant();
      const bundle: AttrBundle = makeBundle({
        participants: [ran, waiting],
        runs: [makeRun({ participant_id: ran.participant_id })],
      });
      expect(attributeMap(bundle).get(ran.id)!.settled).toBe(false);
    });

    it("does not wait on someone who scratched — they are never going to run", () => {
      const ran = makeParticipant();
      const scratched = makeParticipant({ participation_status: "scratched" });
      const bundle: AttrBundle = makeBundle({
        participants: [ran, scratched],
        runs: [makeRun({ participant_id: ran.participant_id })],
      });
      expect(attributeMap(bundle).get(ran.id)!.settled).toBe(true);
    });

    it("is true once the whole field has an official time", () => {
      const { bundle, alice } = makeFieldBundle();
      expect(attributeMap(bundle).get(alice.id)!.settled).toBe(true);
    });
  });

  describe("admin override", () => {
    it("replaces a derived rating", () => {
      const { bundle, carol } = makeFieldBundle();
      const overridden: AttrBundle = {
        ...bundle,
        participants: bundle.participants.map((p) =>
          p.id === carol.id ? { ...p, card_attributes: { speed: 99 } } : p,
        ),
      };
      expect(attributeMap(overridden).get(carol.id)!.ratings.speed).toBe(99);
    });

    it("moves the OVR when a single rating is overridden", () => {
      const { bundle, carol } = makeFieldBundle();
      const before = attributeMap(bundle).get(carol.id)!.ovr!;
      const overridden: AttrBundle = {
        ...bundle,
        participants: bundle.participants.map((p) =>
          p.id === carol.id ? { ...p, card_attributes: { speed: 99 } } : p,
        ),
      };
      expect(attributeMap(overridden).get(carol.id)!.ovr).toBeGreaterThan(before);
    });

    it("an explicit OVR wins outright", () => {
      const { bundle, carol } = makeFieldBundle();
      const overridden: AttrBundle = {
        ...bundle,
        participants: bundle.participants.map((p) =>
          p.id === carol.id ? { ...p, card_attributes: { ovr: 12 } } : p,
        ),
      };
      expect(attributeMap(overridden).get(carol.id)!.ovr).toBe(12);
    });

    it("can rate someone who never ran", () => {
      const { bundle, dave } = makeFieldBundle();
      const overridden: AttrBundle = {
        ...bundle,
        participants: bundle.participants.map((p) =>
          p.id === dave.id ? { ...p, card_attributes: { speed: 70 } } : p,
        ),
      };
      const attrs = attributeMap(overridden).get(dave.id)!;
      expect(attrs.ratings.speed).toBe(70);
      expect(attrs.ovr).toBe(70);
    });

    it("drops junk in the column rather than blanking the card", () => {
      const { bundle, alice } = makeFieldBundle();
      const derived = attributeMap(bundle).get(alice.id)!;
      for (const junk of ["nope", 42, [1, 2], null, { speed: "fast", burst: Number.NaN }]) {
        const overridden: AttrBundle = {
          ...bundle,
          participants: bundle.participants.map((p) =>
            p.id === alice.id ? { ...p, card_attributes: junk } : p,
          ),
        };
        expect(attributeMap(overridden).get(alice.id)!.ratings).toEqual(derived.ratings);
      }
    });

    it("clamps an out-of-range override into the scale", () => {
      const { bundle, alice } = makeFieldBundle();
      const overridden: AttrBundle = {
        ...bundle,
        participants: bundle.participants.map((p) =>
          p.id === alice.id ? { ...p, card_attributes: { speed: 500, burst: -10 } } : p,
        ),
      };
      const attrs = attributeMap(overridden).get(alice.id)!;
      expect(attrs.ratings.speed).toBe(99);
      expect(attrs.ratings.burst).toBe(0);
    });
  });

  it("keeps every rating inside the scale for a whole field", () => {
    const { bundle } = makeFieldBundle();
    for (const attrs of attributeMap(bundle).values()) {
      for (const key of ATTRIBUTE_KEYS) {
        const v = attrs.ratings[key];
        if (v == null) continue;
        expect(v).toBeGreaterThanOrEqual(40);
        expect(v).toBeLessThanOrEqual(99);
      }
    }
  });
});
