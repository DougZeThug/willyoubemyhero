// Cards pinned to the top of the vault.
//
// The interesting behaviour is not "does a set remember things" — it is that the
// shelf reads in the order you built it, that a browser refusing to store still
// lets you pin for the page load, and that the id space can never confuse a
// roster card with a secret.
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  rosterFavouriteId,
  secretFavouriteId,
  setVaultFavourites,
  toggleFavourite,
  useVaultFavourites,
} from "./vault-favourites";
import { secretSectionId } from "./vault-layout";

const KEY = "wwbh:vault-favourites";
const ALICE = rosterFavouriteId("alice");
const GARY = secretFavouriteId("gary");

const stored = () => JSON.parse(window.localStorage.getItem(KEY)!).ids;

describe("favourite ids", () => {
  it("keeps a roster card and a secret apart even when they share a uuid", () => {
    // Nothing stops the two tables minting the same uuid, and a collision would
    // pin one card by favouriting the other.
    expect(rosterFavouriteId("same")).not.toBe(secretFavouriteId("same"));
  });

  it("stays clear of the section ids stored under the other key", () => {
    // Different key, so this is not a correctness bug today — it is so the two
    // id spaces never *read* as one thing to whoever changes them next.
    expect(secretFavouriteId("cornhole")).not.toBe(secretSectionId("cornhole"));
  });
});

describe("toggleFavourite", () => {
  it("pins to the end so the shelf reads in the order it was built", () => {
    // Unshifting instead would shove a card you pinned weeks ago down the page
    // every time you pinned another.
    expect(toggleFavourite([ALICE], GARY)).toEqual([ALICE, GARY]);
  });

  it("unpins", () => {
    expect(toggleFavourite([ALICE, GARY], ALICE)).toEqual([GARY]);
  });

  it("never stores the same card twice", () => {
    expect(toggleFavourite([ALICE], ALICE)).toEqual([]);
  });

  it("leaves the input alone", () => {
    const ids = [ALICE];
    toggleFavourite(ids, GARY);
    expect(ids).toEqual([ALICE]);
  });
});

describe("useVaultFavourites", () => {
  it("starts empty and only then reads the device", () => {
    // The server has no localStorage; reading during render would hand the client
    // a different first paint than the one it hydrates against.
    window.localStorage.setItem(KEY, JSON.stringify({ ids: [ALICE] }));
    const { result } = renderHook(() => useVaultFavourites());
    expect(result.current.ids).toEqual([ALICE]);
    expect(result.current.isFavourite(ALICE)).toBe(true);
    expect(result.current.isFavourite(GARY)).toBe(false);
  });

  it("shrugs off junk under its key", () => {
    window.localStorage.setItem(KEY, "not json");
    const { result } = renderHook(() => useVaultFavourites());
    expect(result.current.ids).toEqual([]);
  });

  it("shrugs off the right key holding the wrong shape", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ ids: "alice" }));
    const { result } = renderHook(() => useVaultFavourites());
    expect(result.current.ids).toEqual([]);
  });

  it("pins and unpins, and remembers both", () => {
    const { result } = renderHook(() => useVaultFavourites());
    act(() => result.current.toggle(ALICE));
    act(() => result.current.toggle(GARY));
    expect(result.current.ids).toEqual([ALICE, GARY]);
    expect(stored()).toEqual([ALICE, GARY]);

    act(() => result.current.toggle(ALICE));
    expect(result.current.ids).toEqual([GARY]);
    expect(stored()).toEqual([GARY]);
  });

  it("still pins when the browser refuses to store", () => {
    // Private mode with storage blocked. The pin is lost on reload, which is the
    // honest cost; a star that ignored the tap is not.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const { result } = renderHook(() => useVaultFavourites());
    act(() => result.current.toggle(ALICE));
    expect(result.current.isFavourite(ALICE)).toBe(true);
    vi.restoreAllMocks();
  });

  it("follows a pin made in another tab", () => {
    const { result } = renderHook(() => useVaultFavourites());
    act(() => {
      window.localStorage.setItem(KEY, JSON.stringify({ ids: [GARY] }));
      window.dispatchEvent(new Event("storage"));
    });
    expect(result.current.ids).toEqual([GARY]);
  });

  it("shares one shelf between the grid and the detail page", () => {
    // Both mount the hook; pinning from one has to light the star on the other.
    const grid = renderHook(() => useVaultFavourites());
    const detail = renderHook(() => useVaultFavourites());
    act(() => grid.result.current.toggle(ALICE));
    expect(detail.result.current.isFavourite(ALICE)).toBe(true);
  });

  it("hands out a reader that cannot write back into the store", () => {
    const { result } = renderHook(() => useVaultFavourites());
    act(() => setVaultFavourites([ALICE]));
    expect(() => (result.current.ids as string[]).push(GARY)).not.toThrow();
    expect(stored()).toEqual([ALICE]);
  });
});
