// The hub is the only door left to the combine screens: the nav gave their tabs
// to the cards. A tile quietly dropped here strands a whole page at a URL nobody
// can reach from inside the app, which is exactly the failure a link hub is worst
// at showing you.
import { describe, expect, it } from "vitest";
import { LEAGUE_LINKS } from "./league";

describe("LEAGUE_LINKS", () => {
  it("reaches every screen the nav no longer carries", () => {
    expect(LEAGUE_LINKS.map((l) => l.to)).toEqual([
      "/live",
      "/order",
      "/draft",
      "/awards",
      "/analytics",
    ]);
  });

  it("gives every tile something to read", () => {
    for (const l of LEAGUE_LINKS) {
      expect(l.label).not.toBe("");
      expect(l.blurb).not.toBe("");
    }
  });
});
