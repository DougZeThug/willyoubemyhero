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
