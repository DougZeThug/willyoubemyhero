// The vault's per-device layout.
//
// Two pure functions carry almost all of the behaviour worth pinning: which
// order the shelves come out in once a stored arrangement meets whatever is
// actually on screen, and that a move at either end of the list stays put. The
// hook is tested for the hydration dance and for the one failure mode that would
// otherwise render the whole feature dead — a browser that refuses to store.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  moveSection,
  orderSections,
  ROSTER_SECTION,
  secretSectionId,
  FAVOURITES_SECTION,
  setVaultLayout,
  TROPHIES_SECTION,
  useVaultLayout,
  useVaultPrefs,
} from "./vault-layout";

const KEY = "wwbh:vault-layout";

/** The defaults every stored record now carries, so a test can vary one field. */
const EMPTY_LAYOUT = {
  order: [] as string[],
  collapsed: [] as string[],
  sort: "name" as const,
  filter: "all" as const,
  density: 2 as const,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("section ids", () => {
  it("keeps the roster clear of every set, including the unsorted pile", () => {
    // Both are stored, so a collision would silently hand one shelf's position
    // and open state to the other.
    const ids = [ROSTER_SECTION, secretSectionId(null), secretSectionId("cornhole")];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never renders a null collection as a word a set could later be called", () => {
    // "unsorted" as a suffix would be one migration away from being a real
    // collection id, and then the two would mean the same shelf.
    expect(secretSectionId(null)).toBe("secret:");
  });
});

describe("orderSections", () => {
  it("uses the default order until the device says otherwise", () => {
    expect(orderSections(["a", "b", "c"], [])).toEqual(["a", "b", "c"]);
  });

  it("follows a stored arrangement", () => {
    expect(orderSections(["a", "b", "c"], ["c", "a", "b"])).toEqual(["c", "a", "b"]);
  });

  it("drops a stored id that is no longer on screen", () => {
    // A set you owned on your old phone but not this one. Left in, it would hold
    // a gap in the list that nothing ever fills.
    expect(orderSections(["a", "c"], ["c", "b", "a"])).toEqual(["c", "a"]);
  });

  it("puts a section this device has never seen at the end", () => {
    // Somebody's first Pets pull, on a device that arranged everything else. It
    // appends rather than guessing at a default neighbourhood the owner never
    // asked for, and moving it is one tap.
    expect(orderSections(["a", "b", "new"], ["b", "a"])).toEqual(["b", "a", "new"]);
  });

  it("survives a stored list that repeats itself", () => {
    // Nothing writes one, but the value is JSON from disk and another tab, an
    // older build or a hand edit can put anything under that key.
    expect(orderSections(["a", "b"], ["b", "b", "a", "b"])).toEqual(["b", "a"]);
  });
});

describe("moveSection", () => {
  it("moves one step in each direction", () => {
    expect(moveSection(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveSection(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
  });

  it("stops at both ends rather than wrapping", () => {
    // A wrap would send the shelf you are dragging upward to the very bottom,
    // which reads as the app losing it.
    expect(moveSection(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveSection(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
  });

  it("ignores an id that is not in the list", () => {
    expect(moveSection(["a", "b"], "ghost", 1)).toEqual(["a", "b"]);
  });

  it("leaves the input alone", () => {
    const order = ["a", "b", "c"];
    moveSection(order, "a", 1);
    expect(order).toEqual(["a", "b", "c"]);
  });
});

describe("useVaultLayout", () => {
  const present = [ROSTER_SECTION, secretSectionId("cornhole")];

  it("starts at the default and only then reads the device", () => {
    // The server has no localStorage. Reading during render would hand the client
    // a different first paint than the one it hydrates against.
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ order: [secretSectionId("cornhole"), ROSTER_SECTION], collapsed: [] }),
    );
    const { result } = renderHook(() => useVaultLayout(present));
    expect(result.current.order).toEqual([secretSectionId("cornhole"), ROSTER_SECTION]);
  });

  it("shrugs off junk under its key", () => {
    window.localStorage.setItem(KEY, "not json");
    const { result } = renderHook(() => useVaultLayout(present));
    expect(result.current.order).toEqual(present);
    expect(result.current.collapsed.size).toBe(0);
  });

  it("opens every shelf nobody has closed", () => {
    const { result } = renderHook(() => useVaultLayout(present));
    expect(present.every((id) => !result.current.collapsed.has(id))).toBe(true);
  });

  it("remembers a shelf being rolled up, and rolled back down", () => {
    const { result } = renderHook(() => useVaultLayout(present));
    act(() => result.current.toggle(ROSTER_SECTION));
    expect(result.current.collapsed.has(ROSTER_SECTION)).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(KEY)!).collapsed).toEqual([ROSTER_SECTION]);

    act(() => result.current.toggle(ROSTER_SECTION));
    expect(result.current.collapsed.has(ROSTER_SECTION)).toBe(false);
    expect(JSON.parse(window.localStorage.getItem(KEY)!).collapsed).toEqual([]);
  });

  it("does not pin the order just because a shelf was opened", () => {
    // Opening a shelf says nothing about where it should sit. Writing an order
    // here would freeze an arrangement the owner never made, and a set arriving
    // later would be stuck behind it.
    const { result } = renderHook(() => useVaultLayout(present));
    act(() => result.current.toggle(ROSTER_SECTION));
    expect(JSON.parse(window.localStorage.getItem(KEY)!).order).toEqual([]);
  });

  it("writes the whole visible arrangement on the first move", () => {
    // Not just the id that moved: a one-item stored list would let the merge
    // scatter everything around it next time.
    const { result } = renderHook(() => useVaultLayout(present));
    act(() => result.current.move(secretSectionId("cornhole"), -1));
    const stored = JSON.parse(window.localStorage.getItem(KEY)!).order;
    expect(stored).toEqual([secretSectionId("cornhole"), ROSTER_SECTION]);
    expect(result.current.order).toEqual(stored);
  });

  it("still rearranges when the browser refuses to store", () => {
    // Private mode with storage blocked. The preference is lost on reload, which
    // is the honest cost; a page that ignored the buttons entirely is not.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const { result } = renderHook(() => useVaultLayout(present));
    act(() => result.current.move(secretSectionId("cornhole"), -1));
    expect(result.current.order).toEqual([secretSectionId("cornhole"), ROSTER_SECTION]);
    act(() => result.current.toggle(ROSTER_SECTION));
    expect(result.current.collapsed.has(ROSTER_SECTION)).toBe(true);
  });

  it("follows the same page rearranged in another tab", () => {
    const { result } = renderHook(() => useVaultLayout(present));
    act(() => {
      window.localStorage.setItem(
        KEY,
        JSON.stringify({ order: [secretSectionId("cornhole"), ROSTER_SECTION], collapsed: [] }),
      );
      window.dispatchEvent(new Event("storage"));
    });
    expect(result.current.order).toEqual([secretSectionId("cornhole"), ROSTER_SECTION]);
  });

  it("shares one arrangement between two mounted views", () => {
    const a = renderHook(() => useVaultLayout(present));
    const b = renderHook(() => useVaultLayout(present));
    act(() => a.result.current.move(secretSectionId("cornhole"), -1));
    expect(b.result.current.order).toEqual([secretSectionId("cornhole"), ROSTER_SECTION]);
  });

  it("hands a caller a fresh set rather than one it can mutate into the store", () => {
    const { result } = renderHook(() => useVaultLayout(present));
    act(() => setVaultLayout({ ...EMPTY_LAYOUT, collapsed: [ROSTER_SECTION] }));
    result.current.collapsed.delete(ROSTER_SECTION);
    expect(JSON.parse(window.localStorage.getItem(KEY)!).collapsed).toEqual([ROSTER_SECTION]);
  });
});

describe("useVaultPrefs", () => {
  it("starts on the defaults, so the server and the first client render agree", () => {
    const { result } = renderHook(() => useVaultPrefs());
    expect(result.current.sort).toBe("name");
    expect(result.current.filter).toBe("all");
    expect(result.current.density).toBe(2);
  });

  it("remembers each choice on this device", () => {
    const { result } = renderHook(() => useVaultPrefs());
    act(() => result.current.setSort("newest"));
    act(() => result.current.setFilter("spares"));
    act(() => result.current.setDensity(3));
    expect(result.current.sort).toBe("newest");
    expect(result.current.filter).toBe("spares");
    expect(result.current.density).toBe(3);
    const stored = JSON.parse(window.localStorage.getItem(KEY)!);
    expect(stored).toMatchObject({ sort: "newest", filter: "spares", density: 3 });
  });

  it("loads a layout written before these fields existed", () => {
    // Every device that has ever arranged a shelf has one of these. A sort of
    // `undefined` would leave the grid in no order at all.
    window.localStorage.setItem(KEY, JSON.stringify({ order: [], collapsed: [ROSTER_SECTION] }));
    const { result } = renderHook(() => useVaultPrefs());
    expect(result.current.sort).toBe("name");
    expect(result.current.filter).toBe("all");
    expect(result.current.density).toBe(2);
  });

  it("falls back to the default rather than trusting junk under the key", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ order: [], collapsed: [], sort: "hottest", filter: 7, density: 9 }),
    );
    const { result } = renderHook(() => useVaultPrefs());
    expect(result.current.sort).toBe("name");
    expect(result.current.filter).toBe("all");
    expect(result.current.density).toBe(2);
  });

  it("does not scatter the arrangement when a reading choice changes", () => {
    // The two hooks write the same record. A setter that dropped the order would
    // undo a rearrange the moment somebody changed the sort.
    const { result: prefs } = renderHook(() => useVaultPrefs());
    const { result: layout } = renderHook(() =>
      useVaultLayout([secretSectionId("cornhole"), ROSTER_SECTION]),
    );
    act(() => layout.current.move(ROSTER_SECTION, -1));
    act(() => prefs.current.setSort("rarity"));
    expect(layout.current.order).toEqual([ROSTER_SECTION, secretSectionId("cornhole")]);
    expect(JSON.parse(window.localStorage.getItem(KEY)!).order).toEqual([
      ROSTER_SECTION,
      secretSectionId("cornhole"),
    ]);
  });

  it("carries a choice across to another view of the same vault", () => {
    const a = renderHook(() => useVaultPrefs());
    const b = renderHook(() => useVaultPrefs());
    act(() => a.result.current.setDensity(3));
    expect(b.result.current.density).toBe(3);
  });
});

describe("the default shelf order", () => {
  // Pinned here rather than left to the route, because it is a product decision
  // and not a coincidence of the array literal it lives in: the trophy case goes
  // ABOVE the sets it is the answer to (§13), and the roster — the one shelf
  // everybody knows by heart — goes last so the sets you are collecting lead.
  const present = [
    FAVOURITES_SECTION,
    TROPHIES_SECTION,
    secretSectionId("pets"),
    secretSectionId("cornhole"),
    ROSTER_SECTION,
  ];

  it("puts Complete above the set shelves and the roster last", () => {
    expect(orderSections(present, [])).toEqual(present);
  });

  it("still lets a device that has arranged its own shelves win", () => {
    // The default is where a shelf STARTS, never where it is held.
    const mine = [ROSTER_SECTION, TROPHIES_SECTION];
    expect(orderSections(present, mine).slice(0, 2)).toEqual(mine);
  });
});
