// Client-side handling of the league-member token. Mirrors admin-token, but the
// shape is deliberately different — 4 segments behind an "m" prefix — so the two
// can never be confused for one another.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { clearMemberToken, getMemberToken, setMemberToken, useMemberSession } from "./member-token";

const KEY = "wwbh:member-token";
const NAME_KEY = "wwbh:member-name";
const PARTICIPANT_ID = "00000000-0000-4000-8000-0000000000aa";

function tokenExpiring(at: number) {
  return `m.${PARTICIPANT_ID}.${at}.signature`;
}

const VALID = () => tokenExpiring(Date.now() + 60_000);

beforeEach(() => {
  window.localStorage.clear();
});

describe("getMemberToken", () => {
  it("returns null when nothing is stored", () => {
    expect(getMemberToken()).toBeNull();
  });

  it("returns a well-formed unexpired token", () => {
    const token = VALID();
    window.localStorage.setItem(KEY, token);
    expect(getMemberToken()).toBe(token);
  });

  it.each([
    ["the admin token shape", `${PARTICIPANT_ID}.${Date.now() + 60_000}.sig`],
    ["a wrong prefix", `x.${PARTICIPANT_ID}.${Date.now() + 60_000}.sig`],
    ["an empty participant id", `m..${Date.now() + 60_000}.sig`],
    ["a non-numeric expiry", `m.${PARTICIPANT_ID}.soon.sig`],
    ["junk", "garbage"],
  ])("rejects %s", (_label, token) => {
    window.localStorage.setItem(KEY, token);
    expect(getMemberToken()).toBeNull();
  });

  it("rejects an expired token", () => {
    window.localStorage.setItem(KEY, tokenExpiring(Date.now() - 1));
    expect(getMemberToken()).toBeNull();
  });

  it("evicts a rejected token, and the cached name with it", () => {
    window.localStorage.setItem(KEY, "garbage");
    window.localStorage.setItem(NAME_KEY, "Doug");
    getMemberToken();
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(window.localStorage.getItem(NAME_KEY)).toBeNull();
  });
});

describe("setMemberToken / clearMemberToken", () => {
  it("stores the token alongside the display name", () => {
    setMemberToken(VALID(), "Doug");
    expect(window.localStorage.getItem(NAME_KEY)).toBe("Doug");
  });

  it("clears both keys on sign-out", () => {
    setMemberToken(VALID(), "Doug");
    clearMemberToken();
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(window.localStorage.getItem(NAME_KEY)).toBeNull();
  });

  it("announces both changes", () => {
    const listener = vi.fn();
    window.addEventListener("wwbh:member-token-changed", listener);
    setMemberToken(VALID(), "Doug");
    clearMemberToken();
    window.removeEventListener("wwbh:member-token-changed", listener);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("useMemberSession", () => {
  it("hydrates from storage after mount", () => {
    const expiresAt = Date.now() + 60_000;
    window.localStorage.setItem(KEY, tokenExpiring(expiresAt));
    window.localStorage.setItem(NAME_KEY, "Doug");
    const { result } = renderHook(() => useMemberSession());
    expect(result.current).toEqual({
      participantId: PARTICIPANT_ID,
      expiresAt,
      token: tokenExpiring(expiresAt),
      name: "Doug",
    });
  });

  it("is null without a token", () => {
    const { result } = renderHook(() => useMemberSession());
    expect(result.current).toBeNull();
  });

  it("picks up a claim that happens while mounted", () => {
    const { result } = renderHook(() => useMemberSession());
    act(() => setMemberToken(VALID(), "Doug"));
    expect(result.current?.name).toBe("Doug");
  });

  it("drops the session on sign-out", () => {
    setMemberToken(VALID(), "Doug");
    const { result } = renderHook(() => useMemberSession());
    act(() => clearMemberToken());
    expect(result.current).toBeNull();
  });

  it("reacts to a claim in another tab", () => {
    const { result } = renderHook(() => useMemberSession());
    window.localStorage.setItem(KEY, VALID());
    window.localStorage.setItem(NAME_KEY, "Doug");
    act(() => {
      window.dispatchEvent(new Event("storage"));
    });
    expect(result.current?.participantId).toBe(PARTICIPANT_ID);
  });

  it("expires the session on its hourly check", () => {
    vi.useFakeTimers();
    try {
      window.localStorage.setItem(KEY, tokenExpiring(Date.now() + 30 * 60_000));
      const { result } = renderHook(() => useMemberSession());
      expect(result.current).not.toBeNull();
      act(() => {
        vi.advanceTimersByTime(61 * 60_000);
      });
      expect(result.current).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
