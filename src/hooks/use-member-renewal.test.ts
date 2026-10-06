// The root-mounted renewal: at load, then hourly.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { renewMemberSession } from "@/lib/member.functions";
import { useMemberTokenRenewal } from "./use-member-renewal";

vi.mock("@/lib/member.functions", () => ({ renewMemberSession: vi.fn() }));

const KEY = "wwbh:member-token";
const PARTICIPANT_ID = "00000000-0000-4000-8000-0000000000aa";
const DAY = 24 * 60 * 60 * 1000;
const tokenFor = (expiresAt: number) => `m.${PARTICIPANT_ID}.${expiresAt}.signature`;

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(renewMemberSession).mockReset();
});

describe("useMemberTokenRenewal", () => {
  it("renews a token in its last month as the app loads", async () => {
    window.localStorage.setItem(KEY, tokenFor(Date.now() + 5 * DAY));
    const fresh = tokenFor(Date.now() + 90 * DAY);
    vi.mocked(renewMemberSession).mockResolvedValue({
      ok: true,
      token: fresh,
      expiresAt: Date.now() + 90 * DAY,
    });
    renderHook(() => useMemberTokenRenewal());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(renewMemberSession).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(KEY)).toBe(fresh);
  });

  it("checks again on the hourly tick, and only asks once the token is due", async () => {
    // Thirty days and an hour left: not due at load, due an hour and a bit later.
    window.localStorage.setItem(KEY, tokenFor(Date.now() + 30 * DAY + 30 * 60_000));
    vi.mocked(renewMemberSession).mockResolvedValue({ ok: false, reason: "no_player" });
    renderHook(() => useMemberTokenRenewal());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(renewMemberSession).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60_000);
    });
    expect(renewMemberSession).toHaveBeenCalledTimes(1);
    // A refusal is not retried until the next tick.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59 * 60_000);
    });
    expect(renewMemberSession).toHaveBeenCalledTimes(1);
  });

  it("never asks for a device with no member token", async () => {
    renderHook(() => useMemberTokenRenewal());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 60 * 60_000);
    });
    expect(renewMemberSession).not.toHaveBeenCalled();
  });
});
