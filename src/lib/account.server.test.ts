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
const OTHER_PLAYER = "00000000-0000-4000-8000-0000000000bb";

function withDb(responses: SupabaseResponses = {}) {
  mock = createSupabaseMock(responses);
}

function existing(row: { participant_id?: string | null; guest_id?: string | null }) {
  return {
    "account_identities.select": {
      data: { user_id: USER, participant_id: null, guest_id: null, ...row },
    },
    "participants.select": { data: { name: "Alice" } },
    // The guarded guest -> member upgrade reads back the rows it changed.
    "account_identities.update": { data: [{ user_id: USER }] },
  } satisfies SupabaseResponses;
}

async function sync(device: { memberId: string | null; guestId: string | null }) {
  const { syncAccount } = await import("./account.server");
  return syncAccount(USER, {
    memberId: device.memberId,
    guestIds: device.guestId ? [device.guestId] : [],
  });
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
    const [saved] = mock.callsFor("account_identities", "insert");
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
    expect(mock.callsFor("account_identities", "insert")).toHaveLength(0);
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
    withDb({
      ...existing({ guest_id: GUEST_ACCOUNT }),
      "rpc.bind_account_to_player": {
        data: { bound: true, boundParticipantId: PLAYER, boundName: "Alice", name: "Alice" },
      },
    });
    const res = await sync({ memberId: PLAYER, guestId: null });

    expect(res).toMatchObject({ kind: "member", id: PLAYER });
    // One statement, not a row write followed by three moves. The upgrade and
    // the emptying of the guest id it abandons have to commit together, or a
    // failure between them leaves the account holding a player and part of its
    // old collection filed under a guest id nothing reads again.
    expect(mock.client.rpc).toHaveBeenCalledWith("bind_account_to_player", {
      _user_id: USER,
      _participant_id: PLAYER,
      _guest_id: GUEST_ACCOUNT,
    });
    expect(mock.client.rpc).not.toHaveBeenCalledWith("claim_guest_secrets", expect.anything());
    expect(mock.callsFor("account_identities", "update")).toHaveLength(0);
  });

  it("takes the player another device bound first, rather than the one it asked for", async () => {
    // Two handsets claiming at once. The row is authoritative and the winner's
    // binding stands; what must not happen is this device's guest collection
    // being left behind because the bind it attempted lost.
    withDb({
      ...existing({ guest_id: GUEST_ACCOUNT }),
      "rpc.bind_account_to_player": {
        data: { bound: false, boundParticipantId: OTHER_PLAYER, boundName: "Bob", name: "Alice" },
      },
    });
    const res = await sync({ memberId: PLAYER, guestId: null });
    expect(res).toMatchObject({ kind: "member", id: OTHER_PLAYER });
  });

  it("stays a guest when the account turns out to be bound to nobody", async () => {
    withDb({
      ...existing({ guest_id: GUEST_ACCOUNT }),
      "rpc.bind_account_to_player": { data: { bound: false, boundParticipantId: null } },
    });
    const res = await sync({ memberId: PLAYER, guestId: null });
    expect(res).toMatchObject({ kind: "guest", id: GUEST_ACCOUNT });
  });

  it("refuses to hand back an identity when the upgrade fails", async () => {
    // The whole point of doing this in one statement: a failure has to leave the
    // device exactly where it was, with its guest token still good.
    withDb({
      ...existing({ guest_id: GUEST_ACCOUNT }),
      "rpc.bind_account_to_player": { error: { message: "nope" } },
    });
    await expect(sync({ memberId: PLAYER, guestId: null })).rejects.toEqual({ message: "nope" });
  });

  it("refuses to replace the device identity when a merge fails", async () => {
    withDb({
      ...existing({ guest_id: GUEST_ACCOUNT }),
      "rpc.merge_guest_pulls": { error: { message: "nope" } },
    });
    await expect(sync({ memberId: null, guestId: GUEST_DEVICE })).rejects.toEqual({
      message: "nope",
    });
  });

  it("merges both the live and pre-auth guest identities", async () => {
    withDb(existing({ guest_id: GUEST_ACCOUNT }));
    const { syncAccount } = await import("./account.server");
    await syncAccount(USER, { memberId: null, guestIds: [GUEST_DEVICE, GUEST_ACCOUNT] });
    expect(mock.client.rpc).toHaveBeenCalledWith("merge_guest_pulls", {
      _into_guest: GUEST_ACCOUNT,
      _from_guest: GUEST_DEVICE,
    });
  });
});

describe("bindParticipant", () => {
  async function bind(participantId = PLAYER) {
    const { bindParticipant } = await import("./account.server");
    return bindParticipant(USER, participantId);
  }

  it("binds and moves the collection in one statement", async () => {
    // This used to be an insert-or-update followed by three separate
    // `claim_guest_*` requests, each its own transaction. A timeout on the
    // second left the account bound to the player with its packs and streak
    // rungs still filed under the guest id — and nothing to roll the row back.
    withDb({
      "rpc.bind_account_to_player": { data: { bound: true, name: "Alice" } },
    });
    const res = await bind();

    expect(res).toEqual({ kind: "member", id: PLAYER, name: "Alice" });
    expect(mock.client.rpc).toHaveBeenCalledWith("bind_account_to_player", {
      _user_id: USER,
      _participant_id: PLAYER,
    });
    expect(mock.callsFor("account_identities", "insert")).toHaveLength(0);
    expect(mock.callsFor("account_identities", "update")).toHaveLength(0);
    expect(mock.client.rpc).not.toHaveBeenCalledWith("claim_guest_packs", expect.anything());
  });

  it("refuses an account already spoken for, and says by whom", async () => {
    // A named refusal rather than a throw the caller cannot tell from a flaky
    // request: the claim screen said "Welcome" to both, while the account went
    // on pointing at the old player for every other device.
    withDb({
      "rpc.bind_account_to_player": { data: { bound: false, boundName: "Bob", name: "Alice" } },
    });
    const { AccountAlreadyLinkedError } = await import("./account.server");
    await expect(bind()).rejects.toBeInstanceOf(AccountAlreadyLinkedError);
    await expect(bind()).rejects.toMatchObject({ reason: "already_linked", boundName: "Bob" });
  });

  it("writes nothing at all when the statement fails", async () => {
    withDb({ "rpc.bind_account_to_player": { error: { message: "nope" } } });
    await expect(bind()).rejects.toEqual({ message: "nope" });
    expect(mock.callsFor("account_identities", "insert")).toHaveLength(0);
    expect(mock.callsFor("account_identities", "update")).toHaveLength(0);
  });
});
