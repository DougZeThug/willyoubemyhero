// The Trading Post's handlers.
//
// One thing is worth testing here rather than against Postgres, because Postgres
// cannot see it: the actor is always the token holder and never the payload.
// Everything about what the RPCs then do with their arguments — including that a
// finish travels with a traded copy and never reaches the public record — lives
// in tests/db/trades.test.ts.
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

// The publishable-key client is built with createClient rather than imported, so
// it is stubbed at the supabase-js boundary. A SECOND fake, not the same one:
// which client served a read is the thing worth asserting on a public handler,
// and one shared object cannot answer that.
let publicMock = createSupabaseMock();
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => publicMock.client,
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
const COPY_1 = "00000000-0000-4000-8000-000000000051";
const COPY_2 = "00000000-0000-4000-8000-000000000052";
const COPY_3 = "00000000-0000-4000-8000-000000000053";

const ACTIVE_EVENT = { "events.select": { data: { id: EVENT_ID } } };

function withDb(responses: SupabaseResponses = {}) {
  // Both clients answer the same declarations, so a test that only cares about
  // the rows it gets back does not have to know which one served them.
  mock = createSupabaseMock({ ...ACTIVE_EVENT, ...responses });
  publicMock = createSupabaseMock({ ...ACTIVE_EVENT, ...responses });
}

const asMe = () => memberHeaders(signMemberToken(ME).token);

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
  withDb();
});

const copy = (cardCopyId: string) => ({ kind: "roster" as const, cardCopyId });
const secret = (secretPullId: string) => ({ kind: "secret" as const, secretPullId });

describe("getTradeSpares", () => {
  async function spares(participantId: string, headers?: Record<string, string>) {
    const { getTradeSpares } = await import("./trades.functions");
    return callServerFn<TradeSpares>(getTradeSpares, { data: { participantId }, headers });
  }

  it("refuses a caller with no member token", async () => {
    await expect(spares(THEM)).rejects.toThrow("Claim your player first");
  });

  it("lists every copy of a card you hold more than one of", async () => {
    // A copy, not a count: which one you hand over is the choice per-copy trading
    // exists to give you, so listing only "the ones beyond the first" would take
    // it away again.
    withDb({
      "event_participants.select": { data: [{ id: CARD_A }, { id: CARD_B }] },
      "card_copies.select": {
        data: [
          { id: COPY_1, event_participant_id: CARD_A, edition: "platinum" },
          { id: COPY_2, event_participant_id: CARD_A, edition: "standard" },
          // Only one of CARD_B: not a spare, so it must not appear at all.
          { id: COPY_3, event_participant_id: CARD_B, edition: "gold" },
        ],
      },
    });
    const res = await spares(ME, asMe());
    expect(res.roster).toEqual([
      { copyId: COPY_1, eventParticipantId: CARD_A, edition: "platinum" },
      { copyId: COPY_2, eventParticipantId: CARD_A, edition: "standard" },
    ]);
  });

  it("carries the finish on each copy, which it deliberately did not before", async () => {
    // A widening, recorded here on purpose. The edition is client-asserted and
    // this response is read by somebody who is not its owner — but you cannot
    // choose which copy to give, or judge which one you are offered, without it.
    // What must still never carry a finish is the PUBLIC record; that is asserted
    // in tests/db/trades.test.ts against the real jsonb.
    withDb({
      "event_participants.select": { data: [{ id: CARD_A }] },
      "card_copies.select": {
        data: [
          { id: COPY_1, event_participant_id: CARD_A, edition: "platinum" },
          { id: COPY_2, event_participant_id: CARD_A, edition: "bronze" },
        ],
      },
    });
    const res = await spares(THEM, asMe());
    expect(res.roster.map((r) => r.edition)).toEqual(["platinum", "bronze"]);
  });

  it("falls an unrecognised finish back to standard rather than passing it through", async () => {
    withDb({
      "event_participants.select": { data: [{ id: CARD_A }] },
      "card_copies.select": {
        data: [
          { id: COPY_1, event_participant_id: CARD_A, edition: "legendary" },
          { id: COPY_2, event_participant_id: CARD_A, edition: "gold" },
        ],
      },
    });
    const res = await spares(ME, asMe());
    expect(res.roster[0].edition).toBe("standard");
  });

  it("asks about the participant in the payload, not the one holding the token", async () => {
    // The one id these handlers legitimately take from a request: you cannot
    // compose an offer without seeing what the other person has spare.
    withDb({ "event_participants.select": { data: [{ id: CARD_A }] } });
    await spares(THEM, asMe());
    const [copies] = mock.callsFor("card_copies", "select");
    expect(mock.eqValue(copies, "participant_id")).toBe(THEM);
    const [secrets] = mock.callsFor("secret_card_pulls", "select");
    expect(mock.eqValue(secrets, "participant_id")).toBe(THEM);
  });

  it("offers every copy, not just duplicates, and flags the last one", async () => {
    // THIS USED TO FILTER ON is_duplicate. A secret you own one of is still yours
    // to give; `lastCopy` is what makes that visible rather than surprising.
    withDb({
      "event_participants.select": { data: [] },
      "secret_card_pulls.select": {
        data: [
          // The only copy of this card — tradeable, and flagged.
          { id: PULL_ID, secret_card_id: SECRET_ID, tier: "mythic", granted: true, pulled_on: "2026-01-02" }, // prettier-ignore
          // Two of this one, so neither is anybody's last.
          { id: "p2", secret_card_id: "s2", tier: "rare", granted: true, pulled_on: "2026-01-02" }, // prettier-ignore
          { id: "p3", secret_card_id: "s2", tier: "common", granted: true, pulled_on: "2026-01-02" }, // prettier-ignore
        ],
      },
      "secret_cards.select": { data: [] },
    });
    const res = await spares(ME, asMe());
    const [call] = mock.callsFor("secret_card_pulls", "select");
    expect(mock.eqValue(call, "is_duplicate")).toBeUndefined();
    expect(res.secrets.map((s) => [s.pullId, s.lastCopy])).toEqual([
      [PULL_ID, true],
      ["p2", false],
      ["p3", false],
    ]);
  });

  it("does not call a copy the last one when today's pull is also held", async () => {
    // Counted over every row held, not just the stakeable ones: today's pull is
    // hidden from the picker but she still owns it, so the older copy is not her
    // last.
    withDb({
      "event_participants.select": { data: [] },
      "secret_card_pulls.select": {
        data: [
          { id: PULL_ID, secret_card_id: SECRET_ID, tier: "rare", granted: false, pulled_on: "2026-01-02" }, // prettier-ignore
          { id: "p2", secret_card_id: SECRET_ID, tier: "common", granted: false, pulled_on: leagueDay() }, // prettier-ignore
        ],
      },
      "secret_cards.select": { data: [] },
    });
    const res = await spares(ME, asMe());
    expect(res.secrets.map((s) => [s.pullId, s.lastCopy])).toEqual([[PULL_ID, false]]);
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
        lastCopy: true,
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

  const valid = { recipientId: THEM, give: [copy(COPY_1)], want: [copy(COPY_2)] };

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
    await propose({ recipientId: THEM, give: [secret(PULL_ID)], want: [copy(COPY_2)] }, asMe());
    expect(mock.client.rpc).toHaveBeenCalledWith("create_trade_offer", {
      _proposer_id: ME,
      _recipient_id: THEM,
      _event_id: EVENT_ID,
      _give: [{ kind: "secret", secretPullId: PULL_ID }],
      _want: [{ kind: "roster", cardCopyId: COPY_2 }],
    });
  });

  it("rejects an empty side before it reaches Postgres", async () => {
    await expect(propose({ ...valid, give: [] }, asMe())).rejects.toThrow();
    expect(mock.client.rpc).not.toHaveBeenCalled();
  });

  it("rejects a fifth card on a side", async () => {
    const five = [COPY_1, COPY_2, COPY_1, COPY_2, COPY_1].map(copy);
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
      propose({ ...valid, give: [{ kind: "wat", id: COPY_1 }] }, asMe()),
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
          { id: "i1", offer_id: OFFER_ID, giver_side: "proposer", kind: "roster", card_copy_id: COPY_1, secret_pull_id: null }, // prettier-ignore
          { id: "i2", offer_id: OFFER_ID, giver_side: "recipient", kind: "roster", card_copy_id: COPY_2, secret_pull_id: null }, // prettier-ignore
        ],
      },
      // Which card each staked copy is of, and its finish — read off the copy
      // rather than off the item, so it cannot drift from the row that will move.
      "card_copies.select": {
        data: [
          { id: COPY_1, event_participant_id: CARD_A, edition: "gold" },
          { id: COPY_2, event_participant_id: CARD_B, edition: "standard" },
        ],
      },
    });
    const res = await offers(asMe());
    expect(res.inbox.map((o) => o.id)).toEqual([OFFER_ID]);
    expect(res.outbox.map((o) => o.id)).toEqual(["o2"]);
    expect(res.recent.map((o) => o.id)).toEqual(["o3"]);
    expect(res.inbox[0].proposerGives).toEqual([
      { kind: "roster", copyId: COPY_1, eventParticipantId: CARD_A, edition: "gold" },
    ]);
    expect(res.inbox[0].recipientGives).toEqual([
      { kind: "roster", copyId: COPY_2, eventParticipantId: CARD_B, edition: "standard" },
    ]);
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
          { id: "i1", offer_id: OFFER_ID, giver_side: "proposer", kind: "secret", card_copy_id: null, secret_pull_id: PULL_ID }, // prettier-ignore
        ],
      },
      // Two calls in order: the staked rows, then every row for those cards so the
      // owner's copy count — and so `lastCopy` — can be worked out.
      "secret_card_pulls.select": [
        {
          data: [{ id: PULL_ID, participant_id: THEM, secret_card_id: SECRET_ID, tier: "mythic" }],
        },
        { data: [{ participant_id: THEM, secret_card_id: SECRET_ID }] },
      ],
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
        // The proposer holds exactly one — they are offering their only Gary.
        lastCopy: true,
      },
    ]);
  });

  it("drops an item whose card has since gone rather than rendering a blank", async () => {
    withDb({
      "trade_offers.select": [{ data: [] }, { data: [pendingIn] }],
      "trade_offer_items.select": {
        data: [
          { id: "i1", offer_id: OFFER_ID, giver_side: "proposer", kind: "secret", card_copy_id: null, secret_pull_id: PULL_ID }, // prettier-ignore
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
    const [call] = publicMock.callsFor("trades", "select");
    expect(publicMock.eqValue(call, "event_id")).toBe(EVENT_ID);
    expect(call.filters.find((f) => f.method === "order")?.args).toEqual([
      "executed_at",
      { ascending: false },
    ]);
    expect(call.filters.find((f) => f.method === "limit")?.args).toEqual([25]);
  });

  it("never selects a column that could name a secret card", async () => {
    withDb({ "trades.select": { data: [] } });
    await feed();
    const [call] = publicMock.callsFor("trades", "select");
    expect(call.columns).not.toContain("secret");
  });
});

describe("the feed goes through the publishable key", () => {
  it("reads trades as anon, leaving the grant as a second layer", async () => {
    // `trades` is the one trading table anon may SELECT. Everything else in this
    // file is behind requireMember() and reads rows anon is refused outright.
    withDb({ "trades.select": { data: [] } });
    const { getTradeFeed } = await import("./trades.functions");
    await callServerFn(getTradeFeed, { data: { eventId: EVENT_ID } });
    expect(publicMock.callsFor("trades", "select")).toHaveLength(1);
    expect(mock.calls).toHaveLength(0);
  });
});
