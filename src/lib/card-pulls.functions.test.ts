// The player-card pull count.
//
// The database suite proves a row count is a people count. What is checked here
// is that the write can never be attributed to somebody other than the token
// holder, that a guest is not broken by it, and that the public read never hands
// back a participant id — the aggregate is public, the rows behind it are not.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseResponses } from "@/test/supabase-mock";
import { callServerFn, memberHeaders } from "@/test/server-fn";
import { signMemberToken } from "./session.server";

let mock = createSupabaseMock();

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return mock.client;
  },
}));

const EVENT_ID = "00000000-0000-4000-8000-0000000000ff";
const ME = "00000000-0000-4000-8000-0000000000aa";
const THEM = "00000000-0000-4000-8000-0000000000bb";
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
    const res = await callServerFn<{ ok: boolean; recorded: number; packsOpened: number }>(
      recordCardPulls,
      { data: { eventParticipantIds: [CARD_A] } },
    );
    expect(res).toEqual({ ok: true, recorded: 0, packsOpened: 0 });
    expect(mock.client.rpc).not.toHaveBeenCalled();
  });

  it("records the pack itself in the same call", async () => {
    // A pack of three cards you already own writes no new card_pulls row, so
    // counting packs from that table would stop counting the moment somebody's
    // collection filled up. The pack open is its own record.
    withDb({ "rpc.record_card_pulls": { data: 0 }, "rpc.record_pack_open": { data: 4 } });
    const { recordCardPulls } = await import("./card-pulls.functions");
    const res = await callServerFn<{ packsOpened: number }>(recordCardPulls, {
      data: { eventParticipantIds: [CARD_A, CARD_B], eventId: EVENT_ID },
      headers: asMe(),
    });
    expect(mock.client.rpc).toHaveBeenCalledWith("record_pack_open", {
      _participant_id: ME,
      _event_id: EVENT_ID,
      _card_count: 2,
    });
    expect(res.packsOpened).toBe(4);
  });

  it("credits the pack to the token holder, whatever the payload claims", async () => {
    withDb({ "rpc.record_card_pulls": { data: 1 }, "rpc.record_pack_open": { data: 1 } });
    const { recordCardPulls } = await import("./card-pulls.functions");
    await callServerFn(recordCardPulls, {
      data: { eventParticipantIds: [CARD_A], participantId: THEM },
      headers: asMe(),
    });
    const call = mock.client.rpc.mock.calls.find((c) => c[0] === "record_pack_open");
    expect(call?.[1]).toMatchObject({ _participant_id: ME });
  });

  it("credits the token holder, never a caller-supplied id", async () => {
    withDb({ "rpc.record_card_pulls": { data: 2 } });
    const { recordCardPulls } = await import("./card-pulls.functions");
    await callServerFn(recordCardPulls, {
      data: { eventParticipantIds: [CARD_A, CARD_B], participantId: THEM },
      headers: asMe(),
    });
    expect(mock.client.rpc).toHaveBeenCalledWith("record_card_pulls", {
      _participant_id: ME,
      _event_participant_ids: [CARD_A, CARD_B],
    });
  });

  it("goes through the RPC rather than inserting rows itself", async () => {
    // The one-row-per-person-per-card rule is a composite primary key. A handler
    // inserting directly would be racing it.
    withDb({ "rpc.record_card_pulls": { data: 1 } });
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
          { event_participant_id: CARD_A, pull_count: 3, first_pulled_at: "2026-07-29T10:00:00Z" },
          { event_participant_id: CARD_B, pull_count: 1, first_pulled_at: "2026-07-31T10:00:00Z" },
        ],
      },
    });
    const { getMyCardStats } = await import("./card-pulls.functions");
    const res = await callServerFn<{
      packsOpened: number;
      firstPackOn: string | null;
      lastPackOn: string | null;
      cards: { eventParticipantId: string; pullCount: number }[];
    }>(getMyCardStats, { data: { eventId: EVENT_ID }, headers: asMe() });

    expect(res.packsOpened).toBe(2);
    expect(res.firstPackOn).toBe("2026-07-29");
    expect(res.lastPackOn).toBe("2026-07-31");
    expect(res.cards).toHaveLength(2);
    expect(res.cards[0]).toEqual({
      eventParticipantId: CARD_A,
      pullCount: 3,
      firstPulledAt: "2026-07-29T10:00:00Z",
    });
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
