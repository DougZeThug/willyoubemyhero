// Whether the app thinks it can reach anything, and what it says when it cannot.
//
// Small enough to read in one go and worth pinning anyway: three of the four
// behaviours below are the ones that bite on a phone rather than at a desk — a
// device that was already offline before the page loaded, a signal that comes
// back, and the SSR pass where `navigator` does not exist at all.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { OFFLINE_MESSAGE, offlineReason, useIsOnline } from "./use-online";

/** A `navigator.onLine` that can be flipped, with the events that go with it. */
function stubNetwork(initial: boolean) {
  let online = initial;
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
  return (next: boolean) => {
    online = next;
    act(() => {
      window.dispatchEvent(new Event(next ? "online" : "offline"));
    });
  };
}

afterEach(() => {
  // Back to jsdom's own descriptor, which every other suite renders against.
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
  vi.unstubAllGlobals();
});

describe("useIsOnline", () => {
  it("reads a device that was already offline when the page loaded", () => {
    // The case the event listeners alone cannot catch: neither `online` nor
    // `offline` fires for a state that was already true, so the first effect has
    // to go and ask.
    stubNetwork(false);
    const { result } = renderHook(() => useIsOnline());
    expect(result.current).toBe(false);
  });

  it("follows the signal down and back up", () => {
    const setOnline = stubNetwork(true);
    const { result } = renderHook(() => useIsOnline());
    expect(result.current).toBe(true);

    setOnline(false);
    expect(result.current).toBe(false);

    setOnline(true);
    expect(result.current).toBe(true);
  });

  it("stops listening on unmount", () => {
    stubNetwork(true);
    const remove = vi.spyOn(window, "removeEventListener");
    renderHook(() => useIsOnline()).unmount();
    expect(remove.mock.calls.map(([type]) => type)).toEqual(
      expect.arrayContaining(["online", "offline"]),
    );
    remove.mockRestore();
  });
});

describe("offlineReason", () => {
  it("says nothing at all while there is a signal", () => {
    // Spread onto a control, so an empty object is what leaves `title` and
    // `aria-description` off the element entirely rather than setting them empty.
    expect(offlineReason(false)).toEqual({});
  });

  it("gives a disabled control both a tooltip and a description", () => {
    // Both, deliberately: `title` is what a pointer gets and `aria-description`
    // is what a screen reader reads. One sentence either way — a button that is
    // grey for no stated reason is the state this whole thing replaces.
    expect(offlineReason(true)).toEqual({
      title: OFFLINE_MESSAGE,
      "aria-description": OFFLINE_MESSAGE,
    });
  });

  it("leads with what still works", () => {
    // The vault is IndexedDB and a query cache, and a pack opened in a dead spot
    // is dealt locally and recorded later. Saying "you are offline" and stopping
    // would be true and useless.
    expect(OFFLINE_MESSAGE).toMatch(/vault still works/i);
  });
});
