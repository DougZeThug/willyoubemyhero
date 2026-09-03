// The bottom bar's switch, against a fake PostgREST.
//
// What matters here is the guard and the vocabulary: this is a commissioner call
// that changes the chrome on every phone in the league, so a member must not
// reach it, an admin token for another combine must not reach it, and the two
// rows the bar cannot lose must be refused by name rather than quietly dropped.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminHeaders, callServerFn, memberHeaders } from "@/test/server-fn";
import { createSupabaseMock, type SupabaseResponses } from "@/test/supabase-mock";
import { signAdminToken, signMemberToken } from "@/lib/session.server";

let mock = createSupabaseMock();

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return mock.client;
  },
}));

const EVENT = "55555555-5555-4555-8555-555555555555";
const OTHER = "66666666-6666-4666-8666-666666666666";
const ME = "11111111-1111-4111-8111-111111111111";

function withDb(responses: SupabaseResponses = {}) {
  mock = createSupabaseMock(responses);
}

const asAdmin = () => adminHeaders(signAdminToken(EVENT).token);
const asMe = () => memberHeaders(signMemberToken(ME).token);

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
  withDb({ "events.update": { data: null } });
});

describe("setNavHidden", () => {
  it("refuses a member — the bar is the commissioner's", async () => {
    const { setNavHidden } = await import("./nav.functions");
    await expect(
      callServerFn(setNavHidden, {
        data: { eventId: EVENT, hidden: ["pack"] },
        headers: asMe(),
      }),
    ).rejects.toThrow();
    expect(mock.callsFor("events", "update")).toHaveLength(0);
  });

  it("refuses an admin token for a different event", async () => {
    const { setNavHidden } = await import("./nav.functions");
    await expect(
      callServerFn(setNavHidden, {
        data: { eventId: EVENT, hidden: ["pack"] },
        headers: adminHeaders(signAdminToken(OTHER).token),
      }),
    ).rejects.toThrow();
    expect(mock.callsFor("events", "update")).toHaveLength(0);
  });

  it("writes the whole list against the event the token is for", async () => {
    const { setNavHidden } = await import("./nav.functions");
    const res = await callServerFn<{ ok: boolean; hidden: string[] }>(setNavHidden, {
      data: { eventId: EVENT, hidden: ["board", "league"] },
      headers: asAdmin(),
    });
    expect(res).toEqual({ ok: true, hidden: ["board", "league"] });
    const [call] = mock.callsFor("events", "update");
    expect(call.payload).toEqual({ nav_hidden: ["board", "league"] });
    expect(mock.eqValue(call, "id")).toBe(EVENT);
  });

  it("de-duplicates a list that names a row twice", async () => {
    // The column is a set in everything but type, and a repeated id would make
    // the console's count disagree with the bar's.
    const { setNavHidden } = await import("./nav.functions");
    await callServerFn(setNavHidden, {
      data: { eventId: EVENT, hidden: ["pack", "pack"] },
      headers: asAdmin(),
    });
    const [call] = mock.callsFor("events", "update");
    expect(call.payload).toEqual({ nav_hidden: ["pack"] });
  });

  it("puts every row back", async () => {
    const { setNavHidden } = await import("./nav.functions");
    await callServerFn(setNavHidden, {
      data: { eventId: EVENT, hidden: [] },
      headers: asAdmin(),
    });
    const [call] = mock.callsFor("events", "update");
    expect(call.payload).toEqual({ nav_hidden: [] });
  });

  it("refuses to hide the vault", async () => {
    // The pin is a server rule, not a disabled button: the vault is the
    // wordmark's target, the shop's way back and activeTab's fallback for every
    // /players/* screen, so a bar without it has holes rather than fewer rows.
    const { setNavHidden } = await import("./nav.functions");
    await expect(
      callServerFn(setNavHidden, {
        data: { eventId: EVENT, hidden: ["vault"] },
        headers: asAdmin(),
      }),
    ).rejects.toThrow();
    expect(mock.callsFor("events", "update")).toHaveLength(0);
  });

  it("refuses to hide the shop — dust_enabled is its only switch", async () => {
    // Two switches that can disagree is a Shop tab that leads to "the
    // commissioner has not switched dust on yet".
    const { setNavHidden } = await import("./nav.functions");
    await expect(
      callServerFn(setNavHidden, {
        data: { eventId: EVENT, hidden: ["shop"] },
        headers: asAdmin(),
      }),
    ).rejects.toThrow();
    expect(mock.callsFor("events", "update")).toHaveLength(0);
  });

  it("refuses a row it has never heard of", async () => {
    const { setNavHidden } = await import("./nav.functions");
    await expect(
      callServerFn(setNavHidden, {
        data: { eventId: EVENT, hidden: ["sponsors"] },
        headers: asAdmin(),
      }),
    ).rejects.toThrow();
    expect(mock.callsFor("events", "update")).toHaveLength(0);
  });
});
