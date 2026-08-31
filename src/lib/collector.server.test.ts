// A collector is a participant row that never ran the course.
//
// The properties that matter: exactly one per account (an overwrite would
// strand the first collection), and the pulls made before naming themselves
// come along.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseResponses } from "@/test/supabase-mock";
import { verifyMemberToken } from "./session.server";

let mock = createSupabaseMock();

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return mock.client;
  },
}));

const USER = "10000000-0000-4000-8000-000000000001";
const NEW_ID = "00000000-0000-4000-8000-0000000000c1";
const PLAYER = "00000000-0000-4000-8000-0000000000aa";
const GUEST = "00000000-0000-4000-8000-0000000000e1";

function withDb(responses: SupabaseResponses = {}) {
  mock = createSupabaseMock({
    "participants.insert": { data: { id: NEW_ID, name: "Jane Doe" }, error: null },
    ...responses,
  });
}

async function create(displayName: string, deviceGuestId: string | null = null) {
  const { createCollector } = await import("./collector.server");
  return createCollector(USER, displayName, deviceGuestId ? [deviceGuestId] : []);
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
  withDb();
});

describe("createCollector", () => {
  it("mints a member token against a collector participant", async () => {
    const res = await create("Jane Doe");

    expect(res.participantId).toBe(NEW_ID);
    expect(verifyMemberToken(res.token)?.participantId).toBe(NEW_ID);
    const [insert] = mock.callsFor("participants", "insert");
    expect(insert?.payload).toMatchObject({ name: "Jane Doe", is_collector: true, active: true });
  });

  it("refuses an account that is already a player", async () => {
    withDb({
      "account_identities.select": {
        data: { user_id: USER, participant_id: PLAYER, guest_id: null },
      },
    });
    await expect(create("Jane Doe")).rejects.toThrow(/already has a player/i);
    expect(mock.callsFor("participants", "insert")).toHaveLength(0);
  });

  it("brings the guest pulls made before naming themselves", async () => {
    await create("Jane Doe", GUEST);
    const rpc = mock.client.rpc as unknown as { mock: { calls: [string, unknown][] } };
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(
      expect.arrayContaining(["claim_guest_secrets", "claim_guest_packs"]),
    );
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      _participant_id: NEW_ID,
      _guest_id: GUEST,
    });
  });

  it("restores the account's guest identity when the merge fails", async () => {
    withDb({
      "account_identities.select": {
        data: { user_id: USER, participant_id: null, guest_id: GUEST },
      },
      "account_identities.update": { data: [{ user_id: USER }], error: null },
      "rpc.claim_guest_secrets": { data: null, error: { message: "db down", code: "XX000" } },
    });
    await expect(create("Jane Doe")).rejects.toThrow();

    // The binding write cleared guest_id before the merge could consume it; a
    // failed merge must put the account row back, or a retry with no local
    // guest token can never name that guest again.
    const restore = mock
      .callsFor("account_identities", "update")
      .find((c) => (c.payload as { guest_id?: string | null }).guest_id === GUEST);
    expect(restore?.payload).toMatchObject({ participant_id: null, guest_id: GUEST });
    const retired = mock
      .callsFor("participants", "update")
      .find((c) => (c.payload as { active?: boolean }).active === false);
    expect(retired).toBeTruthy();
  });

  it("deletes the fresh identity row when the merge fails with no guest to restore", async () => {
    withDb({
      "account_identities.insert": { data: null, error: null },
      "rpc.claim_guest_secrets": { data: null, error: { message: "db down", code: "XX000" } },
    });
    await expect(create("Jane Doe", GUEST)).rejects.toThrow();

    // No prior guest: the check constraint forbids both columns null, so the
    // row inserted moments ago is removed rather than restored.
    expect(mock.callsFor("account_identities", "delete")).toHaveLength(1);
    expect(
      mock
        .callsFor("account_identities", "update")
        .some((c) => (c.payload as { participant_id?: string | null }).participant_id === null),
    ).toBe(false);
  });
});
