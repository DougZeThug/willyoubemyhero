// Client-side handling of the commissioner token. This does not verify the
// signature — only the server can — but it is what decides whether the admin
// console renders, and it must never hold on to a token the server will reject.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { clearAdminToken, getAdminToken, setAdminToken, useAdminSession } from "./admin-token";

const KEY = "wwbh:admin-token";
const EVENT_ID = "00000000-0000-4000-8000-0000000000ff";

function tokenExpiring(at: number) {
  return `${EVENT_ID}.${at}.signature`;
}

const VALID = () => tokenExpiring(Date.now() + 60_000);

beforeEach(() => {
  window.localStorage.clear();
});

describe("getAdminToken", () => {
  it("returns null when nothing is stored", () => {
    expect(getAdminToken()).toBeNull();
  });

  it("returns a well-formed unexpired token", () => {
    const token = VALID();
    window.localStorage.setItem(KEY, token);
    expect(getAdminToken()).toBe(token);
  });

  it.each([
    ["too few segments", "event.123"],
    ["too many segments", "event.123.sig.extra"],
    ["an empty event id", ".123.sig"],
    ["a non-numeric expiry", `${EVENT_ID}.soon.sig`],
    ["junk", "garbage"],
  ])("rejects a token with %s", (_label, token) => {
    window.localStorage.setItem(KEY, token);
    expect(getAdminToken()).toBeNull();
  });

  it("rejects an expired token", () => {
    window.localStorage.setItem(KEY, tokenExpiring(Date.now() - 1));
    expect(getAdminToken()).toBeNull();
  });

  it("evicts a rejected token instead of leaving it to be retried forever", () => {
    window.localStorage.setItem(KEY, "garbage");
    getAdminToken();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});

describe("setAdminToken / clearAdminToken", () => {
  it("stores and removes the token", () => {
    const token = VALID();
    setAdminToken(token);
    expect(window.localStorage.getItem(KEY)).toBe(token);
    clearAdminToken();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("announces both changes, since storage events only fire in other tabs", () => {
    const listener = vi.fn();
    window.addEventListener("wwbh:admin-token-changed", listener);
    setAdminToken(VALID());
    clearAdminToken();
    window.removeEventListener("wwbh:admin-token-changed", listener);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("useAdminSession", () => {
  it("is null with nothing stored", () => {
    const { result } = renderHook(() => useAdminSession());
    expect(result.current).toBeNull();
  });

  it("reports the stored session", () => {
    const expiresAt = Date.now() + 60_000;
    window.localStorage.setItem(KEY, tokenExpiring(expiresAt));
    const { result } = renderHook(() => useAdminSession());
    expect(result.current).toEqual({
      eventId: EVENT_ID,
      expiresAt,
      token: tokenExpiring(expiresAt),
    });
  });

  it("picks up a sign-in that happens while mounted", () => {
    const { result } = renderHook(() => useAdminSession());
    expect(result.current).toBeNull();
    act(() => setAdminToken(VALID()));
    expect(result.current?.eventId).toBe(EVENT_ID);
  });

  it("drops the session on sign-out", () => {
    window.localStorage.setItem(KEY, VALID());
    const { result } = renderHook(() => useAdminSession());
    expect(result.current).not.toBeNull();
    act(() => clearAdminToken());
    expect(result.current).toBeNull();
  });

  it("reacts to a sign-in from another tab", () => {
    const { result } = renderHook(() => useAdminSession());
    window.localStorage.setItem(KEY, VALID());
    act(() => {
      window.dispatchEvent(new Event("storage"));
    });
    expect(result.current?.eventId).toBe(EVENT_ID);
  });

  it("expires the session on its own without any event", () => {
    vi.useFakeTimers();
    try {
      window.localStorage.setItem(KEY, tokenExpiring(Date.now() + 30_000));
      const { result } = renderHook(() => useAdminSession());
      expect(result.current).not.toBeNull();
      // The hook re-reads every minute so a console left open goes cold.
      act(() => {
        vi.advanceTimersByTime(61_000);
      });
      expect(result.current).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops listening after unmount", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useAdminSession());
    unmount();
    expect(remove).toHaveBeenCalledWith("storage", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("wwbh:admin-token-changed", expect.any(Function));
    remove.mockRestore();
  });
});
