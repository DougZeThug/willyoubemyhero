import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { syncAccountSession } from "@/lib/account.functions";
import { adoptLocalCollection, snapshotLocalCollection } from "@/lib/adopt-collection";
import { setAccountSyncState, type AccountSyncState } from "@/lib/account-sync-state";
import { signOutAccount, useAccountSync } from "./use-account";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signOut: vi.fn(),
    },
  },
}));

vi.mock("@/lib/account.functions", () => ({
  syncAccountSession: vi.fn(),
}));

vi.mock("@/lib/adopt-collection", () => ({
  adoptLocalCollection: vi.fn(),
  snapshotLocalCollection: vi.fn(),
}));

// The state module is a singleton; read it the way the app does.
let lastState: AccountSyncState | null = null;
vi.mock("@/lib/account-sync-state", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/account-sync-state")>();
  return {
    ...mod,
    setAccountSyncState: (next: AccountSyncState) => {
      lastState = next;
      mod.setAccountSyncState(next);
    },
  };
});

const MEMBER_TOKEN = "m.00000000-0000-4000-8000-0000000000aa.9999999999999.sig";
const GUEST_TOKEN = "g.00000000-0000-4000-8000-0000000000e1.9999999999999.sig";
const user = { id: "user-1" } as User;
const held = {
  "ep-1": { eventParticipantId: "ep-1", pulledAt: 1, count: 1, tier: "base", edition: "standard" },
};

describe("signOutAccount", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(supabase.auth.signOut).mockResolvedValue({ error: null });
  });

  it("clears the admin token alongside the member token", async () => {
    window.localStorage.setItem("wwbh:admin-token", "event.9999999999999.signature");
    window.localStorage.setItem("wwbh:member-token", "m.participant.9999999999999.signature");

    await signOutAccount();

    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(window.localStorage.getItem("wwbh:admin-token")).toBeNull();
    expect(window.localStorage.getItem("wwbh:member-token")).toBeNull();
  });
});

describe("useAccountSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    window.localStorage.setItem("wwbh:guest-token", GUEST_TOKEN);
    lastState = null;
    setAccountSyncState({ status: "idle", userId: null, message: null });
    vi.mocked(snapshotLocalCollection).mockResolvedValue(held);
    vi.mocked(syncAccountSession).mockResolvedValue({
      kind: "member",
      token: MEMBER_TOKEN,
      name: "Alice",
    } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(adoptLocalCollection).mockReset();
    vi.mocked(syncAccountSession).mockReset();
    vi.mocked(snapshotLocalCollection).mockReset();
  });

  async function settle() {
    // The retry loop backs off 1s, 2s, 4s, 8s; run past all of it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
  }

  it("keeps the member token and drops the guest one once the cards are filed", async () => {
    vi.mocked(adoptLocalCollection).mockResolvedValue(1);
    renderHook(() => useAccountSync(user));
    await settle();

    expect(window.localStorage.getItem("wwbh:member-token")).toBe(MEMBER_TOKEN);
    expect(window.localStorage.getItem("wwbh:guest-token")).toBeNull();
    expect(adoptLocalCollection).toHaveBeenCalledWith(held);
    expect(lastState).toMatchObject({ status: "ready", userId: "user-1" });
  });

  it("takes the member token back off when the cards cannot be filed", async () => {
    // The claim screen's rule, which this path used to skip: a member token
    // with no upload behind it makes the collection hook prune the guest's
    // cards against a server that has never heard of them.
    vi.mocked(adoptLocalCollection).mockRejectedValue(new Error("offline"));
    renderHook(() => useAccountSync(user));
    await settle();

    expect(window.localStorage.getItem("wwbh:member-token")).toBeNull();
    // The guest identity the cards live under survives, so nothing is orphaned.
    expect(window.localStorage.getItem("wwbh:guest-token")).toBe(GUEST_TOKEN);
    expect(lastState).toMatchObject({ status: "error", userId: "user-1" });
  });

  it("leaves a newer account's tokens alone when a stale adoption settles late", async () => {
    // Sign in as one account, switch to another while the first upload is still
    // in flight, then let the first one fail: the cleanup set `cancelled`, and
    // the stale run must not take the second account's member token with it.
    let rejectFirst: (e: Error) => void = () => {};
    vi.mocked(adoptLocalCollection)
      .mockImplementationOnce(
        () =>
          new Promise<number>((_, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockResolvedValue(1);
    const SECOND_TOKEN = "m.00000000-0000-4000-8000-0000000000bb.9999999999999.sig";
    vi.mocked(syncAccountSession)
      .mockResolvedValueOnce({ kind: "member", token: MEMBER_TOKEN, name: "Alice" } as never)
      .mockResolvedValue({ kind: "member", token: SECOND_TOKEN, name: "Bob" } as never);

    const { rerender } = renderHook(({ u }) => useAccountSync(u), { initialProps: { u: user } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    rerender({ u: { id: "user-2" } as User });
    await settle();
    expect(window.localStorage.getItem("wwbh:member-token")).toBe(SECOND_TOKEN);

    // The stale run's retry has to fail too, or the guard inside the catch is
    // never the thing keeping the token: a retry that succeeded would exit
    // through the guard after it.
    vi.mocked(adoptLocalCollection).mockRejectedValue(new Error("late again"));
    rejectFirst(new Error("late"));
    await settle();
    expect(window.localStorage.getItem("wwbh:member-token")).toBe(SECOND_TOKEN);
    expect(lastState).toMatchObject({ status: "ready", userId: "user-2" });
  });

  it("does not treat a refreshed User object for the same id as a new sign-in", async () => {
    // Supabase hands out a fresh object on every token refresh. Keyed on the
    // object, the effect cancelled a sync mid-adoption and then skipped the
    // re-run, so the account screen sat on "syncing" until a reload.
    let resolveAdopt: (n: number) => void = () => {};
    vi.mocked(adoptLocalCollection).mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          resolveAdopt = resolve;
        }),
    );
    const { rerender } = renderHook(({ u }) => useAccountSync(u), { initialProps: { u: user } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    rerender({ u: { id: "user-1" } as User });
    resolveAdopt(1);
    await settle();

    expect(syncAccountSession).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem("wwbh:member-token")).toBe(MEMBER_TOKEN);
    expect(window.localStorage.getItem("wwbh:guest-token")).toBeNull();
    expect(lastState).toMatchObject({ status: "ready", userId: "user-1" });
  });

  it("takes the previous account's member token off before the next account syncs", async () => {
    // syncAccount binds a first-time account to whatever `x-member-token` the
    // device sends. The token the last account's run wrote must not be it.
    vi.mocked(adoptLocalCollection).mockResolvedValue(1);
    const { rerender } = renderHook(({ u }) => useAccountSync(u), { initialProps: { u: user } });
    await settle();
    expect(window.localStorage.getItem("wwbh:member-token")).toBe(MEMBER_TOKEN);

    let seenAtSync: string | null = "unread";
    const SECOND_TOKEN = "m.00000000-0000-4000-8000-0000000000bb.9999999999999.sig";
    vi.mocked(syncAccountSession).mockImplementation(async () => {
      seenAtSync = window.localStorage.getItem("wwbh:member-token");
      return { kind: "member", token: SECOND_TOKEN, name: "Bob" } as never;
    });
    rerender({ u: { id: "user-2" } as User });
    await settle();

    expect(seenAtSync).toBeNull();
    expect(window.localStorage.getItem("wwbh:member-token")).toBe(SECOND_TOKEN);
  });

  it("takes a previous account's token off even when the switch lands mid-sync", async () => {
    // The token on the device came from an earlier visit, so this run never
    // wrote it — and a switch before the first request returns must still not
    // let the next account's sync read it.
    const OLD_TOKEN = "m.00000000-0000-4000-8000-0000000000cc.9999999999999.sig";
    window.localStorage.setItem("wwbh:member-token", OLD_TOKEN);
    let seenAtSync: string | null = "unread";
    const SECOND_TOKEN = "m.00000000-0000-4000-8000-0000000000bb.9999999999999.sig";
    vi.mocked(syncAccountSession)
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementation(async () => {
        seenAtSync = window.localStorage.getItem("wwbh:member-token");
        return { kind: "member", token: SECOND_TOKEN, name: "Bob" } as never;
      });
    vi.mocked(adoptLocalCollection).mockResolvedValue(1);

    const { rerender } = renderHook(({ u }) => useAccountSync(u), { initialProps: { u: user } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    rerender({ u: { id: "user-2" } as User });
    await settle();

    expect(seenAtSync).toBeNull();
    expect(window.localStorage.getItem("wwbh:member-token")).toBe(SECOND_TOKEN);
  });

  it("keeps a token it did not write on a device that has never synced", async () => {
    // The paper-code-then-sign-in path: the token IS the identity the account
    // should adopt, and the first request has to carry it.
    const CLAIM_TOKEN = "m.00000000-0000-4000-8000-0000000000cc.9999999999999.sig";
    window.localStorage.setItem("wwbh:member-token", CLAIM_TOKEN);
    let seenAtSync: string | null = "unread";
    vi.mocked(syncAccountSession).mockImplementation(async () => {
      seenAtSync = window.localStorage.getItem("wwbh:member-token");
      return { kind: "member", token: MEMBER_TOKEN, name: "Alice" } as never;
    });
    vi.mocked(adoptLocalCollection).mockResolvedValue(1);
    renderHook(() => useAccountSync(user));
    await settle();
    expect(seenAtSync).toBe(CLAIM_TOKEN);
  });

  it("tries again a minute after giving up, without the user changing", async () => {
    // Keyed on the id, a token refresh no longer re-runs the effect, so the
    // retry has to be the hook's own.
    vi.mocked(adoptLocalCollection).mockRejectedValue(new Error("offline"));
    renderHook(() => useAccountSync(user));
    await settle();
    expect(lastState).toMatchObject({ status: "error" });
    const attempts = vi.mocked(syncAccountSession).mock.calls.length;
    expect(attempts).toBe(4);

    // Between attempts the token was briefly on the device, and the collection
    // hook may have pruned the store in that window. The retry has to file the
    // cards as they stood before the first attempt, not as they stand now.
    vi.mocked(snapshotLocalCollection).mockResolvedValue({});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(vi.mocked(syncAccountSession).mock.calls.length).toBeGreaterThan(attempts);
    expect(snapshotLocalCollection).toHaveBeenCalledTimes(1);
    expect(adoptLocalCollection).toHaveBeenLastCalledWith(held);
  });

  it("backs off between wakes and stops polling after a handful", async () => {
    vi.mocked(adoptLocalCollection).mockRejectedValue(new Error("offline"));
    renderHook(() => useAccountSync(user));
    // Six wakes at 1, 2, 4, 8, 15, 15 minutes. Advanced in slices, because each
    // wake is a state change React only acts on between them, and the next
    // timer is armed by the effect that runs after that.
    async function hours(n: number) {
      for (let i = 0; i < n * 12; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(5 * 60_000);
        });
      }
    }
    await hours(2);
    const after = vi.mocked(syncAccountSession).mock.calls.length;
    // 4 attempts per run, 7 runs (the first plus six wakes).
    expect(after).toBe(28);
    await hours(2);
    expect(vi.mocked(syncAccountSession).mock.calls.length).toBe(after);
    // The radio coming back is still a reason to try.
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await settle();
    expect(vi.mocked(syncAccountSession).mock.calls.length).toBe(after + 4);
  });

  it("snapshots the store once, before the first token lands", async () => {
    // A re-read on retry would adopt whatever the prune had already left.
    vi.mocked(adoptLocalCollection)
      .mockRejectedValueOnce(new Error("flaky"))
      .mockRejectedValueOnce(new Error("flaky"))
      .mockResolvedValue(1);
    renderHook(() => useAccountSync(user));
    await settle();

    expect(snapshotLocalCollection).toHaveBeenCalledTimes(1);
    expect(adoptLocalCollection).toHaveBeenLastCalledWith(held);
    expect(window.localStorage.getItem("wwbh:member-token")).toBe(MEMBER_TOKEN);
    expect(lastState).toMatchObject({ status: "ready" });
  });
});
