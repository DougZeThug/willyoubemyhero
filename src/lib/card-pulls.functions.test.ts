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
    const res = await callServerFn<{ ok: boolean; recorded: number }>(recordCardPulls, {
      data: { eventParticipantIds: [CARD_A] },
    });
    expect(res).toEqual({ ok: true, recorded: 0 });
    expect(mock.client.rpc).not.toHaveBeenCalled();
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
