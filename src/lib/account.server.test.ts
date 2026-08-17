// Adopting an identity, rather than minting a new one.
//
// The property that matters: signing in must never leave a device's collection
// behind. The first sign-in adopts whatever the phone already holds — no rows
// move, so nothing can half-move — and every later sign-in folds a stray guest
// id into the account's identity instead of stranding it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseResponses } from "@/test/supabase-mock";
import { verifyGuestToken, verifyMemberToken } from "./session.server";

let mock = createSupabaseMock();

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return mock.client;
  },
}));

const USER = "10000000-0000-4000-8000-000000000001";
const PLAYER = "00000000-0000-4000-8000-0000000000aa";
const GUEST_ACCOUNT = "00000000-0000-4000-8000-0000000000e1";
const GUEST_DEVICE = "00000000-0000-4000-8000-0000000000e2";

function withDb(responses: SupabaseResponses = {}) {
  mock = createSupabaseMock(responses);
}

function existing(row: { participant_id?: string | null; guest_id?: string | null }) {
  return {
    "account_identities.select": {
      data: { user_id: USER, participant_id: null, guest_id: null, ...row },
    },
    "participants.select": { data: { name: "Alice" } },
  } satisfies SupabaseResponses;
}

async function sync(device: { memberId: string | null; guestId: string | null }) {
  const { syncAccount } = await import("./account.server");
  return syncAccount(USER, device);
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
  withDb();
});

describe("syncAccount", () => {
  it("adopts the device's claimed player on a first sign-in", async () => {
    withDb({ "participants.select": { data: { name: "Alice" } } });
    const res = await sync({ memberId: PLAYER, guestId: null });

    expect(res).toMatchObject({ kind: "member", id: PLAYER, name: "Alice" });
    expect(verifyMemberToken(res.token)?.participantId).toBe(PLAYER);
    const [saved] = mock.callsFor("account_identities", "upsert");
    expect(saved?.payload).toMatchObject({ user_id: USER, participant_id: PLAYER });
  });

  it("adopts the device's guest identity rather than minting a fresh one", async () => {
    // Minting here would silently abandon everything this phone had pulled.
    const res = await sync({ memberId: null, guestId: GUEST_DEVICE });

    expect(res).toMatchObject({ kind: "guest", id: GUEST_DEVICE });
    expect(verifyGuestToken(res.token)?.guestId).toBe(GUEST_DEVICE);
  });

  it("mints a guest identity for an account signing in on a blank device", async () => {
    const res = await sync({ memberId: null, guestId: null });
    expect(res.kind).toBe("guest");
    expect(verifyGuestToken(res.token)?.guestId).toBe(res.id);
  });

  it("returns the account's own identity on a second device", async () => {
    withDb(existing({ participant_id: PLAYER }));
    const res = await sync({ memberId: null, guestId: null });

    expect(res).toMatchObject({ kind: "member", id: PLAYER });
    expect(mock.callsFor("account_identities", "upsert")).toHaveLength(0);
  });

  it("folds a stray guest id on this phone into the account's guest collection", async () => {
    withDb(existing({ guest_id: GUEST_ACCOUNT }));
    const res = await sync({ memberId: null, guestId: GUEST_DEVICE });

    expect(res.id).toBe(GUEST_ACCOUNT);
    expect(mock.client.rpc).toHaveBeenCalledWith("merge_guest_pulls", {
      _into_guest: GUEST_ACCOUNT,
      _from_guest: GUEST_DEVICE,
    });
  });

  it("does not merge a guest id into itself", async () => {
    withDb(existing({ guest_id: GUEST_ACCOUNT }));
    await sync({ memberId: null, guestId: GUEST_ACCOUNT });
    expect(mock.client.rpc).not.toHaveBeenCalled();
  });

  it("upgrades a guest account once the phone claims a roster player", async () => {
    withDb(existing({ guest_id: GUEST_ACCOUNT }));
    const res = await sync({ memberId: PLAYER, guestId: null });

    expect(res).toMatchObject({ kind: "member", id: PLAYER });
    expect(mock.client.rpc).toHaveBeenCalledWith("claim_guest_secrets", {
      _participant_id: PLAYER,
      _guest_id: GUEST_ACCOUNT,
    });
  });

  it("survives a merge that fails, because a sign-in is worth more than a merge", async () => {
    withDb({
      ...existing({ guest_id: GUEST_ACCOUNT }),
      "rpc.merge_guest_pulls": { error: { message: "nope" } },
    });
    const res = await sync({ memberId: null, guestId: GUEST_DEVICE });
    expect(res.id).toBe(GUEST_ACCOUNT);
  });
});
