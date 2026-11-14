import { describe, expect, it } from "vitest";
import { leagueDay } from "./league-day";

describe("leagueDay", () => {
  it("renders the same YYYY-MM-DD text a Postgres date does", () => {
    expect(leagueDay(new Date("2026-08-17T16:00:00Z"))).toBe("2026-08-17");
  });

  it("uses the league's zone rather than the phone's", () => {
    // 03:00 UTC on the 18th is still the evening of the 17th in New York, which is
    // the whole reason the zone is pinned: somebody standing in the garden at
    // 11pm must not have their spares recomputed against tomorrow.
    expect(leagueDay(new Date("2026-08-18T03:00:00Z"))).toBe("2026-08-17");
  });

  it("rolls over at the league's midnight", () => {
    // 04:00 UTC is midnight EDT.
    expect(leagueDay(new Date("2026-08-18T04:00:00Z"))).toBe("2026-08-18");
  });

  it("tracks the standard-time offset too", () => {
    // January is EST (UTC-5), so the boundary moves an hour.
    expect(leagueDay(new Date("2026-01-18T04:30:00Z"))).toBe("2026-01-17");
    expect(leagueDay(new Date("2026-01-18T05:30:00Z"))).toBe("2026-01-18");
  });
});
