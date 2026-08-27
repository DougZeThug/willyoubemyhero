// The player-card pull count.
//
// The database suite proves a row count is a people count. What is checked here
// is that the write can never be attributed to somebody other than the token
// holder, that a guest is not broken by it, and that the public read never hands
// back a participant id — the aggregate is public, the rows behind it are not.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseResponses } from "@/test/supabase-mock";
import { adminHeaders, callServerFn, memberHeaders } from "@/test/server-fn";
import { signAdminToken, signMemberToken } from "./session.server";

let mock = createSupabaseMock();

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return mock.client;
  },
}));

const EVENT_ID = "00000000-0000-4000-8000-0000000000ff";
const ME = "00000000-0000-4000-8000-0000000000aa";
const THEM = "00000000-0000-4000-8000-0000000000bb";
const OTHER_EVENT = "00000000-0000-4000-8000-0000000000fe";
const CARD_A = "00000000-0000-4000-8000-00000000ca01";
const CARD_B = "00000000-0000-4000-8000-00000000ca02";

function withDb(responses: SupabaseResponses = {}) {
  mock = createSupabaseMock(responses);
}

const asMe = () => memberHeaders(signMemberToken(ME).token);

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
  withDb();
});

describe("recordCardPulls", () => {
  it("records nothing for a guest, and does not throw at them", async () => {
    // The one mutating handler in this app that deliberately does not throw. An
    // unclaimed guest still gets their three cards; this call is fire-and-forget,
    // so a throw would be an invisible console error rather than anything a
    // person could act on.
    const { recordCardPulls } = await import("./card-pulls.functions");
    const res = await callServerFn<{
      ok: boolean;
      recorded: number;
      packsOpened: number;
      editions: Record<string, string>;
    }>(recordCardPulls, { data: { eventParticipantIds: [CARD_A] } });
    // No finishes either: card_copies is keyed on a participant, so a guest's
    // pack reveals standards until they claim and adoptCollection files it.
    expect(res).toEqual({ ok: true, recorded: 0, packsOpened: 0, editions: {} });
    expect(mock.client.rpc).not.toHaveBeenCalled();
  });

  it("records the pack itself in the same call", async () => {
    // A pack of three cards you already own writes no new card_pulls row, so
    // counting packs from that table would stop counting the moment somebody's
    // collection filled up. The pack open is its own record.
    withDb({
      "rpc.record_card_pulls": { data: { recorded: 2, editions: {} } },
      "rpc.record_pack_open": { data: 4 },
      "events.select": { data: { id: EVENT_ID } },
    });
    const { recordCardPulls } = await import("./card-pulls.functions");
    const res = await callServerFn<{ packsOpened: number }>(recordCardPulls, {
      data: { eventParticipantIds: [CARD_A, CARD_B] },
      headers: asMe(),
    });
    expect(mock.client.rpc).toHaveBeenCalledWith("record_pack_open", {
      _participant_id: ME,
      _event_id: EVENT_ID,
      _card_count: 2,
      // A member's pack is theirs; the guest slot is what carries a pre-claim tear.
      _guest_id: null,
    });
    expect(res.packsOpened).toBe(4);
  });

  it("stamps the event it resolved itself, not one the caller named", async () => {
    // It used to be a payload field, which made it spoofable and — because the
    // pack screen fires this the moment the wrapper comes off — frequently null
    // on a resumed pack, with the latch stopping any retry.
    withDb({
      "rpc.record_card_pulls": { data: { recorded: 1, editions: {} } },
      "rpc.record_pack_open": { data: 1 },
      "events.select": { data: { id: EVENT_ID } },
    });
    const { recordCardPulls } = await import("./card-pulls.functions");
    await callServerFn(recordCardPulls, {
      data: { eventParticipantIds: [CARD_A], eventId: OTHER_EVENT },
      headers: asMe(),
    });
    const call = mock.client.rpc.mock.calls.find((c) => c[0] === "record_pack_open");
    expect(call?.[1]).toMatchObject({ _event_id: EVENT_ID });
  });

  it("records the card count the roster matched, not the length of the payload", async () => {
    // Otherwise a caller posts sixteen ids and stores a pack of sixteen. The RPC
    // returns how many rows it actually touched, which is the honest number.
    withDb({
      "rpc.record_card_pulls": { data: { recorded: 1, editions: {} } },
      "rpc.record_pack_open": { data: 1 },
      "events.select": { data: { id: EVENT_ID } },
    });
    const { recordCardPulls } = await import("./card-pulls.functions");
    await callServerFn(recordCardPulls, {
      data: { eventParticipantIds: [CARD_A, CARD_B] },
      headers: asMe(),
    });
    const call = mock.client.rpc.mock.calls.find((c) => c[0] === "record_pack_open");
    expect(call?.[1]).toMatchObject({ _card_count: 1 });
  });

  it("refuses a payload too big to be a pack", async () => {
    const { recordCardPulls } = await import("./card-pulls.functions");
    const roster = Array.from(
      { length: 17 },
      (_, i) => `00000000-0000-4000-8000-0000000${String(i).padStart(5, "0")}`,
    );
    await expect(
      callServerFn(recordCardPulls, { data: { eventParticipantIds: roster }, headers: asMe() }),
    ).rejects.toThrow();
  });

  it("ignores the finishes the payload claims", async () => {
    // The premise of the server-side derivation. A phone can send whatever it
    // likes; the RPC derives its own from (participant, card, league day) and this
    // handler must not hand the claim on — passing it through would be the
    // client-asserted finish coming back in through the window.
    withDb({
      "rpc.record_card_pulls": { data: { recorded: 2, editions: {} } },
      "rpc.record_pack_open": { data: 1 },
      "events.select": { data: { id: EVENT_ID } },
    });
    const { recordCardPulls } = await import("./card-pulls.functions");
    await callServerFn(recordCardPulls, {
      data: { eventParticipantIds: [CARD_A, CARD_B], editions: ["platinum", "gold"] },
      headers: asMe(),
    });
    const call = mock.client.rpc.mock.calls.find((c) => c[0] === "record_card_pulls");
    expect(call?.[1]).toMatchObject({ _editions: null });
  });

  it("reveals the finishes the server derived, keyed by card", async () => {
    withDb({
      "rpc.record_card_pulls": {
        data: { recorded: 2, editions: { [CARD_A]: "gold", [CARD_B]: "standard" } },
      },
      "rpc.record_pack_open": { data: 1 },
    });
    const { recordCardPulls } = await import("./card-pulls.functions");
    const res = await callServerFn<{ editions: Record<string, string> }>(recordCardPulls, {
      data: { eventParticipantIds: [CARD_A, CARD_B] },
      headers: asMe(),
    });
    expect(res.editions).toEqual({ [CARD_A]: "gold", [CARD_B]: "standard" });
  });

  it("renders a finish it does not recognise as standard", async () => {
    // The value crosses a jsonb boundary, so nothing upstream constrains it. A
    // rung the ladder has never heard of must not reach a component with no style
    // for it — the same fallback card-edition.ts applies everywhere else.
    withDb({
      "rpc.record_card_pulls": { data: { recorded: 1, editions: { [CARD_A]: "mythic" } } },
      "rpc.record_pack_open": { data: 1 },
    });
    const { recordCardPulls } = await import("./card-pulls.functions");
    const res = await callServerFn<{ editions: Record<string, string> }>(recordCardPulls, {
      data: { eventParticipantIds: [CARD_A] },
      headers: asMe(),
    });
    expect(res.editions[CARD_A]).toBe("standard");
  });

  it("credits the pack to the token holder, whatever the payload claims", async () => {
    withDb({
      "rpc.record_card_pulls": { data: { recorded: 1, editions: {} } },
      "rpc.record_pack_open": { data: 1 },
    });
    const { recordCardPulls } = await import("./card-pulls.functions");
    await callServerFn(recordCardPulls, {
      data: { eventParticipantIds: [CARD_A], participantId: THEM },
      headers: asMe(),
    });
    const call = mock.client.rpc.mock.calls.find((c) => c[0] === "record_pack_open");
    expect(call?.[1]).toMatchObject({ _participant_id: ME });
  });

  it("credits the token holder, never a caller-supplied id", async () => {
    withDb({ "rpc.record_card_pulls": { data: { recorded: 2, editions: {} } } });
    const { recordCardPulls } = await import("./card-pulls.functions");
    await callServerFn(recordCardPulls, {
      data: { eventParticipantIds: [CARD_A, CARD_B], participantId: THEM },
      headers: asMe(),
    });
    expect(mock.client.rpc).toHaveBeenCalledWith("record_card_pulls", {
      _participant_id: ME,
      _event_participant_ids: [CARD_A, CARD_B],
      _editions: null,
    });
  });

  it("always sends null for the ignored editions parameter", async () => {
    // The parameter survives only so an old client's call still resolves. Null
    // rather than an empty array because that is what the RPC's DEFAULT is, and
    // sending a value at all would invite somebody to start reading it again.
    withDb({ "rpc.record_card_pulls": { data: { recorded: 1, editions: {} } } });
    const { recordCardPulls } = await import("./card-pulls.functions");
    await callServerFn(recordCardPulls, {
      data: { eventParticipantIds: [CARD_A] },
      headers: asMe(),
    });
    const call = mock.client.rpc.mock.calls.find((c) => c[0] === "record_card_pulls");
    expect(call?.[1]).toMatchObject({ _editions: null });
  });

  it("refuses a finish outside the ladder", async () => {
    // The column has no CHECK, so this validator is the only thing stopping a
    // member inventing a rung and rendering a badge nobody else can pull.
    const { recordCardPulls } = await import("./card-pulls.functions");
    await expect(
      callServerFn(recordCardPulls, {
        data: { eventParticipantIds: [CARD_A], editions: ["legendary"] },
        headers: asMe(),
      }),
    ).rejects.toThrow();
  });

  it("goes through the RPC rather than inserting rows itself", async () => {
    // The one-row-per-person-per-card rule is a composite primary key. A handler
    // inserting directly would be racing it.
    withDb({ "rpc.record_card_pulls": { data: { recorded: 1, editions: {} } } });
    const { recordCardPulls } = await import("./card-pulls.functions");
    await callServerFn(recordCardPulls, {
      data: { eventParticipantIds: [CARD_A] },
      headers: asMe(),
    });
    expect(mock.callsFor("card_pulls", "insert")).toHaveLength(0);
  });

  it("rejects an empty pack at the validator", async () => {
    const { recordCardPulls } = await import("./card-pulls.functions");
    await expect(
      callServerFn(recordCardPulls, { data: { eventParticipantIds: [] }, headers: asMe() }),
    ).rejects.toThrow();
  });
});

describe("getCardPullCounts", () => {
  it("counts rows per card, because one row is one person", async () => {
    withDb({
      "event_participants.select": { data: [{ id: CARD_A }, { id: CARD_B }] },
      "card_pulls.select": {
        data: [
          { event_participant_id: CARD_A },
          { event_participant_id: CARD_A },
          { event_participant_id: CARD_B },
        ],
      },
    });
    const { getCardPullCounts } = await import("./card-pulls.functions");
    const res = await callServerFn<Record<string, number>>(getCardPullCounts, {
      data: { eventId: EVENT_ID },
    });
    expect(res).toEqual({ [CARD_A]: 2, [CARD_B]: 1 });
  });

  it("scopes to the event's own cards, so it cannot enumerate another one", async () => {
    withDb({
      "event_participants.select": { data: [{ id: CARD_A }] },
      "card_pulls.select": { data: [] },
    });
    const { getCardPullCounts } = await import("./card-pulls.functions");
    await callServerFn(getCardPullCounts, { data: { eventId: EVENT_ID } });
    const [eps] = mock.callsFor("event_participants", "select");
    expect(mock.eqValue(eps, "event_id")).toBe(EVENT_ID);
    const [pulls] = mock.callsFor("card_pulls", "select");
    expect(pulls.filters.find((f) => f.method === "in")?.args).toEqual([
      "event_participant_id",
      [CARD_A],
    ]);
  });

  it("never asks the database for a participant id", async () => {
    // The leak guard. The aggregate is public; who packed what is not, and it
    // must not be in the response even in a shape nobody renders.
    withDb({
      "event_participants.select": { data: [{ id: CARD_A }] },
      "card_pulls.select": { data: [{ event_participant_id: CARD_A }] },
    });
    const { getCardPullCounts } = await import("./card-pulls.functions");
    const res = await callServerFn<Record<string, number>>(getCardPullCounts, {
      data: { eventId: EVENT_ID },
    });
    expect(JSON.stringify(res)).not.toContain("participant_id");
    expect(Object.values(res).every((v) => typeof v === "number")).toBe(true);
  });

  it("does not touch the ledger at all for an event with no roster", async () => {
    withDb({ "event_participants.select": { data: [] } });
    const { getCardPullCounts } = await import("./card-pulls.functions");
    expect(await callServerFn(getCardPullCounts, { data: { eventId: EVENT_ID } })).toEqual({});
    expect(mock.callsFor("card_pulls")).toHaveLength(0);
  });

  it("is readable without a member token — the count is public, the rows are not", async () => {
    withDb({
      "event_participants.select": { data: [{ id: CARD_A }] },
      "card_pulls.select": { data: [{ event_participant_id: CARD_A }] },
    });
    const { getCardPullCounts } = await import("./card-pulls.functions");
    await expect(callServerFn(getCardPullCounts, { data: { eventId: EVENT_ID } })).resolves.toEqual(
      { [CARD_A]: 1 },
    );
  });
});

describe("getMyCardStats", () => {
  const twoPacks = { data: [{ opened_on: "2026-07-29" }, { opened_on: "2026-07-31" }] };

  it("refuses an unclaimed caller, unlike its neighbours", async () => {
    // The private half of card_pulls. `getCardPullCounts` serves everyone because
    // it is an aggregate; this returns rows, so there has to be a member behind it.
    const { getMyCardStats } = await import("./card-pulls.functions");
    await expect(callServerFn(getMyCardStats, { data: { eventId: EVENT_ID } })).rejects.toThrow();
  });

  it("returns your packs and your cards", async () => {
    withDb({
      "event_participants.select": { data: [{ id: CARD_A }, { id: CARD_B }] },
      "pack_opens.select": twoPacks,
      "card_pulls.select": {
        data: [
          {
            event_participant_id: CARD_A,
            pull_count: 3,
            edition: "platinum",
            first_pulled_at: "2026-07-29T10:00:00Z",
          },
          {
            event_participant_id: CARD_B,
            pull_count: 1,
            edition: "standard",
            first_pulled_at: "2026-07-31T10:00:00Z",
          },
        ],
      },
    });
    const { getMyCardStats } = await import("./card-pulls.functions");
    const res = await callServerFn<{
      packsOpened: number;
      firstPackOn: string | null;
      lastPackOn: string | null;
      cards: { eventParticipantId: string; pullCount: number; edition: string }[];
    }>(getMyCardStats, { data: { eventId: EVENT_ID }, headers: asMe() });

    expect(res.packsOpened).toBe(2);
    expect(res.firstPackOn).toBe("2026-07-29");
    expect(res.lastPackOn).toBe("2026-07-31");
    expect(res.cards).toHaveLength(2);
    expect(res.cards[0]).toEqual({
      eventParticipantId: CARD_A,
      pullCount: 3,
      edition: "platinum",
      firstPulledAt: "2026-07-29T10:00:00Z",
    });
    expect(res.cards[1].edition).toBe("standard");
  });

  it("asks the database for the finish, not just the count", async () => {
    // The column is the only record of a finish once the device forgets it, so a
    // select that drops it would silently reset everyone's collection to standard
    // the first time a merge ran.
    withDb({
      "event_participants.select": { data: [{ id: CARD_A }] },
      "pack_opens.select": { data: [] },
      "card_pulls.select": { data: [] },
    });
    const { getMyCardStats } = await import("./card-pulls.functions");
    await callServerFn(getMyCardStats, { data: { eventId: EVENT_ID }, headers: asMe() });
    const [pulls] = mock.callsFor("card_pulls", "select");
    expect(pulls.columns).toContain("edition");
  });

  it("reads the rows of the token holder and nobody else", async () => {
    withDb({
      "event_participants.select": { data: [{ id: CARD_A }] },
      "pack_opens.select": { data: [] },
      "card_pulls.select": { data: [] },
    });
    const { getMyCardStats } = await import("./card-pulls.functions");
    await callServerFn(getMyCardStats, {
      data: { eventId: EVENT_ID, participantId: THEM },
      headers: asMe(),
    });
    const [pulls] = mock.callsFor("card_pulls", "select");
    expect(mock.eqValue(pulls, "participant_id")).toBe(ME);
    const [opens] = mock.callsFor("pack_opens", "select");
    expect(mock.eqValue(opens, "participant_id")).toBe(ME);
  });

  it("scopes the cards to this event, so it cannot enumerate another one", async () => {
    withDb({
      "event_participants.select": { data: [{ id: CARD_A }] },
      "pack_opens.select": { data: [] },
      "card_pulls.select": { data: [] },
    });
    const { getMyCardStats } = await import("./card-pulls.functions");
    await callServerFn(getMyCardStats, { data: { eventId: EVENT_ID }, headers: asMe() });
    const [pulls] = mock.callsFor("card_pulls", "select");
    expect(pulls.filters.find((f) => f.method === "in")?.args).toEqual([
      "event_participant_id",
      [CARD_A],
    ]);
  });

  it("still reports packs for an event with no roster", async () => {
    // The pack count is about the person, not the roster — an event stripped back
    // to nothing must not erase what they opened.
    withDb({ "event_participants.select": { data: [] }, "pack_opens.select": twoPacks });
    const { getMyCardStats } = await import("./card-pulls.functions");
    const res = await callServerFn<{ packsOpened: number; cards: unknown[] }>(getMyCardStats, {
      data: { eventId: EVENT_ID },
      headers: asMe(),
    });
    expect(res).toMatchObject({ packsOpened: 2, cards: [] });
    expect(mock.callsFor("card_pulls")).toHaveLength(0);
  });

  it("carries no total, so it cannot leak a set size", async () => {
    // The rule from the header of card-pulls.ts: the "of 18" a screen shows comes
    // from the roster it already has, never from a response.
    withDb({
      "event_participants.select": { data: [{ id: CARD_A }] },
      "pack_opens.select": { data: [] },
      "card_pulls.select": { data: [] },
    });
    const { getMyCardStats } = await import("./card-pulls.functions");
    const res = await callServerFn<Record<string, unknown>>(getMyCardStats, {
      data: { eventId: EVENT_ID },
      headers: asMe(),
    });
    expect(Object.keys(res).sort()).toEqual(["cards", "firstPackOn", "lastPackOn", "packsOpened"]);
  });

  it("reports nothing rather than nulls for a member who has never opened a pack", async () => {
    withDb({
      "event_participants.select": { data: [{ id: CARD_A }] },
      "pack_opens.select": { data: [] },
      "card_pulls.select": { data: [] },
    });
    const { getMyCardStats } = await import("./card-pulls.functions");
    const res = await callServerFn<{
      packsOpened: number;
      firstPackOn: string | null;
      cards: unknown[];
    }>(getMyCardStats, { data: { eventId: EVENT_ID }, headers: asMe() });
    expect(res).toEqual({ packsOpened: 0, firstPackOn: null, lastPackOn: null, cards: [] });
  });
});

describe("grantCard", () => {
  // The only thing between a timed-out request, or a thumb on a phone in a
  // garden, and a real second copy used to be a per-row spinner — which does not
  // survive a reload, in a game whose whole economy is scarcity.
  it("carries the screen's grant key into the database", async () => {
    withDb({ "rpc.grant_card_copy_once": { data: { copies: 2, repeat: false } } });
    const { grantCard } = await import("./card-pulls.functions");
    const res = await callServerFn(grantCard, {
      data: {
        eventId: EVENT_ID,
        participantId: ME,
        eventParticipantId: CARD_A,
        grantKey: "grant-key-1",
      },
      headers: adminHeaders(signAdminToken(EVENT_ID).token),
    });
    expect(res).toMatchObject({ copies: 2, repeat: false });
    expect(mock.rpcCalls("grant_card_copy_once")[0]).toMatchObject({
      _grant_key: "grant-key-1",
      _participant_id: ME,
      _event_participant_id: CARD_A,
    });
  });

  it("reports a replayed key rather than a fresh copy", async () => {
    withDb({ "rpc.grant_card_copy_once": { data: { copies: 1, repeat: true } } });
    const { grantCard } = await import("./card-pulls.functions");
    const res = await callServerFn(grantCard, {
      data: {
        eventId: EVENT_ID,
        participantId: ME,
        eventParticipantId: CARD_A,
        grantKey: "grant-key-1",
      },
      headers: adminHeaders(signAdminToken(EVENT_ID).token),
    });
    expect(res).toMatchObject({ copies: 1, repeat: true });
  });
});
