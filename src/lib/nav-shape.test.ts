import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import {
  DEFAULT_NAV_SHAPE,
  parseNavShape,
  readNavShape,
  sameNavShape,
  shapeOfEvent,
  useNavShape,
  writeNavShape,
} from "./nav-shape";

const KEY = "wwbh:nav-shape";

beforeEach(() => {
  window.localStorage.clear();
  // The module cache as well as storage: writeNavShape trusts its own value over
  // a re-read, so clearing only storage would leak the shape between tests.
  // readNavShape is the one thing that pulls the module back in line with it.
  readNavShape();
});

describe("parseNavShape", () => {
  it("reads back what was stored", () => {
    expect(parseNavShape('{"dustOn":true,"hidden":["board"]}')).toEqual({
      dustOn: true,
      hidden: ["board"],
    });
  });

  it("treats anything it cannot use as never stored", () => {
    // Every one of these is a real state: nothing written yet, a half-finished
    // write, a key another version of the app owned, and a device that has been
    // through a schema change.
    for (const raw of [
      null,
      "",
      "{",
      "[]",
      "null",
      '{"dustOn":"yes","hidden":[]}',
      '{"hidden":[]}',
      '{"dustOn":true}',
    ]) {
      expect(parseNavShape(raw)).toBeNull();
    }
  });

  it("drops non-strings out of the hidden set rather than the whole shape", () => {
    expect(parseNavShape('{"dustOn":false,"hidden":["board",7,null,"league"]}')).toEqual({
      dustOn: false,
      hidden: ["board", "league"],
    });
  });
});

describe("sameNavShape", () => {
  it("ignores the order of the hidden set", () => {
    // navTabs reads `hidden` as a set, so a commissioner reordering the column
    // must not read as a changed bar and rewrite storage on every load.
    expect(
      sameNavShape(
        { dustOn: false, hidden: ["board", "league"] },
        { dustOn: false, hidden: ["league", "board"] },
      ),
    ).toBe(true);
  });

  it("separates the dust switch from the hidden set", () => {
    expect(sameNavShape({ dustOn: true, hidden: [] }, { dustOn: false, hidden: [] })).toBe(false);
    expect(sameNavShape({ dustOn: false, hidden: ["board"] }, { dustOn: false, hidden: [] })).toBe(
      false,
    );
  });

  it("only counts two absent shapes as the same", () => {
    expect(sameNavShape(null, null)).toBe(true);
    expect(sameNavShape(null, DEFAULT_NAV_SHAPE)).toBe(false);
  });
});

describe("shapeOfEvent", () => {
  it("says nothing while the query has not answered", () => {
    // undefined is react-query's "no data yet". null is a real answer — an
    // installation with no active event — and gets the default bar, not silence.
    expect(shapeOfEvent(undefined)).toBeNull();
    expect(shapeOfEvent(null)).toEqual(DEFAULT_NAV_SHAPE);
  });

  it("carries the dust switch and the commissioner's hidden set", () => {
    expect(shapeOfEvent({ dust_enabled: true, nav_hidden: ["board"] })).toEqual({
      dustOn: true,
      hidden: ["board"],
    });
  });

  it("reads an event from before either column existed as the default bar", () => {
    expect(shapeOfEvent({ id: "e1" })).toEqual(DEFAULT_NAV_SHAPE);
  });
});

describe("useNavShape", () => {
  it("draws the default bar on a device that has never stored one", () => {
    const { result } = renderHook(() => useNavShape(undefined));
    expect(result.current).toEqual(DEFAULT_NAV_SHAPE);
  });

  it("draws the remembered bar while the event has not answered", async () => {
    // The whole point: without this the first paint is always five rows, and a
    // league with dust on gains a sixth tab — narrowing every other one — a
    // round trip after the page arrives.
    window.localStorage.setItem(KEY, JSON.stringify({ dustOn: true, hidden: ["board"] }));
    const { result } = renderHook(() => useNavShape(undefined));
    await waitFor(() => expect(result.current).toEqual({ dustOn: true, hidden: ["board"] }));
  });

  it("prefers the answered event over what was remembered", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ dustOn: true, hidden: [] }));
    const { result } = renderHook(() => useNavShape({ dust_enabled: false, nav_hidden: [] }));
    await waitFor(() => expect(result.current).toEqual({ dustOn: false, hidden: [] }));
  });

  it("remembers what the event answered, for the next cold load", async () => {
    renderHook(() => useNavShape({ dust_enabled: true, nav_hidden: ["league"] }));
    await waitFor(() =>
      expect(parseNavShape(window.localStorage.getItem(KEY))).toEqual({
        dustOn: true,
        hidden: ["league"],
      }),
    );
  });
});

describe("writeNavShape", () => {
  it("holds the shape for this page load even when storage refuses", () => {
    // Private mode with site data blocked. The bar still stops re-shaping for
    // the rest of this session, which is all a device that cannot remember gets.
    //
    // Spied on the prototype, not the instance: jsdom's localStorage is a proxy
    // with named properties, so assigning to `window.localStorage.setItem`
    // quietly stores an item called "setItem" and leaves the method working.
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      expect(() => writeNavShape({ dustOn: true, hidden: [] })).not.toThrow();
    } finally {
      setItem.mockRestore();
    }
    expect(readNavShape()).toBeNull();
  });
});
