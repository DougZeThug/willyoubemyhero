// The Trading Post's handlers.
//
// Two things are worth testing here rather than against Postgres, because
// Postgres cannot see them: that the actor is always the token holder and never
// the payload, and that a spares response — which one member reads about
// ANOTHER — carries no edition. Everything about what the RPCs then do with
// their arguments lives in tests/db/trades.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseResponses } from "@/test/supabase-mock";
import { callServerFn, memberHeaders } from "@/test/server-fn";
import { signMemberToken } from "./session.server";
import { leagueDay, type TradeOfferView, type TradeSpares } from "./trades";

let mock = createSupabaseMock();

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return mock.client;
  },
}));

const EVENT_ID = "00000000-0000-4000-8000-0000000000ff";
const ME = "00000000-0000-4000-8000-0000000000aa";
const THEM = "00000000-0000-4000-8000-0000000000bb";
const SOMEBODY_ELSE = "00000000-0000-4000-8000-0000000000cc";
const CARD_A = "00000000-0000-4000-8000-000000000011";
const CARD_B = "00000000-0000-4000-8000-000000000012";
const OFFER_ID = "00000000-0000-4000-8000-000000000021";
const PULL_ID = "00000000-0000-4000-8000-000000000031";
const SECRET_ID = "00000000-0000-4000-8000-000000000041";

const ACTIVE_EVENT = { "events.select": { data: { id: EVENT_ID } } };

function withDb(responses: SupabaseResponses = {}) {
  mock = createSupabaseMock({ ...ACTIVE_EVENT, ...responses });
}

const asMe = () => memberHeaders(signMemberToken(ME).token);

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
  withDb();
});

const roster = (eventParticipantId: string) => ({ kind: "roster" as const, eventParticipantId });
const secret = (secretPullId: string) => ({ kind: "secret" as const, secretPullId });

describe("getTradeSpares", () => {
  async function spares(participantId: string, headers?: Record<string, string>) {
    const { getTradeSpares } = await import("./trades.functions");
    return callServerFn<TradeSpares>(getTradeSpares, { data: { participantId }, headers });
  }

  it("refuses a caller with no member token", async () => {
    await expect(spares(THEM)).rejects.toThrow("Claim your player first");
  });

  it("reports copies beyond the one you keep", async () => {
    withDb({
      "event_participants.select": { data: [{ id: CARD_A }, { id: CARD_B }] },
      "card_pulls.select": {
        data: [
          { event_participant_id: CARD_A, pull_count: 2 },
          { event_participant_id: CARD_B, pull_count: 5 },
        ],
      },
    });
    const res = await spares(ME, asMe());
    expect(res.roster).toEqual([
      { eventParticipantId: CARD_A, spareCount: 1 },
      { eventParticipantId: CARD_B, spareCount: 4 },
    ]);
  });

  it("never asks for an edition, let alone returns one", async () => {
    // A spares response is read by somebody who is not its owner, and the edition
    // column is client-asserted — card-pulls.functions.ts says in as many words
    // that it must not enter a number a second person can see without being
    // re-derived first. Asserting on the column list rather than the response,
    // because the mock returns whatever the test declared regardless of what was
    // selected: a handler that started mapping `edition` would pass otherwise.
    withDb({
      "event_participants.select": { data: [{ id: CARD_A }] },
      "card_pulls.select": {
        data: [{ event_participant_id: CARD_A, pull_count: 3, edition: "platinum" }],
      },
    });
    const res = await spares(THEM, asMe());
    const [call] = mock.callsFor("card_pulls", "select");
    expect(call.columns).not.toContain("edition");
    expect(JSON.stringify(res)).not.toContain("platinum");
    expect(JSON.stringify(res)).not.toContain("edition");
  });

  it("asks about the participant in the payload, not the one holding the token", async () => {
    // The one id these handlers legitimately take from a request: you cannot
    // compose an offer without seeing what the other person has spare.
    withDb({ "event_participants.select": { data: [{ id: CARD_A }] } });
    await spares(THEM, asMe());
    const [pulls] = mock.callsFor("card_pulls", "select");
    expect(mock.eqValue(pulls, "participant_id")).toBe(THEM);
    const [secrets] = mock.callsFor("secret_card_pulls", "select");
    expect(mock.eqValue(secrets, "participant_id")).toBe(THEM);
  });

  it("only ever looks at duplicate secret copies", async () => {
    withDb({ "event_participants.select": { data: [] } });
    await spares(ME, asMe());
    const [call] = mock.callsFor("secret_card_pulls", "select");
    expect(mock.eqValue(call, "is_duplicate")).toBe(true);
  });

  it("hides today's own pull, which is that member's spent daily slot", async () => {
    // Mirrors trade_item_is_spare. Without it the picker offers a card the RPC
    // then refuses, and the person is told their own spare is not their spare.
    withDb({
      "event_participants.select": { data: [] },
      "secret_card_pulls.select": {
        data: [
          { id: PULL_ID, secret_card_id: SECRET_ID, tier: "rare", granted: false, pulled_on: leagueDay() }, // prettier-ignore
        ],
      },
    });
    const res = await spares(ME, asMe());
    expect(res.secrets).toEqual([]);
  });

  it("offers a copy from an earlier day", async () => {
    withDb({
      "event_participants.select": { data: [] },
      "secret_card_pulls.select": {
        data: [
          { id: PULL_ID, secret_card_id: SECRET_ID, tier: "rare", granted: false, pulled_on: "2026-01-02" }, // prettier-ignore
        ],
      },
      "secret_cards.select": {
        data: [{ id: SECRET_ID, name: "Gary the Grill", art_path: "secrets/spare-day/art.webp" }],
      },
      "storage.createSignedUrl": { data: { signedUrl: "https://signed/spare-day" } },
    });
    const res = await spares(ME, asMe());
    expect(res.secrets).toEqual([
      {
        pullId: PULL_ID,
        name: "Gary the Grill",
        artUrl: "https://signed/spare-day",
        tier: "rare",
      },
    ]);
  });

  it("offers a granted copy even on the day it landed", async () => {
    // A granted row was never anybody's daily slot, so the rule above does not
    // apply to it — which is also why the accept marks every traded copy granted.
    withDb({
      "event_participants.select": { data: [] },
      "secret_card_pulls.select": {
        data: [
          { id: PULL_ID, secret_card_id: SECRET_ID, tier: "common", granted: true, pulled_on: leagueDay() }, // prettier-ignore
        ],
      },
      "secret_cards.select": {
        data: [{ id: SECRET_ID, name: "The Dog", art_path: "secrets/granted-today/art.webp" }],
      },
      "storage.createSignedUrl": { data: { signedUrl: "https://signed/granted-today" } },
    });
    const res = await spares(ME, asMe());
    expect(res.secrets.map((s) => s.pullId)).toEqual([PULL_ID]);
  });

  it("returns nothing at all out of season", async () => {
    withDb({ "events.select": { data: null } });
    expect(await spares(ME, asMe())).toEqual({ participantId: ME, roster: [], secrets: [] });
  });
});

describe("createTradeOffer", () => {
  async function propose(data: unknown, headers?: Record<string, string>) {
    const { createTradeOffer } = await import("./trades.functions");
    return callServerFn(createTradeOffer, { data, headers });
  }

  const valid = { recipientId: THEM, give: [roster(CARD_A)], want: [roster(CARD_B)] };

  it("refuses a caller with no member token", async () => {
    await expect(propose(valid)).rejects.toThrow("Claim your player first");
  });

  it("proposes as the token holder, whatever the payload claims", async () => {
    withDb({ "rpc.create_trade_offer": { data: { ok: true, offerId: OFFER_ID } } });
    await propose(
      // Every one of these is ignored: the handler reads none of them.
      { ...valid, proposerId: SOMEBODY_ELSE, participantId: SOMEBODY_ELSE, _proposer_id: SOMEBODY_ELSE }, // prettier-ignore
      asMe(),
    );
    expect(mock.client.rpc).toHaveBeenCalledWith(
      "create_trade_offer",
      expect.objectContaining({ _proposer_id: ME, _recipient_id: THEM }),
    );
  });

  it("resolves the event server-side rather than taking one", async () => {
    withDb({ "rpc.create_trade_offer": { data: { ok: true, offerId: OFFER_ID } } });
    await propose({ ...valid, eventId: "00000000-0000-4000-8000-0000000000e0" }, asMe());
    expect(mock.client.rpc).toHaveBeenCalledWith(
      "create_trade_offer",
      expect.objectContaining({ _event_id: EVENT_ID }),
    );
  });

  it("passes both sides through untouched", async () => {
    withDb({ "rpc.create_trade_offer": { data: { ok: true, offerId: OFFER_ID } } });
    await propose({ recipientId: THEM, give: [secret(PULL_ID)], want: [roster(CARD_B)] }, asMe());
    expect(mock.client.rpc).toHaveBeenCalledWith("create_trade_offer", {
      _proposer_id: ME,
      _recipient_id: THEM,
      _event_id: EVENT_ID,
      _give: [{ kind: "secret", secretPullId: PULL_ID }],
      _want: [{ kind: "roster", eventParticipantId: CARD_B }],
    });
  });

  it("rejects an empty side before it reaches Postgres", async () => {
    await expect(propose({ ...valid, give: [] }, asMe())).rejects.toThrow();
    expect(mock.client.rpc).not.toHaveBeenCalled();
  });

  it("rejects a fifth card on a side", async () => {
    const five = [CARD_A, CARD_B, CARD_A, CARD_B, CARD_A].map(roster);
    await expect(propose({ ...valid, give: five }, asMe())).rejects.toThrow();
    expect(mock.client.rpc).not.toHaveBeenCalled();
  });

  it("rejects an item that names the wrong id for its kind", async () => {
    // The discriminated union is what stops `{kind:"roster", secretPullId}` — an
    // item that would satisfy neither half of the identity CHECK in the schema.
    await expect(
      propose({ ...valid, give: [{ kind: "roster", secretPullId: PULL_ID }] }, asMe()),
    ).rejects.toThrow();
    await expect(
      propose({ ...valid, give: [{ kind: "wat", id: CARD_A }] }, asMe()),
    ).rejects.toThrow();
  });

  it("rejects a recipient that is not a uuid", async () => {
    await expect(propose({ ...valid, recipientId: "bob" }, asMe())).rejects.toThrow();
  });

  it("surfaces the RPC's own message", async () => {
    withDb({ "rpc.create_trade_offer": { error: { message: "You cannot trade with yourself" } } });
    await expect(propose(valid, asMe())).rejects.toThrow("You cannot trade with yourself");
  });
});

describe("acceptTradeOffer", () => {
  async function take(data: unknown, headers?: Record<string, string>) {
    const { acceptTradeOffer } = await import("./trades.functions");
    return callServerFn(acceptTradeOffer, { data, headers });
  }

  it("refuses a caller with no member token", async () => {
    await expect(take({ offerId: OFFER_ID })).rejects.toThrow("Claim your player first");
  });

  it("accepts as the token holder, whatever the payload claims", async () => {
    // The offer id alone proves nothing: the RPC raises unless the caller is the
    // offer's recipient, and this is the line that decides who the caller is.
    withDb({ "rpc.accept_trade_offer": { data: { ok: true, tradeId: "t1" } } });
    await take({ offerId: OFFER_ID, recipientId: SOMEBODY_ELSE }, asMe());
    expect(mock.client.rpc).toHaveBeenCalledWith("accept_trade_offer", {
      _offer_id: OFFER_ID,
      _recipient_id: ME,
    });
  });

  it("passes a soft refusal through for the UI to explain", async () => {
    withDb({ "rpc.accept_trade_offer": { data: { ok: false, reason: "voided" } } });
    expect(await take({ offerId: OFFER_ID }, asMe())).toEqual({ ok: false, reason: "voided" });
  });

  it("passes a double-tap through the same way", async () => {
    withDb({ "rpc.accept_trade_offer": { data: { ok: false, reason: "resolved" } } });
    expect(await take({ offerId: OFFER_ID }, asMe())).toEqual({ ok: false, reason: "resolved" });
  });

  it("throws when the RPC does", async () => {
    withDb({ "rpc.accept_trade_offer": { error: { message: "Not your offer" } } });
    await expect(take({ offerId: OFFER_ID }, asMe())).rejects.toThrow("Not your offer");
  });
});

describe("declineTradeOffer and cancelTradeOffer", () => {
  async function decline(data: unknown, headers?: Record<string, string>) {
    const { declineTradeOffer } = await import("./trades.functions");
    return callServerFn(declineTradeOffer, { data, headers });
  }
  async function cancel(data: unknown, headers?: Record<string, string>) {
    const { cancelTradeOffer } = await import("./trades.functions");
    return callServerFn(cancelTradeOffer, { data, headers });
  }

  it("both refuse a caller with no member token", async () => {
    await expect(decline({ offerId: OFFER_ID })).rejects.toThrow("Claim your player first");
    await expect(cancel({ offerId: OFFER_ID })).rejects.toThrow("Claim your player first");
  });

  it("declines only an offer aimed at you, and only while it is pending", async () => {
    // These three filters ARE the guard — there is no RPC behind this one, so a
    // missing `.eq` would let anybody resolve anybody's offer.
    withDb({ "trade_offers.update": { data: { id: OFFER_ID } } });
    expect(await decline({ offerId: OFFER_ID }, asMe())).toEqual({ ok: true });
    const [call] = mock.callsFor("trade_offers", "update");
    expect(mock.eqValue(call, "id")).toBe(OFFER_ID);
    expect(mock.eqValue(call, "recipient_id")).toBe(ME);
    expect(mock.eqValue(call, "status")).toBe("pending");
    expect((call.payload as { status: string }).status).toBe("declined");
  });

  it("cancels only your own offer, and only while it is pending", async () => {
    withDb({ "trade_offers.update": { data: { id: OFFER_ID } } });
    expect(await cancel({ offerId: OFFER_ID }, asMe())).toEqual({ ok: true });
    const [call] = mock.callsFor("trade_offers", "update");
    expect(mock.eqValue(call, "proposer_id")).toBe(ME);
    expect(mock.eqValue(call, "status")).toBe("pending");
    expect((call.payload as { status: string }).status).toBe("cancelled");
  });

  it("reports a no-op rather than a success when nothing matched", async () => {
    // An UPDATE that matches no row is not an error, so without the returning
    // select this would tell somebody they had declined an offer they had not.
    withDb({ "trade_offers.update": { data: null } });
    expect(await decline({ offerId: OFFER_ID }, asMe())).toEqual({
      ok: false,
      reason: "resolved",
    });
    expect(await cancel({ offerId: OFFER_ID }, asMe())).toEqual({ ok: false, reason: "resolved" });
  });
});

describe("getMyTradeOffers", () => {
  async function offers(headers?: Record<string, string>) {
    const { getMyTradeOffers } = await import("./trades.functions");
    return callServerFn<{
      inbox: TradeOfferView[];
      outbox: TradeOfferView[];
      recent: TradeOfferView[];
    }>(getMyTradeOffers, { headers });
  }

  const pendingIn = {
    id: OFFER_ID,
    event_id: EVENT_ID,
    proposer_id: THEM,
    recipient_id: ME,
    status: "pending",
    created_at: "2026-08-17T10:00:00Z",
    resolved_at: null,
  };
  const pendingOut = { ...pendingIn, id: "o2", proposer_id: ME, recipient_id: THEM };
  const settled = {
    ...pendingIn,
    id: "o3",
    status: "declined",
    created_at: "2026-08-16T10:00:00Z",
  };

  it("refuses a caller with no member token", async () => {
    await expect(offers()).rejects.toThrow("Claim your player first");
  });

  it("splits pending offers by which way they point", async () => {
    withDb({
      // First call is the outbox query, second the inbox query.
      "trade_offers.select": [{ data: [pendingOut] }, { data: [pendingIn, settled] }],
      "trade_offer_items.select": {
        data: [
          { id: "i1", offer_id: OFFER_ID, giver_side: "proposer", kind: "roster", event_participant_id: CARD_A, secret_pull_id: null }, // prettier-ignore
          { id: "i2", offer_id: OFFER_ID, giver_side: "recipient", kind: "roster", event_participant_id: CARD_B, secret_pull_id: null }, // prettier-ignore
        ],
      },
    });
    const res = await offers(asMe());
    expect(res.inbox.map((o) => o.id)).toEqual([OFFER_ID]);
    expect(res.outbox.map((o) => o.id)).toEqual(["o2"]);
    expect(res.recent.map((o) => o.id)).toEqual(["o3"]);
    expect(res.inbox[0].proposerGives).toEqual([{ kind: "roster", eventParticipantId: CARD_A }]);
    expect(res.inbox[0].recipientGives).toEqual([{ kind: "roster", eventParticipantId: CARD_B }]);
  });

  it("scopes both queries to the token holder", async () => {
    withDb({ "trade_offers.select": { data: [] } });
    await offers(asMe());
    const calls = mock.callsFor("trade_offers", "select");
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => mock.eqValue(c, "proposer_id") ?? mock.eqValue(c, "recipient_id"))).toEqual([ME, ME]); // prettier-ignore
  });

  it("shows a staked secret's face to the two people in the offer", async () => {
    // The scoped exception, and its scope: reachable only through an offer you
    // are party to. You cannot judge "a secret card" sight unseen.
    withDb({
      "trade_offers.select": [{ data: [] }, { data: [pendingIn] }],
      "trade_offer_items.select": {
        data: [
          { id: "i1", offer_id: OFFER_ID, giver_side: "proposer", kind: "secret", event_participant_id: null, secret_pull_id: PULL_ID }, // prettier-ignore
        ],
      },
      "secret_card_pulls.select": {
        data: [{ id: PULL_ID, secret_card_id: SECRET_ID, tier: "mythic" }],
      },
      "secret_cards.select": {
        data: [{ id: SECRET_ID, name: "Gary the Grill", art_path: "secrets/offer-face/art.webp" }],
      },
      "storage.createSignedUrl": { data: { signedUrl: "https://signed/offer-face" } },
    });
    const res = await offers(asMe());
    expect(res.inbox[0].proposerGives).toEqual([
      {
        kind: "secret",
        pullId: PULL_ID,
        name: "Gary the Grill",
        artUrl: "https://signed/offer-face",
        tier: "mythic",
      },
    ]);
  });

  it("drops an item whose card has since gone rather than rendering a blank", async () => {
    withDb({
      "trade_offers.select": [{ data: [] }, { data: [pendingIn] }],
      "trade_offer_items.select": {
        data: [
          { id: "i1", offer_id: OFFER_ID, giver_side: "proposer", kind: "secret", event_participant_id: null, secret_pull_id: PULL_ID }, // prettier-ignore
        ],
      },
      "secret_card_pulls.select": { data: [] },
    });
    const res = await offers(asMe());
    expect(res.inbox[0].proposerGives).toEqual([]);
  });

  it("does not go looking for items when there are no offers", async () => {
    withDb({ "trade_offers.select": { data: [] } });
    expect(await offers(asMe())).toEqual({ inbox: [], outbox: [], recent: [] });
    expect(mock.callsFor("trade_offer_items")).toHaveLength(0);
  });
});

describe("getTradeFeed", () => {
  async function feed(headers?: Record<string, string>) {
    const { getTradeFeed } = await import("./trades.functions");
    return callServerFn(getTradeFeed, { data: { eventId: EVENT_ID }, headers });
  }

  it("is readable without a session — a completed trade is an announcement", async () => {
    withDb({
      "trades.select": {
        data: [
          {
            id: "t1",
            proposer_id: ME,
            recipient_id: THEM,
            proposer_gave: [{ kind: "secret" }],
            recipient_gave: [{ kind: "roster", eventParticipantId: CARD_A }],
            executed_at: "2026-08-17T10:00:00Z",
          },
        ],
      },
    });
    const res = await feed();
    expect(res).toEqual([
      {
        id: "t1",
        proposerId: ME,
        recipientId: THEM,
        proposerGave: [{ kind: "secret" }],
        recipientGave: [{ kind: "roster", eventParticipantId: CARD_A }],
        executedAt: "2026-08-17T10:00:00Z",
      },
    ]);
  });

  it("scopes to one event, newest first, and capped", async () => {
    withDb({ "trades.select": { data: [] } });
    await feed();
    const [call] = mock.callsFor("trades", "select");
    expect(mock.eqValue(call, "event_id")).toBe(EVENT_ID);
    expect(call.filters.find((f) => f.method === "order")?.args).toEqual([
      "executed_at",
      { ascending: false },
    ]);
    expect(call.filters.find((f) => f.method === "limit")?.args).toEqual([25]);
  });

  it("never selects a column that could name a secret card", async () => {
    withDb({ "trades.select": { data: [] } });
    await feed();
    const [call] = mock.callsFor("trades", "select");
    expect(call.columns).not.toContain("secret");
  });
});
