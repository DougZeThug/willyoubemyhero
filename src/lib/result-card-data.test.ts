import { describe, expect, it } from "vitest";
import { toResultCardData } from "./result-card-data";

const run = { id: "r1", official_time_ms: 61_000, penalty_ms: 5_000 };
const bundle = {
  splits: [
    { id: "s1", run_id: "r1", station_id: "st1", segment_time_ms: 10_000 },
    { id: "s2", run_id: "r1", station_id: "gone", segment_time_ms: null },
    { id: "s3", run_id: "other", station_id: "st1", segment_time_ms: 9_000 },
  ],
  stations: [{ id: "st1", name: "Tyre Run" }],
};

describe("toResultCardData", () => {
  it("prints the row's own numbers and only its own splits", () => {
    const data = toResultCardData({
      row: {
        run,
        place: 3,
        ep: {
          id: "ep1",
          participant: {
            name: "Alice Ace",
            fantasy_team_name: "Hawks",
            profile_image_url: "p.png",
          },
        },
      },
      event: { name: "Combine", year: 2026 },
      bundle,
      photos: { ep1: "signed.png" },
    });
    expect(data).toMatchObject({
      eventName: "Combine",
      eventYear: 2026,
      participantName: "Alice Ace",
      fantasyTeam: "Hawks",
      photoUrl: "signed.png",
      totalMs: 61_000,
      penaltyMs: 5_000,
      rank: 3,
    });
    // A split whose station is gone still prints, under a generic label.
    expect(data.splits).toEqual([
      { id: "s1", label: "Tyre Run", ms: 10_000 },
      { id: "s2", label: "Split", ms: 0 },
    ]);
  });

  it("falls back when the roster, event, photos or bundle are missing", () => {
    const data = toResultCardData({
      row: { run: { id: "r1", official_time_ms: null }, place: 1 },
      event: null,
      bundle: null,
      photos: undefined,
    });
    expect(data).toMatchObject({
      eventName: "Draft Combine",
      eventYear: null,
      participantName: "Athlete",
      fantasyTeam: null,
      photoUrl: null,
      totalMs: 0,
      penaltyMs: 0,
      splits: [],
    });
  });

  it("uses the profile image when there is no signed photo", () => {
    const data = toResultCardData({
      row: {
        run,
        place: 1,
        ep: { id: "ep1", participant: { name: "A", profile_image_url: "p.png" } },
      },
      event: undefined,
      bundle: undefined,
      photos: {},
    });
    expect(data.photoUrl).toBe("p.png");
  });
});
