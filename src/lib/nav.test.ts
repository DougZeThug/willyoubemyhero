import { describe, expect, it } from "vitest";
import { activeTab, navTabs } from "./nav";

// The nav's real destinations, in nav order, with the economy switched off.
const TABS = navTabs(false).map((t) => t.to);

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

describe("navTabs", () => {
  it("leaves the shop out while the economy is off", () => {
    // The commissioner's switch is off for most of the year, and a tab that
    // answers "not yet" is a slot spent on nothing.
    expect(navTabs(false).map((t) => t.to)).toEqual([
      "/players",
      "/players/pack",
      "/players/trade",
      "/leaderboard",
      "/league",
    ]);
  });

  it("puts the shop with the cards, not with the combine", () => {
    // After Trade: dust burns spares and settles finishes, which is card
    // business. Past League it would file with the combine screens.
    expect(navTabs(true).map((t) => t.to)).toEqual([
      "/players",
      "/players/pack",
      "/players/trade",
      "/players/shop",
      "/leaderboard",
      "/league",
    ]);
  });

  it("changes nothing else when the switch flips", () => {
    // The bar reflowing five to six is the accepted cost. Anything else moving
    // as well would be a second, unaccepted one.
    const off = navTabs(false);
    const on = navTabs(true).filter((t) => t.to !== "/players/shop");
    expect(on).toEqual(off);
  });

  it("lights the shop tab, and not the vault, when you are on it", () => {
    // /players/shop starts with /players, so this is the longest-prefix rule
    // doing the job it was written for.
    const tabs = navTabs(true).map((t) => t.to);
    expect(activeTab("/players/shop", tabs)).toBe("/players/shop");
  });

  it("falls back to the vault on the shop while the tab does not exist", () => {
    // A bookmarked shop URL still renders with dust off, and the longest match
    // left is /players — so the Vault lights. That is the right answer rather
    // than a near miss: the vault is where that page's own way out goes.
    expect(
      activeTab(
        "/players/shop",
        navTabs(false).map((t) => t.to),
      ),
    ).toBe("/players");
  });
});
