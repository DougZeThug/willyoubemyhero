// Exchanging the event PIN for a commissioner token.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseResponses } from "@/test/supabase-mock";
import { callServerFn } from "@/test/server-fn";
import { hashPin, verifyAdminToken } from "./session.server";

let mock = createSupabaseMock();

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return mock.client;
  },
}));

const EVENT_ID = "00000000-0000-4000-8000-0000000000ff";
const SALT = "salt-1234";
const PIN = "8675";
const USER_ID = "11111111-1111-4111-8111-111111111111";

function withDb(responses: SupabaseResponses) {
  mock = createSupabaseMock(responses);
}

/** The event_secrets row for an event whose PIN is `PIN`. */
function secretsRow() {
  return {
    data: { event_id: EVENT_ID, pin_salt: SALT, pin_hash: hashPin(SALT, PIN) },
    error: null,
  };
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
  withDb({});
});

async function verify(data: unknown) {
  const { verifyEventPin } = await import("./admin.functions");
  return callServerFn(verifyEventPin, { data });
}

describe("verifyEventPin", () => {
  it("mints a token the server will accept for the right PIN", async () => {
    withDb({ "event_secrets.select": secretsRow() });
    const res = (await verify({ eventId: EVENT_ID, pin: PIN })) as {
      ok: true;
      token: string;
      expiresAt: number;
    };
    expect(res.ok).toBe(true);
    expect(verifyAdminToken(res.token)).toEqual({ eventId: EVENT_ID, expiresAt: res.expiresAt });
  });

  it("rejects the wrong PIN without minting anything", async () => {
    withDb({ "event_secrets.select": secretsRow() });
    expect(await verify({ eventId: EVENT_ID, pin: "0000" })).toEqual({
      ok: false,
      reason: "bad_pin",
    });
  });

  it("rejects an unknown event", async () => {
    withDb({ "event_secrets.select": { data: null, error: null } });
    expect(await verify({ eventId: EVENT_ID, pin: PIN })).toEqual({
      ok: false,
      reason: "event_not_found",
    });
  });

  it("rejects when the secrets lookup errors", async () => {
    withDb({ "event_secrets.select": { data: null, error: { message: "boom" } } });
    expect(await verify({ eventId: EVENT_ID, pin: PIN })).toEqual({
      ok: false,
      reason: "event_not_found",
    });
  });

  it("signs the token for the event the secrets row names, not the caller's input", async () => {
    // The handler reads secret.event_id back out of the row on purpose.
    const other = "00000000-0000-4000-8000-0000000000ee";
    withDb({
      "event_secrets.select": {
        data: { event_id: other, pin_salt: SALT, pin_hash: hashPin(SALT, PIN) },
        error: null,
      },
    });
    const res = (await verify({ eventId: EVENT_ID, pin: PIN })) as { token: string };
    expect(verifyAdminToken(res.token)?.eventId).toBe(other);
  });

  it("looks the event up by id", async () => {
    withDb({ "event_secrets.select": secretsRow() });
    await verify({ eventId: EVENT_ID, pin: PIN });
    const [call] = mock.callsFor("event_secrets", "select");
    expect(mock.eqValue(call, "event_id")).toBe(EVENT_ID);
  });

  it("is case- and whitespace-sensitive, unlike a member code", async () => {
    withDb({ "event_secrets.select": secretsRow() });
    expect(await verify({ eventId: EVENT_ID, pin: ` ${PIN}` })).toMatchObject({ ok: false });
  });

  describe("input validation", () => {
    it("rejects a non-uuid event id", async () => {
      await expect(verify({ eventId: "not-a-uuid", pin: PIN })).rejects.toThrow();
    });

    it("rejects an empty PIN", async () => {
      await expect(verify({ eventId: EVENT_ID, pin: "" })).rejects.toThrow();
    });

    it("rejects an over-long PIN", async () => {
      await expect(verify({ eventId: EVENT_ID, pin: "x".repeat(33) })).rejects.toThrow();
    });

    it("rejects a missing payload", async () => {
      await expect(verify({})).rejects.toThrow();
    });

    it("does not reach the database for invalid input", async () => {
      withDb({ "event_secrets.select": secretsRow() });
      await expect(verify({ eventId: "nope", pin: PIN })).rejects.toThrow();
      expect(mock.calls).toHaveLength(0);
    });
  });
});
