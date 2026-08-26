// Streaks, above the database.
//
// The db suite proves the payout is atomic and happens once. What is checked
// here is everything the guards decide: that the identity a claim is filed
// against comes off a verified token and never off the payload, that a guest is
// read but not silently paid, and that a read with no token is an empty streak
// rather than a broken screen.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseResponses } from "@/test/supabase-mock";
import { adminHeaders, callServerFn, guestHeaders, memberHeaders } from "@/test/server-fn";
import { signAdminToken, signGuestToken, signMemberToken } from "./session.server";
import type { StreakStatus } from "./streaks.functions";
import { STREAK_MILESTONES } from "./streaks";

let mock = createSupabaseMock();

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return mock.client;
  },
}));

const EVENT_ID = "00000000-0000-4000-8000-0000000000ff";
const ME = "00000000-0000-4000-8000-0000000000aa";
const GUEST = "00000000-0000-4000-8000-0000000000bb";
const CARD = "00000000-0000-4000-8000-00000000ce01";
const PULL = "00000000-0000-4000-8000-00000000ce02";

const activeEvent = { "events.select": { data: { id: EVENT_ID } } };

function withDb(responses: SupabaseResponses = {}) {
  mock = createSupabaseMock({ ...activeEvent, ...responses });
}

const asMe = () => memberHeaders(signMemberToken(ME).token);
const asGuest = () => guestHeaders(signGuestToken(GUEST).token);

/**
 * N consecutive league days ending today, as the rows pack_opens would hand back.
 *
 * Anchored on `leagueDay()` rather than the UTC date: between 00:00 and 05:00 UTC
 * New York is still on yesterday, so a UTC-built ladder ended a day in the future
 * and the streak read as broken — a real failure every night, only in CI.
 */
function daysEndingToday(n: number) {
  const out: { opened_on: string }[] = [];
  const [y, m, d] = leagueDay().split("-").map(Number);
  for (let i = n - 1; i >= 0; i--) {
    const day = new Date(Date.UTC(y!, m! - 1, d! - i));
    out.push({ opened_on: day.toISOString().slice(0, 10) });
  }
  return out;
}


beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
  withDb();
});

describe("getStreakStatus", () => {
  it("answers a device with no identity with an empty streak, not an error", async () => {
    // Mirrors getSecretStatus. Throwing here puts the hook on its error path and
    // blanks the pill on the very first paint, before either token has hydrated.
    const { getStreakStatus } = await import("./streaks.functions");
    const res = await callServerFn<StreakStatus>(getStreakStatus);
    expect(res.kind).toBeNull();
    expect(res.current).toBe(0);
    expect(res.canClaim).toBe(false);
    expect(res.milestones.every((m) => !m.earned && !m.claimed)).toBe(true);
    // Carried out to the phone even with no identity behind the request, so the
    // pill can say what a rung pays before anybody has a streak. Compared against
    // the ladder rather than restated: what the server actually PAYS at is pinned
    // against the SQL CASE over in tests/db/streaks.test.ts.
    expect(res.milestones.map((m) => m.tierFloor)).toEqual(
      STREAK_MILESTONES.map((m) => m.tierFloor),
    );
  });

  it("reads a member's days off their participant id", async () => {
    withDb({
      "pack_opens.select": { data: daysEndingToday(3) },
      "streak_milestone_claims.select": { data: [] },
      "account_identities.select": { data: [] },
    });
    const { getStreakStatus } = await import("./streaks.functions");
    const res = await callServerFn<StreakStatus>(getStreakStatus, { headers: asMe() });

    expect(res.kind).toBe("member");
    expect(res.current).toBe(3);
    const call = mock.callsFor("pack_opens", "select")[0];
    expect(mock.eqValue(call, "participant_id")).toBe(ME);
  });

  it("reads a guest's days off their guest id instead", async () => {
    withDb({
      "pack_opens.select": { data: daysEndingToday(2) },
      "streak_milestone_claims.select": { data: [] },
      "account_identities.select": { data: [] },
    });
    const { getStreakStatus } = await import("./streaks.functions");
    const res = await callServerFn<StreakStatus>(getStreakStatus, { headers: asGuest() });

    expect(res.kind).toBe("guest");
    expect(res.current).toBe(2);
    const call = mock.callsFor("pack_opens", "select")[0];
    expect(mock.eqValue(call, "guest_id")).toBe(GUEST);
    expect(mock.eqValue(call, "participant_id")).toBeUndefined();
  });

  it("withholds the claim button until there is an account behind the actor", async () => {
    withDb({
      "pack_opens.select": { data: daysEndingToday(3) },
      "streak_milestone_claims.select": { data: [] },
      "account_identities.select": { data: [] },
    });
    const { getStreakStatus } = await import("./streaks.functions");
    const res = await callServerFn<StreakStatus>(getStreakStatus, { headers: asGuest() });
    expect(res.canClaim).toBe(false);
    expect(res.milestones.find((m) => m.days === 3)?.earned).toBe(true);
  });

  it("hands the button over once one exists", async () => {
    withDb({
      "pack_opens.select": { data: daysEndingToday(3) },
      "streak_milestone_claims.select": { data: [] },
      "account_identities.select": { data: [{ user_id: "u" }] },
    });
    const { getStreakStatus } = await import("./streaks.functions");
    const res = await callServerFn<StreakStatus>(getStreakStatus, { headers: asGuest() });
    expect(res.canClaim).toBe(true);
  });

  it("still hands it over when two accounts have adopted the same identity", async () => {
    // account_identities indexes participant_id and guest_id non-uniquely, so
    // this is a state the schema permits — two people signing in on a shared
    // handset, or one person with two emails. It used to read through
    // maybeSingle(), which answers more than one row with an error and a null
    // row, so canClaim went false and the button never appeared for someone
    // claim_streak_milestone would have authorised.
    withDb({
      "pack_opens.select": { data: daysEndingToday(3) },
      "streak_milestone_claims.select": { data: [] },
      "account_identities.select": { data: [{ user_id: "u1" }, { user_id: "u2" }] },
    });
    const { getStreakStatus } = await import("./streaks.functions");
    const res = await callServerFn<StreakStatus>(getStreakStatus, { headers: asMe() });
    expect(res.canClaim).toBe(true);

    // Pinned on the query shape, not just the answer: this double returns
    // whatever `data` is declared as and does not emulate maybeSingle()'s
    // multi-row error, so the assertion above alone would still pass against the
    // bug. A bounded existence read is what makes the duplicate harmless.
    const call = mock.callsFor("account_identities", "select")[0]!;
    expect(call.terminal).toBe("await");
    expect(call.filters.map((f) => f.method)).toContain("limit");
  });

  it("counts a claim inside the run, however far back the run now starts", async () => {
    // The window, not the exact start date. A guest history merging in moves the
    // run's first day backwards, and matching on equality would re-arm a
    // milestone that has already been paid.
    const days = daysEndingToday(5);
    withDb({
      "pack_opens.select": { data: days },
      "streak_milestone_claims.select": {
        data: [{ milestone: 3, streak_started_on: days[2]!.opened_on }],
      },
      "account_identities.select": { data: [{ user_id: "u" }] },
    });
    const { getStreakStatus } = await import("./streaks.functions");
    const res = await callServerFn<StreakStatus>(getStreakStatus, { headers: asMe() });
    expect(res.milestones.find((m) => m.days === 3)?.claimed).toBe(true);
  });

  it("ignores a claim from a run that has since died", async () => {
    withDb({
      "pack_opens.select": { data: daysEndingToday(3) },
      "streak_milestone_claims.select": {
        data: [{ milestone: 3, streak_started_on: "2020-01-01" }],
      },
      "account_identities.select": { data: [{ user_id: "u" }] },
    });
    const { getStreakStatus } = await import("./streaks.functions");
    const res = await callServerFn<StreakStatus>(getStreakStatus, { headers: asMe() });
    expect(res.milestones.find((m) => m.days === 3)?.claimed).toBe(false);
  });
});

describe("claimStreakMilestone", () => {
  it("refuses a device holding no token at all", async () => {
    const { claimStreakMilestone } = await import("./streaks.functions");
    await expect(callServerFn(claimStreakMilestone, { data: { milestone: 3 } })).rejects.toThrow(
      "Claim your player first",
    );
  });

  it("is not satisfied by an admin token", async () => {
    const { claimStreakMilestone } = await import("./streaks.functions");
    await expect(
      callServerFn(claimStreakMilestone, {
        data: { milestone: 3 },
        headers: adminHeaders(signAdminToken(EVENT_ID).token),
      }),
    ).rejects.toThrow("Claim your player first");
  });

  it("rejects a milestone that is not on the ladder, without reaching the database", async () => {
    const { claimStreakMilestone } = await import("./streaks.functions");
    for (const milestone of [5, 99, 101]) {
      await expect(
        callServerFn(claimStreakMilestone, { data: { milestone }, headers: asMe() }),
      ).rejects.toThrow();
    }
    expect(mock.client.rpc).not.toHaveBeenCalled();
  });

  it("files the claim against the token's id and the event it resolved itself", async () => {
    withDb({
      "rpc.claim_streak_milestone": {
        data: {
          ok: true,
          milestone: 3,
          streak: 4,
          startedOn: "2026-08-21",
          reward: {
            kind: "secret",
            pullId: PULL,
            cardId: CARD,
            day: "2026-08-24",
            duplicate: false,
            tier: "rare",
            granted: true,
          },
        },
      },
      "secret_cards.select": { data: { id: CARD, name: "Ghost", art_path: null, back_path: null } },
    });
    const { claimStreakMilestone } = await import("./streaks.functions");
    const res = await callServerFn<{ ok: boolean }>(claimStreakMilestone, {
      // A participant id in the payload is ignored: there is no field for it.
      data: { milestone: 3 },
      headers: asMe(),
    });

    expect(res.ok).toBe(true);
    expect(mock.client.rpc).toHaveBeenCalledWith("claim_streak_milestone", {
      _participant_id: ME,
      _guest_id: null,
      _milestone: 3,
      _event_id: EVENT_ID,
    });
  });

  it("files a guest's claim against their guest id", async () => {
    withDb({
      "rpc.claim_streak_milestone": { data: { ok: false, reason: "account_required" } },
    });
    const { claimStreakMilestone } = await import("./streaks.functions");
    await callServerFn(claimStreakMilestone, { data: { milestone: 3 }, headers: asGuest() });

    expect(mock.client.rpc).toHaveBeenCalledWith("claim_streak_milestone", {
      _participant_id: null,
      _guest_id: GUEST,
      _milestone: 3,
      _event_id: EVENT_ID,
    });
  });

  it("passes a soft refusal straight through rather than throwing it", async () => {
    for (const reason of ["account_required", "not_earned", "claimed", "unavailable"] as const) {
      withDb({ "rpc.claim_streak_milestone": { data: { ok: false, reason } } });
      const { claimStreakMilestone } = await import("./streaks.functions");
      const res = await callServerFn<{ ok: false; reason: string }>(claimStreakMilestone, {
        data: { milestone: 7 },
        headers: asMe(),
      });
      expect(res).toEqual({ ok: false, reason });
    }
  });

  it("says so softly when the card behind a paid claim cannot be read back", async () => {
    withDb({
      "rpc.claim_streak_milestone": {
        data: {
          ok: true,
          milestone: 7,
          streak: 7,
          startedOn: "2026-08-18",
          reward: {
            kind: "secret",
            pullId: PULL,
            cardId: CARD,
            day: "2026-08-24",
            duplicate: false,
            tier: "epic",
            granted: true,
          },
        },
      },
      "secret_cards.select": { data: null },
    });
    const { claimStreakMilestone } = await import("./streaks.functions");
    const res = await callServerFn<{ ok: false; reason: string }>(claimStreakMilestone, {
      data: { milestone: 7 },
      headers: asMe(),
    });
    expect(res).toEqual({ ok: false, reason: "unavailable" });
  });
});
