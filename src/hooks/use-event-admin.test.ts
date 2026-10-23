// Who a stored admin token belongs to, and the one race that could plant it for
// the wrong account. The token names no user and the server checks the event
// alone, so these two hooks and the owner stored beside the token are the whole
// of the account binding.
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { User } from "@supabase/supabase-js";
import { isHeldByAnotherAccount, useEventAdmin } from "./use-event-admin";
import { useAdminAutoUnlock } from "./use-admin-auto-unlock";

const EVENT_ID = "event-1";

const adminSession = vi.fn();
const authUser = vi.fn<() => { user: User | null; loading: boolean }>();
const startAdminSessionFromAccount = vi.fn();
const setAdminToken = vi.fn();

vi.mock("@/lib/admin-token", () => ({
  useAdminSession: () => adminSession(),
  setAdminToken: (...args: unknown[]) => setAdminToken(...args),
}));
vi.mock("@/hooks/use-account", () => ({ useAuthUser: () => authUser() }));
vi.mock("@/lib/admin.functions", () => ({
  startAdminSessionFromAccount: (...args: unknown[]) => startAdminSessionFromAccount(...args),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const userOf = (id: string) => ({ id }) as User;

/** A request the test settles by hand, so the account can change while it is in the air. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  adminSession.mockReturnValue(null);
  authUser.mockReturnValue({ user: null, loading: false });
});

afterEach(() => {
  adminSession.mockReset();
  authUser.mockReset();
  startAdminSessionFromAccount.mockReset();
  setAdminToken.mockReset();
});

describe("isHeldByAnotherAccount", () => {
  it("is true only when both an owner and a signed-in account exist and differ", () => {
    expect(isHeldByAnotherAccount({ owner: "a" }, "b")).toBe(true);
    expect(isHeldByAnotherAccount({ owner: "a" }, "a")).toBe(false);
    // A PIN unlock nobody was signed in for, and a device nobody is signed in on:
    // neither names a second account, and the token outlives a sign-out on purpose.
    expect(isHeldByAnotherAccount({ owner: null }, "b")).toBe(false);
    expect(isHeldByAnotherAccount({ owner: "a" }, null)).toBe(false);
    expect(isHeldByAnotherAccount(null, "b")).toBe(false);
  });
});

describe("useEventAdmin", () => {
  it("is the console for the event the token names", () => {
    adminSession.mockReturnValue({ eventId: EVENT_ID, owner: "a" });
    authUser.mockReturnValue({ user: userOf("a"), loading: false });
    expect(renderHook(() => useEventAdmin(EVENT_ID)).result.current).toBe(true);
    expect(renderHook(() => useEventAdmin("other")).result.current).toBe(false);
    expect(renderHook(() => useEventAdmin(null)).result.current).toBe(false);
  });

  it("is nobody's console until the session has been read", () => {
    // useAuthUser starts at "nobody", and nobody is not "held by another": without
    // this, a cold load paints the previous account's console for the renders before
    // getSession() says who is really signed in.
    adminSession.mockReturnValue({ eventId: EVENT_ID, owner: "a" });
    authUser.mockReturnValue({ user: null, loading: true });
    expect(renderHook(() => useEventAdmin(EVENT_ID)).result.current).toBe(false);
  });

  it("is not the console for a different account on the same handset", () => {
    adminSession.mockReturnValue({ eventId: EVENT_ID, owner: "a" });
    authUser.mockReturnValue({ user: userOf("b"), loading: false });
    expect(renderHook(() => useEventAdmin(EVENT_ID)).result.current).toBe(false);
  });
});

describe("useAdminAutoUnlock", () => {
  const props = (user: User | null, isAdmin = false, loading = false) => ({
    isAdmin,
    user,
    loading,
  });
  const mount = (initial: ReturnType<typeof props>) =>
    renderHook((p) => useAdminAutoUnlock(p.isAdmin, p.user, p.loading), { initialProps: initial });

  it("plants the token, owned by the account that asked", async () => {
    startAdminSessionFromAccount.mockResolvedValue({ ok: true, token: "tok" });
    const { result } = mount(props(userOf("a")));
    await vi.waitFor(() => expect(result.current).toBe(true));
    expect(setAdminToken).toHaveBeenCalledWith("tok", "a");
  });

  it("does not plant an answer for an account that has since signed out", async () => {
    const slow = deferred<{ ok: true; token: string }>();
    // A's request is the slow one; B's own, made once B signs in, says no.
    startAdminSessionFromAccount.mockReturnValueOnce(slow.promise).mockResolvedValue({ ok: false });
    const { result, rerender } = mount(props(userOf("a")));

    // A signs out and B signs in while A's request is still in flight.
    rerender(props(null));
    rerender(props(userOf("b")));
    await act(async () => {
      slow.resolve({ ok: true, token: "a-token" });
      await slow.promise;
    });

    expect(setAdminToken).not.toHaveBeenCalled();
    // B has a check of their own to finish; A's late answer must not mark it done.
    await vi.waitFor(() => expect(result.current).toBe(true));
  });

  it("does not let a stale answer settle the check for the account now signed in", async () => {
    const slowA = deferred<{ ok: false }>();
    const slowB = deferred<{ ok: false }>();
    startAdminSessionFromAccount
      .mockReturnValueOnce(slowA.promise)
      .mockReturnValueOnce(slowB.promise);
    const { result, rerender } = mount(props(userOf("a")));
    rerender(props(userOf("b")));

    await act(async () => {
      slowA.resolve({ ok: false });
      await slowA.promise;
    });
    // B is still being asked, so the PIN gate stays held back.
    expect(result.current).toBe(false);

    await act(async () => {
      slowB.resolve({ ok: false });
      await slowB.promise;
    });
    expect(result.current).toBe(true);
  });

  it("still plants when only the user object changed, as on a token refresh", async () => {
    // Supabase hands out a fresh User for the SAME account on every refresh, and the
    // effect re-runs without asking again. Discarding the one request's answer on
    // that re-run would strand the page on "Checking access…".
    const slow = deferred<{ ok: true; token: string }>();
    startAdminSessionFromAccount.mockReturnValue(slow.promise);
    const { result, rerender } = mount(props(userOf("a")));
    rerender(props(userOf("a")));
    await act(async () => {
      slow.resolve({ ok: true, token: "tok" });
      await slow.promise;
    });
    expect(startAdminSessionFromAccount).toHaveBeenCalledOnce();
    expect(setAdminToken).toHaveBeenCalledWith("tok", "a");
    expect(result.current).toBe(true);
  });

  it("asks again when the same account signs back in after a discarded answer", async () => {
    // A signs out with a request in the air; its answer is dropped, unheard. A signing
    // back in must not be skipped on a latch that outlived that request.
    const slow = deferred<{ ok: false }>();
    startAdminSessionFromAccount
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValue({ ok: true, token: "tok" });
    const { result, rerender } = mount(props(userOf("a")));
    rerender(props(null));
    await act(async () => {
      slow.resolve({ ok: false });
      await slow.promise;
    });
    rerender(props(userOf("a")));
    await vi.waitFor(() => expect(setAdminToken).toHaveBeenCalledWith("tok", "a"));
    await vi.waitFor(() => expect(result.current).toBe(true));
    expect(startAdminSessionFromAccount).toHaveBeenCalledTimes(2);
  });

  it("asks again on the next auth event after a call that threw", async () => {
    // A dropped connection says nothing about whether this account is an admin, so
    // the next token refresh gets another go instead of leaving the PIN as the
    // only way in.
    startAdminSessionFromAccount
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ ok: true, token: "tok" });
    const { result, rerender } = mount(props(userOf("a")));
    await vi.waitFor(() => expect(result.current).toBe(true));
    expect(setAdminToken).not.toHaveBeenCalled();

    rerender(props(userOf("a")));
    await vi.waitFor(() => expect(setAdminToken).toHaveBeenCalledWith("tok", "a"));
    expect(startAdminSessionFromAccount).toHaveBeenCalledTimes(2);
  });

  it("asks again after finding no live event, which is a passing condition", async () => {
    startAdminSessionFromAccount
      .mockResolvedValueOnce({ ok: false, reason: "event_not_found" })
      .mockResolvedValue({ ok: true, token: "tok" });
    const { result, rerender } = mount(props(userOf("a")));
    await vi.waitFor(() => expect(result.current).toBe(true));

    rerender(props(userOf("a")));
    await vi.waitFor(() => expect(setAdminToken).toHaveBeenCalledWith("tok", "a"));
  });

  it("does not ask again once the account is known not to be an admin", async () => {
    startAdminSessionFromAccount.mockResolvedValue({ ok: false, reason: "not_admin" });
    const { result, rerender } = mount(props(userOf("a")));
    await vi.waitFor(() => expect(result.current).toBe(true));

    rerender(props(userOf("a")));
    rerender(props(userOf("a")));
    expect(startAdminSessionFromAccount).toHaveBeenCalledOnce();
  });

  it("keeps the PIN gate up while a retry is in the air", async () => {
    // Blanking `accountChecked` for the retry would swap the PIN form for
    // "Checking access…" under a commissioner who is already typing.
    const retry = deferred<{ ok: false; reason: "not_admin" }>();
    startAdminSessionFromAccount
      .mockRejectedValueOnce(new Error("offline"))
      .mockReturnValueOnce(retry.promise);
    const { result, rerender } = mount(props(userOf("a")));
    await vi.waitFor(() => expect(result.current).toBe(true));

    rerender(props(userOf("a")));
    await vi.waitFor(() => expect(startAdminSessionFromAccount).toHaveBeenCalledTimes(2));
    expect(result.current).toBe(true);

    await act(async () => {
      retry.resolve({ ok: false, reason: "not_admin" });
      await retry.promise;
    });
    expect(result.current).toBe(true);
  });

  it("asks nothing of the server for somebody who is signed out", async () => {
    const { result } = mount(props(null));
    await vi.waitFor(() => expect(result.current).toBe(true));
    expect(startAdminSessionFromAccount).not.toHaveBeenCalled();
  });

  describe("Lock", () => {
    // A stored token makes `isAdmin` true on the first settled render, so the hook
    // never gets as far as asking. Lock clears the token; that must read as the
    // commissioner's choice, not as a first visit to be answered with a new token.
    it("does not hand the console back to an account that arrived already unlocked", async () => {
      startAdminSessionFromAccount.mockResolvedValue({ ok: true, token: "fresh" });
      const { result, rerender } = mount(props(userOf("a"), true));
      expect(result.current).toBe(true);

      rerender(props(userOf("a"), false));
      await act(async () => {
        await Promise.resolve();
      });

      expect(startAdminSessionFromAccount).not.toHaveBeenCalled();
      expect(setAdminToken).not.toHaveBeenCalled();
      // Straight to the PIN gate, not "Checking access…" for a round trip.
      expect(result.current).toBe(true);
    });

    it("still asks for the next account that signs in after a Lock", async () => {
      startAdminSessionFromAccount.mockResolvedValue({ ok: true, token: "b-token" });
      const { rerender } = mount(props(userOf("a"), true));
      rerender(props(userOf("a"), false));
      rerender(props(userOf("b"), false));

      await vi.waitFor(() => expect(setAdminToken).toHaveBeenCalledWith("b-token", "b"));
      expect(startAdminSessionFromAccount).toHaveBeenCalledOnce();
    });

    it("does not let a request made before the console was held reopen it after Lock", async () => {
      // A cold load asks while `isAdmin` is still false; the console is then held
      // (a PIN, another tab) and Locked while that answer is still in the air. Same
      // account, same latch: only voiding the request stops it re-planting the token.
      const slow = deferred<{ ok: true; token: string }>();
      startAdminSessionFromAccount.mockReturnValueOnce(slow.promise);
      const { rerender } = mount(props(userOf("a")));

      rerender(props(userOf("a"), true));
      rerender(props(userOf("a"), false));
      await act(async () => {
        slow.resolve({ ok: true, token: "late-token" });
        await slow.promise;
      });

      expect(setAdminToken).not.toHaveBeenCalled();
      expect(startAdminSessionFromAccount).toHaveBeenCalledOnce();
    });

    it("leaves a signed-out device that holds a token alone", () => {
      // The token outlives a sign-out on purpose (ADM-16); nobody is there to ask for.
      const { result } = mount(props(null, true));
      expect(result.current).toBe(true);
      expect(startAdminSessionFromAccount).not.toHaveBeenCalled();
    });
  });

  describe("a request that outlived the page", () => {
    it("does not plant a token once the hook has unmounted", async () => {
      const late = deferred<{ ok: true; token: string }>();
      startAdminSessionFromAccount.mockReturnValueOnce(late.promise);
      const { unmount } = mount(props(userOf("a")));
      await vi.waitFor(() => expect(startAdminSessionFromAccount).toHaveBeenCalledOnce());
      unmount();

      await act(async () => {
        late.resolve({ ok: true, token: "late-token" });
        await late.promise;
      });

      expect(setAdminToken).not.toHaveBeenCalled();
    });

    it("still unlocks under StrictMode's fake unmount and remount", async () => {
      startAdminSessionFromAccount.mockResolvedValue({ ok: true, token: "tok" });
      renderHook((p) => useAdminAutoUnlock(p.isAdmin, p.user, p.loading), {
        initialProps: props(userOf("a")),
        wrapper: StrictMode,
      });
      await vi.waitFor(() => expect(setAdminToken).toHaveBeenCalledWith("tok", "a"));
    });
  });

  describe("a request that outlived a sign-out", () => {
    // Signing out resets the latch so the same account is asked again, but the first
    // request is still in the air. When it lands, the account is "current" again and
    // an id-only check lets it through over the answer the second one gave.
    it("does not plant a stale ok over the fresh answer for the same account", async () => {
      const stale = deferred<{ ok: true; token: string }>();
      startAdminSessionFromAccount
        .mockReturnValueOnce(stale.promise)
        .mockResolvedValue({ ok: false, reason: "not_admin" });
      const { result, rerender } = mount(props(userOf("a")));
      rerender(props(null));
      rerender(props(userOf("a")));
      await vi.waitFor(() => expect(startAdminSessionFromAccount).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(result.current).toBe(true));

      await act(async () => {
        stale.resolve({ ok: true, token: "stale-token" });
        await stale.promise;
      });

      expect(setAdminToken).not.toHaveBeenCalled();
    });

    it("does not let the stale answer settle the check the fresh request is making", async () => {
      const stale = deferred<{ ok: false; reason: "not_admin" }>();
      const fresh = deferred<{ ok: false; reason: "not_admin" }>();
      startAdminSessionFromAccount
        .mockReturnValueOnce(stale.promise)
        .mockReturnValueOnce(fresh.promise);
      const { result, rerender } = mount(props(userOf("a")));
      rerender(props(null));
      // Signed out is "nothing to check", and A coming back makes it a check again.
      rerender(props(userOf("a")));
      await vi.waitFor(() => expect(result.current).toBe(false));

      await act(async () => {
        stale.resolve({ ok: false, reason: "not_admin" });
        await stale.promise;
      });
      // The PIN gate stays held back: the answer that counts is still on its way.
      expect(result.current).toBe(false);

      await act(async () => {
        fresh.resolve({ ok: false, reason: "not_admin" });
        await fresh.promise;
      });
      expect(result.current).toBe(true);
    });

    it("drops the first answer when the account went A to B to A without being signed out", async () => {
      const first = deferred<{ ok: true; token: string }>();
      startAdminSessionFromAccount
        .mockReturnValueOnce(first.promise)
        .mockResolvedValue({ ok: false, reason: "not_admin" });
      const { rerender } = mount(props(userOf("a")));
      rerender(props(userOf("b")));
      rerender(props(userOf("a")));
      await vi.waitFor(() => expect(startAdminSessionFromAccount).toHaveBeenCalledTimes(3));

      await act(async () => {
        first.resolve({ ok: true, token: "stale-token" });
        await first.promise;
      });

      expect(setAdminToken).not.toHaveBeenCalled();
    });
  });
});
