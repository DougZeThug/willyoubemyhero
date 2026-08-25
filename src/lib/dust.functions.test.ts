// The dust handlers, against a fake PostgREST.
//
// Everything about WHETHER a spend is allowed lives in SQL under the participant
// row lock, and tests/db/dust.test.ts is where that is pinned. What is asserted
// here is the half these handlers actually own: that the participant comes off
// the verified token and never off the payload, that a soft failure comes back as
// a reason rather than a throw, and that no response carries a total.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { callServerFn, memberHeaders } from "@/test/server-fn";
import { createSupabaseMock, type SupabaseResponses } from "@/test/supabase-mock";
import { signMemberToken } from "@/lib/session.server";

let mock = createSupabaseMock();

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return mock.client;
  },
}));

const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";
const COPY = "33333333-3333-4333-8333-333333333333";
const REQ = "44444444-4444-4444-8444-444444444444";

function withDb(responses: SupabaseResponses = {}) {
  mock = createSupabaseMock(responses);
}

const asMe = () => memberHeaders(signMemberToken(ME).token);

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
  withDb();
});

describe("getDustBalance", () => {
  it("refuses a caller with no account", async () => {
    // Unlike recordCardPulls next door, this one throws: there is nothing to show
    // a guest and a silent zero would read as "you have spent it all".
    const { getDustBalance } = await import("./dust.functions");
    await expect(callServerFn(getDustBalance)).rejects.toThrow();
  });

  it("asks for the token holder's balance and nobody else's", async () => {
    withDb({ "rpc.dust_balance": { data: 140 } });
    const { getDustBalance } = await import("./dust.functions");
    const res = await callServerFn<{ balance: number }>(getDustBalance, { headers: asMe() });
    expect(res.balance).toBe(140);
    expect(mock.client.rpc).toHaveBeenCalledWith("dust_balance", { _participant_id: ME });
  });

  it("reads an empty ledger as nought rather than null", async () => {
    withDb({ "rpc.dust_balance": { data: null } });
    const { getDustBalance } = await import("./dust.functions");
    const res = await callServerFn<{ balance: number }>(getDustBalance, { headers: asMe() });
    expect(res.balance).toBe(0);
  });
});

describe("millCardCopy", () => {
  it("refuses a caller with no account", async () => {
    const { millCardCopy } = await import("./dust.functions");
    await expect(callServerFn(millCardCopy, { data: { cardCopyId: COPY } })).rejects.toThrow();
  });

  it("burns for the token holder, whatever the payload claims", async () => {
    // There is no participant parameter at all, which is the strongest version of
    // this rule — but a caller can still put one in the payload, and it must go
    // nowhere. Burning somebody else's spare would be the worst bug here.
    withDb({
      "rpc.mill_card_copy": {
        data: { ok: true, awarded: 40, edition: "gold", eventParticipantId: "ep", balance: 40 },
      },
    });
    const { millCardCopy } = await import("./dust.functions");
    await callServerFn(millCardCopy, {
      data: { cardCopyId: COPY, participantId: THEM },
      headers: asMe(),
    });
    expect(mock.client.rpc).toHaveBeenCalledWith("mill_card_copy", {
      _participant_id: ME,
      _card_copy_id: COPY,
    });
  });

  it("passes a refusal back as a reason rather than throwing", async () => {
    // Every one of these is something to say on the button and none of them is
    // something a retry would fix, so a throw would be an error nobody can act on.
    withDb({ "rpc.mill_card_copy": { data: { ok: false, reason: "last_copy" } } });
    const { millCardCopy } = await import("./dust.functions");
    const res = await callServerFn<{ ok: boolean; reason: string }>(millCardCopy, {
      data: { cardCopyId: COPY },
      headers: asMe(),
    });
    expect(res).toEqual({ ok: false, reason: "last_copy" });
  });

  it("treats a missing answer as a refusal, not a payout", async () => {
    withDb({ "rpc.mill_card_copy": { data: null } });
    const { millCardCopy } = await import("./dust.functions");
    const res = await callServerFn<{ ok: boolean; reason: string }>(millCardCopy, {
      data: { cardCopyId: COPY },
      headers: asMe(),
    });
    expect(res.ok).toBe(false);
  });

  it("rejects a copy id that is not a uuid", async () => {
    const { millCardCopy } = await import("./dust.functions");
    await expect(
      callServerFn(millCardCopy, { data: { cardCopyId: "../../etc" }, headers: asMe() }),
    ).rejects.toThrow();
  });
});

describe("buyBonusSecretPull", () => {
  const PULL = {
    pullId: "p",
    cardId: "c",
    day: "2026-08-25",
    duplicate: false,
    tier: "rare",
    granted: true,
    completedCollection: null,
    dust: 0,
  };

  it("refuses a caller with no account", async () => {
    const { buyBonusSecretPull } = await import("./dust.functions");
    await expect(callServerFn(buyBonusSecretPull, { data: { requestId: REQ } })).rejects.toThrow();
  });

  it("sends the caller's request id, so a lost response cannot charge twice", async () => {
    withDb({
      "rpc.buy_bonus_secret_pull": { data: { ok: true, price: 150, balance: 0, pull: PULL } },
    });
    const { buyBonusSecretPull } = await import("./dust.functions");
    await callServerFn(buyBonusSecretPull, { data: { requestId: REQ }, headers: asMe() });
    expect(mock.client.rpc).toHaveBeenCalledWith("buy_bonus_secret_pull", {
      _participant_id: ME,
      // Resolved server-side, the same reason recordCardPulls stopped passing one.
      _event_id: null,
      _request_id: REQ,
    });
  });

  it("passes an empty wallet back as a reason", async () => {
    withDb({
      "rpc.buy_bonus_secret_pull": { data: { ok: false, reason: "insufficient", balance: 20 } },
    });
    const { buyBonusSecretPull } = await import("./dust.functions");
    const res = await callServerFn<{ ok: boolean; reason: string; balance: number }>(
      buyBonusSecretPull,
      { data: { requestId: REQ }, headers: asMe() },
    );
    expect(res).toMatchObject({ ok: false, reason: "insufficient", balance: 20 });
  });

  it("carries no total, so it cannot leak a set size", async () => {
    // The one number this whole feature withholds. A bought pull is still a pull.
    withDb({
      "rpc.buy_bonus_secret_pull": { data: { ok: true, price: 150, balance: 0, pull: PULL } },
    });
    const { buyBonusSecretPull } = await import("./dust.functions");
    const res = await callServerFn(buyBonusSecretPull, {
      data: { requestId: REQ },
      headers: asMe(),
    });
    const json = JSON.stringify(res);
    expect(json).not.toContain("total");
    expect(json).not.toContain("remaining");
    expect(json).not.toContain("participant_id");
  });
});

describe("rerollCopyEdition", () => {
  it("refuses a caller with no account", async () => {
    const { rerollCopyEdition } = await import("./dust.functions");
    await expect(
      callServerFn(rerollCopyEdition, { data: { cardCopyId: COPY, requestId: REQ } }),
    ).rejects.toThrow();
  });

  it("rolls for the token holder and reports both ends of the swing", async () => {
    withDb({
      "rpc.reroll_copy_edition": {
        data: {
          ok: true,
          price: 50,
          from: "gold",
          to: "standard",
          eventParticipantId: "ep",
          balance: 0,
        },
      },
    });
    const { rerollCopyEdition } = await import("./dust.functions");
    const res = await callServerFn<{ from: string; to: string }>(rerollCopyEdition, {
      data: { cardCopyId: COPY, requestId: REQ },
      headers: asMe(),
    });
    // Down, and reported as such. A re-roll is a gamble; a handler that only
    // surfaced improvements would be lying about what the fifty dust bought.
    expect(res).toMatchObject({ from: "gold", to: "standard" });
    expect(mock.client.rpc).toHaveBeenCalledWith("reroll_copy_edition", {
      _participant_id: ME,
      _card_copy_id: COPY,
      _request_id: REQ,
    });
  });

  it("passes a staked copy back as a reason", async () => {
    withDb({ "rpc.reroll_copy_edition": { data: { ok: false, reason: "staked" } } });
    const { rerollCopyEdition } = await import("./dust.functions");
    const res = await callServerFn<{ ok: boolean; reason: string }>(rerollCopyEdition, {
      data: { cardCopyId: COPY, requestId: REQ },
      headers: asMe(),
    });
    expect(res).toEqual({ ok: false, reason: "staked", balance: undefined });
  });
});
