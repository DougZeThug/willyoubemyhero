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
import { leagueDay } from "./trades";

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

describe("getStreakHistory", () => {
  const OTHER_PULL = "00000000-0000-4000-8000-00000000ce03";

  /** One claim, its pull and its card — the whole three-hop path in one bag. */
  function withHistory(claims: unknown[], pulls: unknown[] = [], cards: unknown[] = []) {
    withDb({
      "streak_milestone_claims.select": { data: claims },
      "secret_card_pulls.select": { data: pulls },
      "secret_cards.select": { data: cards },
    });
  }

  it("answers a device with no identity with an empty list, not an error", async () => {
    // Same posture as getStreakStatus above: nothing claimed is a fact, and the
    // profile should render an empty section rather than an error boundary.
    const { getStreakHistory } = await import("./streaks.functions");
    const res = await callServerFn<unknown[]>(getStreakHistory);
    expect(res).toEqual([]);
  });

  it("reads a member's claims off their participant id, never off a payload", async () => {
    withHistory(
      [{ milestone: 3, streak_started_on: "2026-08-01", claimed_on: "2026-08-03", reward_ref: PULL }], // prettier-ignore
      [{ id: PULL, secret_card_id: CARD, tier: "rare" }],
      [{ id: CARD, name: "Ghost", art_path: null, back_path: null }],
    );
    const { getStreakHistory } = await import("./streaks.functions");
    const res = await callServerFn<{ milestone: number; card: { name: string } | null }[]>(
      getStreakHistory,
      // There is no field for an id, which is what makes it unabusable rather
      // than merely unused.
      { data: { participantId: GUEST }, headers: asMe() },
    );

    expect(res).toHaveLength(1);
    expect(res[0]?.milestone).toBe(3);
    expect(res[0]?.card?.name).toBe("Ghost");
    const call = mock.callsFor("streak_milestone_claims", "select")[0];
    expect(mock.eqValue(call, "participant_id")).toBe(ME);
    expect(mock.eqValue(call, "guest_id")).toBeUndefined();
  });

  it("reads a guest's off their guest id instead", async () => {
    withHistory([]);
    const { getStreakHistory } = await import("./streaks.functions");
    await callServerFn(getStreakHistory, { headers: asGuest() });
    const call = mock.callsFor("streak_milestone_claims", "select")[0];
    expect(mock.eqValue(call, "guest_id")).toBe(GUEST);
    expect(mock.eqValue(call, "participant_id")).toBeUndefined();
  });

  it("names the rung, and falls back to its number if it has been retired", async () => {
    withHistory([
      { milestone: 3, streak_started_on: "2026-08-01", claimed_on: "2026-08-03", reward_ref: null },
      // A rung the ladder no longer lists. The number is the one thing about it
      // that was ever persisted, so the row still renders.
      { milestone: 5, streak_started_on: "2026-07-01", claimed_on: "2026-07-05", reward_ref: null },
    ]);
    const { getStreakHistory } = await import("./streaks.functions");
    const res = await callServerFn<{ milestone: number; label: string | null }[]>(
      getStreakHistory,
      {
        headers: asMe(),
      },
    );
    expect(res.map((r) => [r.milestone, r.label])).toEqual([
      [3, STREAK_MILESTONES[0]!.label],
      [5, null],
    ]);
  });

  it("survives a payout whose pull has gone, rather than dropping the claim", async () => {
    // reward_ref carries no foreign key on purpose — a pull moves between
    // identities when a guest claims — so a dangling ref is a shape the schema
    // allows. The rung was still cashed and still has to say so.
    withHistory(
      [{ milestone: 7, streak_started_on: "2026-08-01", claimed_on: "2026-08-07", reward_ref: OTHER_PULL }], // prettier-ignore
      [],
      [],
    );
    const { getStreakHistory } = await import("./streaks.functions");
    const res = await callServerFn<{ milestone: number; card: unknown }[]>(getStreakHistory, {
      headers: asMe(),
    });
    expect(res).toHaveLength(1);
    expect(res[0]?.card).toBeNull();
  });

  it("keeps each rung's own level when one card paid two of them", async () => {
    // Every copy of a secret rolls its own level, and a milestone payout is a
    // copy — so two runs can be paid by the same card at two levels. The signed
    // view carries the level, so a cache keyed on the card alone made the second
    // rung wear the first one's word and pips.
    const OTHER = "00000000-0000-4000-8000-00000000ce04";
    withHistory(
      [
        { milestone: 3, streak_started_on: "2026-08-01", claimed_on: "2026-08-03", reward_ref: PULL }, // prettier-ignore
        { milestone: 3, streak_started_on: "2026-06-01", claimed_on: "2026-06-03", reward_ref: OTHER }, // prettier-ignore
      ],
      [
        { id: PULL, secret_card_id: CARD, tier: "mythic" },
        { id: OTHER, secret_card_id: CARD, tier: "common" },
      ],
      [{ id: CARD, name: "Ghost", art_path: null, back_path: null }],
    );
    const { getStreakHistory } = await import("./streaks.functions");
    const res = await callServerFn<{ card: { name: string; tier: string } | null }[]>(
      getStreakHistory,
      { headers: asMe() },
    );
    expect(res.map((r) => r.card?.tier)).toEqual(["mythic", "common"]);
    expect(res.every((r) => r.card?.name === "Ghost")).toBe(true);
  });

  it("carries no count of anything but this actor's own claims", async () => {
    // The silence rule, asserted by exact keys rather than by reading the
    // markup: a set size added here would reach the profile screen, and every
    // other read in this app is pinned the same way.
    withHistory(
      [{ milestone: 3, streak_started_on: "2026-08-01", claimed_on: "2026-08-03", reward_ref: PULL }], // prettier-ignore
      [{ id: PULL, secret_card_id: CARD, tier: "mythic" }],
      [{ id: CARD, name: "Ghost", art_path: null, back_path: null }],
    );
    const { getStreakHistory } = await import("./streaks.functions");
    const res = await callServerFn<Record<string, unknown>[]>(getStreakHistory, {
      headers: asMe(),
    });
    expect(Object.keys(res[0]!).sort()).toEqual([
      "card",
      "claimedOn",
      "label",
      "milestone",
      "streakStartedOn",
    ]);
    // And the card itself is the view getMySecrets already hands out, which has
    // no denominator on it either.
    const card = res[0]!.card as Record<string, unknown>;
    expect(Object.keys(card)).not.toContain("size");
    expect(Object.keys(card)).not.toContain("total");
  });
});
