import { describe, expect, it } from "vitest";
import {
  activeTab,
  DUST_ROW_ID,
  NAV_ROW_IDS,
  navHidden,
  navTabs,
  PINNED_ROW_IDS,
  TOGGLEABLE_ROW_IDS,
} from "./nav";

// The nav's real destinations, in nav order, with the economy switched off.
const TABS = navTabs().map((t) => t.to);

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

  it("falls back to the vault when a /players row is switched off", () => {
    // The same shape as a bookmarked /players/shop with dust off: the longest
    // match left is /players, which is where that screen's own way out goes.
    const tabs = navTabs({ hidden: ["pack"] }).map((t) => t.to);
    expect(activeTab("/players/pack", tabs)).toBe("/players");
  });

  it("lights nothing when the row you are standing on is switched off", () => {
    // /leaderboard has no shallower tab to fall back to, so the honest answer is
    // that none of the tabs is the page you are on — the same answer /live and
    // /admin already get. The route still answers; hiding a row is not a gate.
    const tabs = navTabs({ hidden: ["board"] }).map((t) => t.to);
    expect(activeTab("/leaderboard", tabs)).toBeNull();
  });
});

describe("navTabs", () => {
  it("leaves the shop out while the economy is off", () => {
    // The commissioner's switch is off for most of the year, and a tab that
    // answers "not yet" is a slot spent on nothing.
    expect(navTabs().map((t) => t.to)).toEqual([
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
    expect(navTabs({ dustOn: true }).map((t) => t.to)).toEqual([
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
    const off = navTabs();
    const on = navTabs({ dustOn: true }).filter((t) => t.to !== "/players/shop");
    expect(on).toEqual(off);
  });

  it("lights the shop tab, and not the vault, when you are on it", () => {
    // /players/shop starts with /players, so this is the longest-prefix rule
    // doing the job it was written for.
    const tabs = navTabs({ dustOn: true }).map((t) => t.to);
    expect(activeTab("/players/shop", tabs)).toBe("/players/shop");
  });

  it("falls back to the vault on the shop while the tab does not exist", () => {
    // A bookmarked shop URL still renders with dust off, and the longest match
    // left is /players — so the Vault lights. That is the right answer rather
    // than a near miss: the vault is where that page's own way out goes.
    expect(
      activeTab(
        "/players/shop",
        navTabs().map((t) => t.to),
      ),
    ).toBe("/players");
  });
});

describe("navTabs, with rows switched off", () => {
  it("drops exactly the rows named, and nothing else", () => {
    expect(navTabs({ hidden: ["trade", "league"] }).map((t) => t.id)) //
      .toEqual(["vault", "pack", "board"]);
  });

  it("keeps bar order however the ids arrive", () => {
    // The stored value is a set, not an order. What a player learned is the
    // array's order, and hiding a row must not shuffle the rest.
    expect(navTabs({ dustOn: true, hidden: ["league", "pack"] }).map((t) => t.id)) //
      .toEqual(["vault", "trade", "shop", "board"]);
  });

  it("keeps the vault whatever it is asked", () => {
    // Pinned here rather than assumed of the caller: this list comes off a
    // database column, and the worst version of getting it wrong is a bar with
    // no way back to the cards.
    expect(navTabs({ hidden: ["vault"] }).map((t) => t.id)).toContain("vault");
  });

  it("will not hide the shop — dust_enabled is its only switch", () => {
    // Two switches that can disagree is a Shop tab leading to "the commissioner
    // has not switched dust on yet".
    expect(navTabs({ dustOn: true, hidden: ["shop"] }).map((t) => t.id)).toContain("shop");
    expect(navTabs({ dustOn: false }).map((t) => t.id)).not.toContain("shop");
  });

  it("still answers with the vault alone", () => {
    // A bar of one is odd but legal — a commissioner is allowed to decide that.
    // A bar of none is what the pin exists to make unreachable.
    expect(navTabs({ hidden: [...TOGGLEABLE_ROW_IDS] }).map((t) => t.id)).toEqual(["vault"]);
  });

  it("ignores an id it has never heard of", () => {
    // A hidden set written by a newer deploy names a row this bundle does not
    // have. Showing the rows it does know beats rendering nothing.
    expect(navTabs({ hidden: ["sponsors"] }).map((t) => t.id)).toEqual(navTabs().map((t) => t.id));
  });
});

describe("the row vocabulary", () => {
  it("gives every row an id, and every id a row", () => {
    // NAV_ROW_IDS is what the validator and the admin console iterate; a row
    // missing from it is a row nobody can switch, and an id with no row is a
    // switch that does nothing.
    expect(navTabs({ dustOn: true }).map((t) => t.id)).toEqual([...NAV_ROW_IDS]);
  });

  it("offers exactly the rows that are neither pinned nor dust's", () => {
    expect([...TOGGLEABLE_ROW_IDS]).toEqual(
      NAV_ROW_IDS.filter((id) => id !== DUST_ROW_ID && !PINNED_ROW_IDS.includes(id)),
    );
  });

  it("gives every row a distinct id and a distinct path", () => {
    const tabs = navTabs({ dustOn: true });
    expect(new Set(tabs.map((t) => t.id)).size).toBe(tabs.length);
    expect(new Set(tabs.map((t) => t.to)).size).toBe(tabs.length);
  });
});

describe("navHidden", () => {
  it("reads the list off the event", () => {
    expect(navHidden({ nav_hidden: ["trade"] })).toEqual(["trade"]);
  });

  it("treats an event that has not answered yet as the whole bar", () => {
    // The shell renders before the event query resolves, and a bar that grows
    // rows a beat after the first paint is worse than one that starts whole.
    expect(navHidden(null)).toEqual([]);
    expect(navHidden(undefined)).toEqual([]);
  });

  it("treats an event that has never heard of the column as the whole bar", () => {
    // The mid-deploy case, both directions: an old client against the new view,
    // and a new client against the old one.
    expect(navHidden({ name: "Draft Combine" })).toEqual([]);
    expect(navHidden({ nav_hidden: null })).toEqual([]);
  });

  it("drops anything in the column that is not a row id", () => {
    expect(navHidden({ nav_hidden: ["trade", 7, null] })).toEqual(["trade"]);
  });
});
