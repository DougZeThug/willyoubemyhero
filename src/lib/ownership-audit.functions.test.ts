// Which devices the commissioner can actually see.
//
// The panel exists because a pack opened before somebody claimed a player is
// filed against the DEVICE that opened it: those cards show in that person's own
// vault and behave as if nobody owns them, which is every "it's not in my
// available cards" report. Attaching one to a player is the only repair, so a
// device the panel cannot list is a device nobody can fix.
//
// A guest collection is three tables and moves in three steps. This list was
// built from the secrets alone, so the handset that most needed finding — one
// whose secrets moved and whose packs or streak rungs did not — was the one it
// could not see at all.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseResponses } from "@/test/supabase-mock";
import { adminHeaders, callServerFn, memberHeaders } from "@/test/server-fn";
import { signAdminToken, signMemberToken } from "./session.server";
import type { OwnershipAudit } from "./ownership-audit.functions";

let mock = createSupabaseMock();

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return mock.client;
  },
}));

const EVENT_ID = "00000000-0000-4000-8000-0000000000ff";
const ALICE = "00000000-0000-4000-8000-0000000000aa";
const GUEST_A = "00000000-0000-4000-8000-00000000de01";
const GUEST_B = "00000000-0000-4000-8000-00000000de02";
const GUEST_C = "00000000-0000-4000-8000-00000000de03";
const CARD = "00000000-0000-4000-8000-00000000ce01";

function withDb(responses: SupabaseResponses = {}) {
  mock = createSupabaseMock({
    "participants.select": { data: [{ id: ALICE, name: "Alice", is_collector: false }] },
    ...responses,
  });
}

const asAdmin = () => adminHeaders(signAdminToken(EVENT_ID).token);

async function audit() {
  const { getOwnershipAudit } = await import("./ownership-audit.functions");
  return callServerFn<OwnershipAudit>(getOwnershipAudit, {
    data: { eventId: EVENT_ID },
    headers: asAdmin(),
  });
}

/** A guest-held secret pull row, in the shape the handler selects. */
const pull = (guestId: string) => ({
  participant_id: null,
  guest_id: guestId,
  secret_card_id: CARD,
  granted: false,
  pulled_on: "2026-09-01",
});

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
  withDb();
});

describe("the ownership audit's guard", () => {
  it("refuses a caller with no admin token", async () => {
    const { getOwnershipAudit } = await import("./ownership-audit.functions");
    await expect(callServerFn(getOwnershipAudit, { data: { eventId: EVENT_ID } })).rejects.toThrow(
      "Admin PIN required",
    );
  });

  it("refuses a member token", async () => {
    const { getOwnershipAudit } = await import("./ownership-audit.functions");
    await expect(
      callServerFn(getOwnershipAudit, {
        data: { eventId: EVENT_ID },
        headers: memberHeaders(signMemberToken(ALICE).token),
      }),
    ).rejects.toThrow("Admin PIN required");
  });
});

describe("devices holding cards nobody can trade", () => {
  it("lists a device holding secrets", async () => {
    withDb({ "secret_card_pulls.select": { data: [pull(GUEST_A)] } });
    const res = await audit();
    expect(res.stranded.map((d) => d.guestId)).toEqual([GUEST_A]);
    expect(res.stranded[0]).toMatchObject({ secrets: 1, packOpens: 0, milestoneClaims: 0 });
  });

  it("lists a device whose secrets moved but whose packs did not", async () => {
    // The partial-merge state, and the one this list was blind to: the secrets
    // that put the device on the list in the first place are exactly the rows
    // that already moved.
    withDb({
      "secret_card_pulls.select": { data: [] },
      "pack_opens.select": { data: [{ participant_id: null, guest_id: GUEST_B }] },
    });
    const res = await audit();
    expect(res.stranded.map((d) => d.guestId)).toEqual([GUEST_B]);
    expect(res.stranded[0]).toMatchObject({ secrets: 0, packOpens: 1 });
  });

  it("lists a device left holding nothing but a streak rung", async () => {
    // The harshest version of the same thing, and the costliest: a rung left on
    // a dead guest id reads as unclaimed on the new identity and pays again.
    withDb({
      "secret_card_pulls.select": { data: [] },
      "streak_milestone_claims.select": { data: [{ participant_id: null, guest_id: GUEST_C }] },
    });
    const res = await audit();
    expect(res.stranded.map((d) => d.guestId)).toEqual([GUEST_C]);
    expect(res.stranded[0]).toMatchObject({ secrets: 0, packOpens: 0, milestoneClaims: 1 });
  });

  it("counts one device once, however many tables it appears in", async () => {
    withDb({
      "secret_card_pulls.select": { data: [pull(GUEST_A), pull(GUEST_A)] },
      "pack_opens.select": { data: [{ participant_id: null, guest_id: GUEST_A }] },
      "streak_milestone_claims.select": { data: [{ participant_id: null, guest_id: GUEST_A }] },
    });
    const res = await audit();
    expect(res.stranded).toHaveLength(1);
    expect(res.stranded[0]).toMatchObject({ secrets: 2, packOpens: 1, milestoneClaims: 1 });
  });

  it("ignores rows that already belong to a player", async () => {
    // A row with a participant is filed. Listing it would send the commissioner
    // to re-attach a device that has nothing left on it.
    withDb({
      "secret_card_pulls.select": {
        data: [{ ...pull(GUEST_A), participant_id: ALICE, guest_id: null }],
      },
      "pack_opens.select": { data: [{ participant_id: ALICE, guest_id: null }] },
      "streak_milestone_claims.select": { data: [{ participant_id: ALICE, guest_id: null }] },
    });
    expect((await audit()).stranded).toEqual([]);
  });

  it("puts the fullest device at the top, counting everything it holds", async () => {
    // By secrets alone, a device with nothing but four packs sorted below every
    // device in the league — under the ones with nothing to do with it.
    withDb({
      "secret_card_pulls.select": { data: [pull(GUEST_A)] },
      "pack_opens.select": {
        data: Array.from({ length: 4 }, () => ({ participant_id: null, guest_id: GUEST_B })),
      },
    });
    const res = await audit();
    expect(res.stranded.map((d) => d.guestId)).toEqual([GUEST_B, GUEST_A]);
  });
});
