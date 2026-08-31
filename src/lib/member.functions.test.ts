// Claiming a player, and the commissioner side of issuing codes.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseResponses } from "@/test/supabase-mock";
import { adminHeaders, callServerFn, guestHeaders, memberHeaders } from "@/test/server-fn";
import {
  hashCode,
  signAdminToken,
  signGuestToken,
  signMemberToken,
  verifyMemberToken,
} from "./session.server";

let mock = createSupabaseMock();

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return mock.client;
  },
}));

const EVENT_ID = "00000000-0000-4000-8000-0000000000ff";
const PARTICIPANT_ID = "00000000-0000-4000-8000-0000000000aa";
const OTHER_ID = "00000000-0000-4000-8000-0000000000bb";
const SALT = "code-salt";
const CODE = "ACDEF4";

function withDb(responses: SupabaseResponses) {
  mock = createSupabaseMock(responses);
}

function codeRow(over: Record<string, unknown> = {}) {
  return {
    data: {
      participant_id: PARTICIPANT_ID,
      code_salt: SALT,
      code_hash: hashCode(SALT, CODE),
      claimed_at: null,
      claim_count: 0,
      ...over,
    },
    error: null,
  };
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
  withDb({});
});

const GUEST_ID = "00000000-0000-4000-8000-0000000000e1";

describe("claimPlayer", () => {
  async function claim(data: unknown, headers?: Record<string, string>) {
    const { claimPlayer } = await import("./member.functions");
    return callServerFn(claimPlayer, { data, headers });
  }

  it("carries a guest's secrets onto the player they claim", async () => {
    // Pulling a card as a guest and then claiming has to keep the card, or
    // letting guests pull at all is a trap.
    withDb({
      "member_codes.select": codeRow(),
      "participants.select": { data: { name: "Doug" }, error: null },
      "rpc.attach_device_to_player": { data: { name: "Doug", secrets: 2 } },
    });
    await claim(
      { participantId: PARTICIPANT_ID, code: CODE },
      guestHeaders(signGuestToken(GUEST_ID).token),
    );
    expect(mock.client.rpc).toHaveBeenCalledWith("attach_device_to_player", {
      _participant_id: PARTICIPANT_ID,
      _guest_id: GUEST_ID,
    });
  });

  it("takes the guest id from the token, never from the payload", async () => {
    // Otherwise claiming your own player would be a way to harvest somebody
    // else's cards by naming their guest id.
    withDb({
      "member_codes.select": codeRow(),
      "participants.select": { data: { name: "Doug" }, error: null },
      "rpc.attach_device_to_player": { data: { name: "Doug", secrets: 0 } },
    });
    await claim(
      { participantId: PARTICIPANT_ID, code: CODE, guestId: OTHER_ID },
      guestHeaders(signGuestToken(GUEST_ID).token),
    );
    expect(mock.client.rpc).toHaveBeenCalledWith(
      "attach_device_to_player",
      expect.objectContaining({ _guest_id: GUEST_ID }),
    );
  });

  it("does not reach for guest secrets when the device never had a guest session", async () => {
    withDb({
      "member_codes.select": codeRow(),
      "participants.select": { data: { name: "Doug" }, error: null },
    });
    await claim({ participantId: PARTICIPANT_ID, code: CODE });
    // Named, not "no rpc at all": the attempt limiter legitimately calls its
    // own rpcs on every claim — what must not fire without a guest session is
    // anything that carries guest secrets.
    const names = mock.client.rpc.mock.calls.map((c) => c[0] as string);
    expect(names.filter((n) => !n.includes("auth_attempt"))).toEqual([]);
  });

  it("fails loudly when carrying the guest data over fails", async () => {
    // The migration is atomic, so a failure means nothing moved. Codes stay
    // valid after a claim, so surfacing it lets the player simply retry —
    // pretending it worked is how milestone claims got stranded on a dead
    // guest id and paid a second time.
    withDb({
      "member_codes.select": codeRow(),
      "participants.select": { data: { name: "Doug" }, error: null },
      "rpc.attach_device_to_player": { error: { message: "boom" } },
    });
    await expect(
      claim(
        { participantId: PARTICIPANT_ID, code: CODE },
        guestHeaders(signGuestToken(GUEST_ID).token),
      ),
    ).rejects.toThrow(/boom/);
  });

  it("issues a member token for the right code", async () => {
    withDb({
      "member_codes.select": codeRow(),
      "participants.select": { data: { name: "Doug" }, error: null },
    });
    const res = (await claim({ participantId: PARTICIPANT_ID, code: CODE })) as {
      ok: true;
      token: string;
      name: string;
    };
    expect(res.ok).toBe(true);
    expect(res.name).toBe("Doug");
    expect(verifyMemberToken(res.token)?.participantId).toBe(PARTICIPANT_ID);
  });

  it("accepts a code typed in lower case with stray spaces", async () => {
    // Codes are handed out on paper and typed on a phone.
    withDb({
      "member_codes.select": codeRow(),
      "participants.select": { data: { name: "Doug" }, error: null },
    });
    expect(await claim({ participantId: PARTICIPANT_ID, code: " acdef4 " })).toMatchObject({
      ok: true,
    });
  });

  it("returns the same failure for a wrong code and for no code at all", async () => {
    // Otherwise the endpoint enumerates which players have codes issued.
    withDb({ "member_codes.select": codeRow() });
    const wrongCode = await claim({ participantId: PARTICIPANT_ID, code: "WRONG7" });

    withDb({ "member_codes.select": { data: null, error: null } });
    const noRow = await claim({ participantId: PARTICIPANT_ID, code: CODE });

    expect(wrongCode).toEqual({ ok: false, reason: "bad_code" });
    expect(noRow).toEqual(wrongCode);
  });

  it("does not write anything when the code is wrong", async () => {
    withDb({ "member_codes.select": codeRow() });
    await claim({ participantId: PARTICIPANT_ID, code: "WRONG7" });
    expect(mock.callsFor("member_codes", "update")).toHaveLength(0);
  });

  it("locks the claim after too many attempts, before reading the code row", async () => {
    // Even the right code bounces during a lockout, and the code row is never
    // read. The limiter fires before the lookup so a player with no code issued
    // rate-limits exactly like one with a wrong code — the limiter must not
    // become the enumeration channel bad_code closes.
    withDb({
      "rpc.note_auth_attempt": { data: false },
      "member_codes.select": codeRow(),
    });
    expect(await claim({ participantId: PARTICIPANT_ID, code: CODE })).toEqual({
      ok: false,
      reason: "too_many_attempts",
    });
    expect(mock.callsFor("member_codes", "select")).toHaveLength(0);
  });

  it("counts the attempt against the player being claimed", async () => {
    withDb({ "member_codes.select": codeRow() });
    await claim({ participantId: PARTICIPANT_ID, code: "WRONG7" });
    const note = mock.client.rpc.mock.calls.find((c) => c[0] === "note_auth_attempt");
    expect(note?.[1]).toMatchObject({ _kind: "claim", _key: PARTICIPANT_ID });
  });

  it("fails open when the limiter itself is down", async () => {
    withDb({
      "rpc.note_auth_attempt": { data: null, error: { message: "boom" } },
      "member_codes.select": codeRow(),
      "participants.select": { data: { name: "Doug" }, error: null },
    });
    expect(await claim({ participantId: PARTICIPANT_ID, code: CODE })).toMatchObject({ ok: true });
  });

  it("a right code clears the counter; a wrong one leaves it standing", async () => {
    withDb({
      "member_codes.select": codeRow(),
      "participants.select": { data: { name: "Doug" }, error: null },
    });
    await claim({ participantId: PARTICIPANT_ID, code: CODE });
    const clear = mock.client.rpc.mock.calls.find((c) => c[0] === "clear_auth_attempts");
    expect(clear?.[1]).toMatchObject({ _kind: "claim", _key: PARTICIPANT_ID });

    withDb({ "member_codes.select": codeRow() });
    await claim({ participantId: PARTICIPANT_ID, code: "WRONG7" });
    expect(mock.client.rpc.mock.calls.some((c) => c[0] === "clear_auth_attempts")).toBe(false);
  });

  it("stamps claimed_at on the first claim", async () => {
    withDb({
      "member_codes.select": codeRow({ claimed_at: null }),
      "participants.select": { data: { name: "Doug" }, error: null },
    });
    await claim({ participantId: PARTICIPANT_ID, code: CODE });
    const [update] = mock.callsFor("member_codes", "update");
    const payload = update.payload as Record<string, unknown>;
    expect(payload.claimed_at).toBeTruthy();
    expect(payload.claimed_at).toBe(payload.last_claimed_at);
    expect(payload.claim_count).toBe(1);
  });

  it("keeps the original claimed_at on a re-claim and bumps the counter", async () => {
    // People get new phones and clear browsers; a code stays valid on purpose.
    const first = "2026-07-01T10:00:00.000Z";
    withDb({
      "member_codes.select": codeRow({ claimed_at: first, claim_count: 2 }),
      "participants.select": { data: { name: "Doug" }, error: null },
    });
    await claim({ participantId: PARTICIPANT_ID, code: CODE });
    const payload = mock.callsFor("member_codes", "update")[0].payload as Record<string, unknown>;
    expect(payload.claimed_at).toBe(first);
    expect(payload.last_claimed_at).not.toBe(first);
    expect(payload.claim_count).toBe(3);
  });

  it("falls back to a generic name when the participant row is missing", async () => {
    withDb({
      "member_codes.select": codeRow(),
      "participants.select": { data: null, error: null },
    });
    expect(await claim({ participantId: PARTICIPANT_ID, code: CODE })).toMatchObject({
      name: "Player",
    });
  });

  it("needs no session of its own — claiming is how you get one", async () => {
    withDb({
      "member_codes.select": codeRow(),
      "participants.select": { data: { name: "Doug" }, error: null },
    });
    expect(await claim({ participantId: PARTICIPANT_ID, code: CODE })).toMatchObject({ ok: true });
  });

  it("validates its input", async () => {
    await expect(claim({ participantId: "nope", code: CODE })).rejects.toThrow();
    await expect(claim({ participantId: PARTICIPANT_ID, code: "abc" })).rejects.toThrow();
    await expect(claim({ participantId: PARTICIPANT_ID, code: "x".repeat(17) })).rejects.toThrow();
  });
});

describe("getClaimRoster", () => {
  it("reports who has a code and who has actually claimed", async () => {
    withDb({
      "participants.select": {
        data: [
          { id: PARTICIPANT_ID, name: "Doug", nickname: "Dougie" },
          { id: OTHER_ID, name: "Alice", nickname: null },
        ],
        error: null,
      },
      "member_codes.select": {
        data: [
          { participant_id: PARTICIPANT_ID, claimed_at: "2026-07-01T10:00:00Z" },
          { participant_id: OTHER_ID, claimed_at: null },
        ],
        error: null,
      },
    });
    const { getClaimRoster } = await import("./member.functions");
    expect(await callServerFn(getClaimRoster)).toEqual([
      {
        id: PARTICIPANT_ID,
        name: "Doug",
        nickname: "Dougie",
        hasCode: true,
        claimed: true,
        isCollector: false,
        reachable: true,
      },
      // A code was issued but never redeemed.
      {
        id: OTHER_ID,
        name: "Alice",
        nickname: null,
        hasCode: true,
        claimed: false,
        isCollector: false,
        reachable: false,
      },
    ]);
  });

  it("counts a signed-in account as reachable even with no claimed code", async () => {
    // Doug's case in production: an account linked to his player, but the paper
    // code never redeemed. Trading has to reach him — create_trade_offer applies
    // the same OR server-side.
    withDb({
      "participants.select": { data: [{ id: PARTICIPANT_ID, name: "Doug", nickname: null }] },
      "member_codes.select": { data: [{ participant_id: PARTICIPANT_ID, claimed_at: null }] },
      "account_identities.select": { data: [{ participant_id: PARTICIPANT_ID }] },
    });
    const { getClaimRoster } = await import("./member.functions");
    expect(await callServerFn(getClaimRoster)).toEqual([
      {
        id: PARTICIPANT_ID,
        name: "Doug",
        nickname: null,
        hasCode: true,
        // Unchanged: /claim still means the paper code alone.
        claimed: false,
        isCollector: false,
        reachable: true,
      },
    ]);
  });

  it("marks a player with no code row at all", async () => {
    withDb({
      "participants.select": { data: [{ id: PARTICIPANT_ID, name: "Doug", nickname: null }] },
      "member_codes.select": { data: [] },
    });
    const { getClaimRoster } = await import("./member.functions");
    expect(await callServerFn(getClaimRoster)).toEqual([
      {
        id: PARTICIPANT_ID,
        name: "Doug",
        nickname: null,
        hasCode: false,
        claimed: false,
        isCollector: false,
        reachable: false,
      },
    ]);
  });

  it("never returns code material", async () => {
    withDb({
      "participants.select": { data: [{ id: PARTICIPANT_ID, name: "Doug", nickname: null }] },
      "member_codes.select": { data: [{ participant_id: PARTICIPANT_ID, claimed_at: null }] },
    });
    const { getClaimRoster } = await import("./member.functions");
    const rows = await callServerFn<Record<string, unknown>[]>(getClaimRoster);
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain("code_hash");
      expect(Object.keys(row)).not.toContain("code_salt");
    }
  });

  it("survives both queries returning nothing", async () => {
    const { getClaimRoster } = await import("./member.functions");
    expect(await callServerFn(getClaimRoster)).toEqual([]);
  });
});

describe("getMe", () => {
  it("requires a member token", async () => {
    const { getMe } = await import("./member.functions");
    await expect(callServerFn(getMe)).rejects.toThrow("Claim your player first");
  });

  it("returns the participant the token names, not one the caller asks for", async () => {
    withDb({
      "participants.select": { data: { id: PARTICIPANT_ID, name: "Doug" }, error: null },
    });
    const { token } = signMemberToken(PARTICIPANT_ID);
    const { getMe } = await import("./member.functions");
    await callServerFn(getMe, { headers: memberHeaders(token) });
    const [call] = mock.callsFor("participants", "select");
    expect(mock.eqValue(call, "id")).toBe(PARTICIPANT_ID);
  });
});

describe("generateMemberCodes", () => {
  async function generate(data: unknown, headers?: Record<string, string>) {
    const { generateMemberCodes } = await import("./member.functions");
    return callServerFn(generateMemberCodes, { data, headers });
  }

  function adminOk() {
    return adminHeaders(signAdminToken(EVENT_ID).token);
  }

  it("refuses without an admin token", async () => {
    await expect(generate({ eventId: EVENT_ID })).rejects.toThrow("Admin PIN required");
  });

  it("refuses an admin token for a different event", async () => {
    const other = adminHeaders(signAdminToken(OTHER_ID).token);
    await expect(generate({ eventId: EVENT_ID }, other)).rejects.toThrow("Admin PIN required");
  });

  it("issues a code per active participant", async () => {
    withDb({
      "participants.select": {
        data: [
          { id: PARTICIPANT_ID, name: "Doug" },
          { id: OTHER_ID, name: "Alice" },
        ],
      },
    });
    const res = (await generate({ eventId: EVENT_ID }, adminOk())) as {
      ok: boolean;
      issued: { participantId: string; name: string; code: string }[];
    };
    expect(res.ok).toBe(true);
    expect(res.issued.map((i) => i.name)).toEqual(["Doug", "Alice"]);
  });

  it("returns the plaintext once and stores only its salted hash", async () => {
    withDb({ "participants.select": { data: [{ id: PARTICIPANT_ID, name: "Doug" }] } });
    const res = (await generate({ eventId: EVENT_ID }, adminOk())) as {
      issued: { code: string }[];
    };
    const [stored] = mock.callsFor("member_codes", "upsert")[0].payload as Record<string, string>[];
    expect(stored.code_hash).not.toContain(res.issued[0].code);
    expect(stored.code_hash).toBe(hashCode(stored.code_salt, res.issued[0].code));
  });

  it("only emits characters people cannot misread off paper", async () => {
    withDb({
      "participants.select": {
        data: Array.from({ length: 20 }, (_, i) => ({ id: PARTICIPANT_ID, name: `P${i}` })),
      },
    });
    const res = (await generate({ eventId: EVENT_ID }, adminOk())) as {
      issued: { code: string }[];
    };
    for (const { code } of res.issued) {
      expect(code).toMatch(/^[ACDEFGHJKMNPQRTUVWXY34679]{6}$/);
      // 0/O, 1/I/L, 2/Z, 5/S and 8/B are all excluded.
      expect(code).not.toMatch(/[01258BILOSZ]/);
    }
  });

  it("resets the claim record when rotating a code", async () => {
    withDb({ "participants.select": { data: [{ id: PARTICIPANT_ID, name: "Doug" }] } });
    await generate({ eventId: EVENT_ID }, adminOk());
    const [upsert] = mock.callsFor("member_codes", "upsert");
    expect(upsert.payload).toMatchObject([
      { claimed_at: null, last_claimed_at: null, claim_count: 0 },
    ]);
    expect(upsert.options).toEqual({ onConflict: "participant_id" });
  });

  it("writes the whole roster in one statement, so a failure rotates nobody", async () => {
    // The loop this replaced threw on its first failure with earlier upserts
    // already committed. Those players held live codes nobody had ever seen —
    // the plaintext only exists inside the handler — so their paper slips were
    // dead with no recovery short of rotating again.
    withDb({
      "participants.select": {
        data: [
          { id: PARTICIPANT_ID, name: "Doug" },
          { id: OTHER_ID, name: "Alice" },
        ],
      },
    });
    await generate({ eventId: EVENT_ID }, adminOk());
    const upserts = mock.callsFor("member_codes", "upsert");
    expect(upserts).toHaveLength(1);
    expect(upserts[0].payload).toHaveLength(2);
  });

  it("reports a failed rotation rather than a list nothing was written for", async () => {
    withDb({
      "participants.select": { data: [{ id: PARTICIPANT_ID, name: "Doug" }] },
      "member_codes.upsert": { error: { message: "connection lost" } },
    });
    await expect(generate({ eventId: EVENT_ID }, adminOk())).rejects.toThrow("connection lost");
  });

  it("issues distinct codes to distinct players", async () => {
    withDb({
      "participants.select": {
        data: Array.from({ length: 13 }, (_, i) => ({ id: `p${i}`, name: `P${i}` })),
      },
    });
    const res = (await generate({ eventId: EVENT_ID }, adminOk())) as {
      issued: { code: string }[];
    };
    expect(new Set(res.issued.map((i) => i.code)).size).toBe(13);
  });

  it("targets only the named participants when given a list", async () => {
    withDb({ "participants.select": { data: [{ id: PARTICIPANT_ID, name: "Doug" }] } });
    await generate({ eventId: EVENT_ID, participantIds: [PARTICIPANT_ID] }, adminOk());
    const [select] = mock.callsFor("participants", "select");
    expect(select.filters.find((f) => f.method === "in")?.args).toEqual(["id", [PARTICIPANT_ID]]);
  });

  it("surfaces a write failure rather than reporting codes it never stored", async () => {
    withDb({
      "participants.select": { data: [{ id: PARTICIPANT_ID, name: "Doug" }] },
      "member_codes.upsert": { error: { message: "constraint violation" } },
    });
    await expect(generate({ eventId: EVENT_ID }, adminOk())).rejects.toBeTruthy();
  });

  it("caps the participant list at 64", async () => {
    const ids = Array.from({ length: 65 }, () => PARTICIPANT_ID);
    await expect(generate({ eventId: EVENT_ID, participantIds: ids }, adminOk())).rejects.toThrow();
  });
});

describe("listMemberClaims", () => {
  it("refuses without an admin token", async () => {
    const { listMemberClaims } = await import("./member.functions");
    await expect(callServerFn(listMemberClaims, { data: { eventId: EVENT_ID } })).rejects.toThrow(
      "Admin PIN required",
    );
  });

  it("selects claim status only, never code material", async () => {
    const { listMemberClaims } = await import("./member.functions");
    await callServerFn(listMemberClaims, {
      data: { eventId: EVENT_ID },
      headers: adminHeaders(signAdminToken(EVENT_ID).token),
    });
    const [call] = mock.callsFor("member_codes", "select");
    // The select list is the entire defence here — the handler runs as
    // service_role, so RLS will not save us if it asks for the hash.
    expect(call.filters).toHaveLength(0);
    expect(mock.client.from).toHaveBeenCalledWith("member_codes");
  });
});
