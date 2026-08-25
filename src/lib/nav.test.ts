import { describe, expect, it } from "vitest";
import { activeTab } from "./nav";

// The nav's real destinations, in nav order.
const TABS = ["/players", "/players/pack", "/players/trade", "/leaderboard", "/league"];

describe("activeTab", () => {
  it.each([
    ["/players", "/players"],
    ["/leaderboard", "/leaderboard"],
    ["/league", "/league"],
  ])("lights the tab you are standing on (%s)", (path, expected) => {
    expect(activeTab(path, TABS)).toBe(expected);
  });

  it.each([
    ["/players/pack", "/players/pack"],
    ["/players/trade", "/players/trade"],
  ])("prefers the deeper tab over its parent (%s)", (path, expected) => {
    // The whole reason this is not a bare startsWith: both /players and
    // /players/pack match, and lighting two tabs at once is the bug.
    expect(activeTab(path, TABS)).toBe(expected);
  });

  it("keeps a player's card under the Vault", () => {
    expect(activeTab("/players/00000000-0000-4000-8000-0000000000aa", TABS)).toBe("/players");
  });

  it("lights nothing on a screen the nav no longer carries", () => {
    // The combine screens live behind the League hub now. A tab lit on one of
    // them would be pointing at a page you are not on.
    expect(activeTab("/live", TABS)).toBeNull();
    expect(activeTab("/admin", TABS)).toBeNull();
  });

  it("does not match a prefix that stops mid-segment", () => {
    expect(activeTab("/players-archive", TABS)).toBeNull();
  });
});
