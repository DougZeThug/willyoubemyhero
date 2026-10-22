// An account-issued admin token must stop working the moment that account is
// taken off the admin list, not when the token expires.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock } from "@/test/supabase-mock";
import { adminHeaders, callServerFn } from "@/test/server-fn";
import { signAccountAdminToken, signAdminToken, verifyAdminToken } from "./session.server";

let mock = createSupabaseMock();
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return mock.client;
  },
}));

const EVENT_ID = "00000000-0000-4000-8000-0000000000ff";
const USER_ID = "00000000-0000-4000-8000-0000000000cc";

beforeEach(() => vi.stubEnv("SESSION_SECRET", "test-session-secret"));

async function guarded(token: string) {
  const { createServerFn } = await import("@tanstack/react-start");
  const { requireAdmin } = await import("./require-auth.server");
  const fn = createServerFn({ method: "POST" }).handler(async () => {
    await requireAdmin(EVENT_ID);
    return "ok";
  });
  return callServerFn(fn, { headers: adminHeaders(token) });
}

describe("account-issued admin tokens", () => {
  it("carry the account inside the signed payload", () => {
    const { token } = signAccountAdminToken(USER_ID, EVENT_ID);
    expect(verifyAdminToken(token)).toMatchObject({ eventId: EVENT_ID, userId: USER_ID });
    const tampered = token.replace(USER_ID, "00000000-0000-4000-8000-0000000000dd");
    expect(verifyAdminToken(tampered)).toBeNull();
  });

  it("work while the account is on the admin list", async () => {
    mock = createSupabaseMock({ "admin_accounts.select": { data: { user_id: USER_ID } } });
    expect(await guarded(signAccountAdminToken(USER_ID, EVENT_ID).token)).toBe("ok");
  });

  it("are refused once the account is removed", async () => {
    mock = createSupabaseMock({ "admin_accounts.select": { data: null } });
    await expect(guarded(signAccountAdminToken(USER_ID, EVENT_ID).token)).rejects.toThrow(
      "Admin PIN required",
    );
  });

  it("leave PIN tokens alone — no admin list lookup", async () => {
    mock = createSupabaseMock({});
    expect(await guarded(signAdminToken(EVENT_ID).token)).toBe("ok");
    expect(mock.callsFor("admin_accounts", "select")).toHaveLength(0);
  });
});
