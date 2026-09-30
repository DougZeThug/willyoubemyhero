// Client-side handling of the commissioner token. This does not verify the
// signature — only the server can — but it is what decides whether the admin
// console renders, and it must never hold on to a token the server will reject.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  bindAdminTokenTo,
  clearAdminToken,
  getAdminToken,
  setAdminToken,
  useAdminSession,
} from "./admin-token";

const KEY = "wwbh:admin-token";
const OWNER_KEY = "wwbh:admin-token-owner";
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

  it("evicts the owner with an expired token", () => {
    window.localStorage.setItem(KEY, tokenExpiring(Date.now() - 1));
    window.localStorage.setItem(OWNER_KEY, "user-a");
    getAdminToken();
    expect(window.localStorage.getItem(OWNER_KEY)).toBeNull();
  });
});

describe("setAdminToken / clearAdminToken", () => {
  it("stores and removes the token", () => {
    const token = VALID();
    setAdminToken(token, null);
    expect(window.localStorage.getItem(KEY)).toBe(token);
    clearAdminToken();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("stores and removes the owner with the token", () => {
    setAdminToken(VALID(), "user-a");
    expect(window.localStorage.getItem(OWNER_KEY)).toBe("user-a");
    clearAdminToken();
    expect(window.localStorage.getItem(OWNER_KEY)).toBeNull();
  });

  it("drops a previous owner when a PIN unlock has nobody signed in", () => {
    // Otherwise the old owner would be pinned to a token they never earned.
    setAdminToken(VALID(), "user-a");
    setAdminToken(VALID(), null);
    expect(window.localStorage.getItem(OWNER_KEY)).toBeNull();
  });

  it("announces both changes, since storage events only fire in other tabs", () => {
    const listener = vi.fn();
    window.addEventListener("wwbh:admin-token-changed", listener);
    setAdminToken(VALID(), null);
    clearAdminToken();
    window.removeEventListener("wwbh:admin-token-changed", listener);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("bindAdminTokenTo", () => {
  // The token names no user and, since ADM-16, outlives a sign-out. This is
  // what stops the next account signed in on the handset from holding the last
  // one's console.
  it("takes off a token another account earned", () => {
    const token = VALID();
    setAdminToken(token, "user-a");
    const listener = vi.fn();
    window.addEventListener("wwbh:admin-token-changed", listener);
    bindAdminTokenTo("user-b");
    window.removeEventListener("wwbh:admin-token-changed", listener);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(window.localStorage.getItem(OWNER_KEY)).toBeNull();
    // The console on screen has to hear about it.
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps the token for the account that earned it", () => {
    const token = VALID();
    setAdminToken(token, "user-a");
    bindAdminTokenTo("user-a");
    expect(window.localStorage.getItem(KEY)).toBe(token);
    expect(window.localStorage.getItem(OWNER_KEY)).toBe("user-a");
  });

  it("gives a token nobody owned to the account that signs in", () => {
    const token = VALID();
    setAdminToken(token, null);
    bindAdminTokenTo("user-a");
    expect(window.localStorage.getItem(KEY)).toBe(token);
    expect(window.localStorage.getItem(OWNER_KEY)).toBe("user-a");
  });

  it("claims nothing when there is no live token", () => {
    window.localStorage.setItem(KEY, tokenExpiring(Date.now() - 1));
    bindAdminTokenTo("user-a");
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(window.localStorage.getItem(OWNER_KEY)).toBeNull();
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
      owner: null,
    });
  });

  it("reports who the session belongs to", () => {
    // /admin will not paint the console for a token another account holds.
    window.localStorage.setItem(KEY, VALID());
    window.localStorage.setItem(OWNER_KEY, "user-a");
    const { result } = renderHook(() => useAdminSession());
    expect(result.current?.owner).toBe("user-a");
  });

  it("picks up a sign-in that happens while mounted", () => {
    const { result } = renderHook(() => useAdminSession());
    expect(result.current).toBeNull();
    act(() => setAdminToken(VALID(), null));
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
      window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
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
