// The player-card pull count.
//
// The database suite proves a row count is a people count. What is checked here
// is that the writes can never be attributed to somebody other than the token
// holder, and that the public read never hands back a participant id — the
// aggregate is public, the rows behind it are not.
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

  it("carries the event its token authorizes into the database too", async () => {
    // `requireAdmin(eventId)` proves the caller runs THIS combine and nothing
    // more. Dropping the event after that check left the RPC asking only whether
    // the two ids existed, so the token's whole point — one commissioner, one
    // event — stopped at the guard and never reached the write.
    withDb({ "rpc.grant_card_copy_once": { data: { copies: 1, repeat: false } } });
    const { grantCard } = await import("./card-pulls.functions");
    await callServerFn(grantCard, {
      data: {
        eventId: EVENT_ID,
        participantId: ME,
        eventParticipantId: CARD_A,
        grantKey: "grant-key-1",
      },
      headers: adminHeaders(signAdminToken(EVENT_ID).token),
    });
    expect(mock.rpcCalls("grant_card_copy_once")[0]).toMatchObject({ _event_id: EVENT_ID });
  });

  it("takes the event from the token's own check, never from anywhere else", async () => {
    // Belt to the braces above: `data.eventId` is the value requireAdmin just
    // verified the token against, so an id in the payload can only ever be the
    // one the caller is already authorized for.
    withDb({ "rpc.grant_card_copy_once": { data: { copies: 1, repeat: false } } });
    const { grantCard } = await import("./card-pulls.functions");
    await expect(
      callServerFn(grantCard, {
        data: {
          eventId: OTHER_EVENT,
          participantId: ME,
          eventParticipantId: CARD_A,
          grantKey: "grant-key-1",
        },
        headers: adminHeaders(signAdminToken(EVENT_ID).token),
      }),
    ).rejects.toThrow("Admin PIN required");
    expect(mock.rpcCalls("grant_card_copy_once")).toHaveLength(0);
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

describe("adoptCollection", () => {
  it("refuses a caller with no member token", async () => {
    const { adoptCollection } = await import("./card-pulls.functions");
    await expect(
      callServerFn(adoptCollection, { data: { eventParticipantIds: [CARD_A] } }),
    ).rejects.toThrow("Claim your player first");
    expect(mock.client.rpc).not.toHaveBeenCalled();
  });

  it("adopts for the token holder and never sends a finish", async () => {
    // A phone from before the change still posts `editions` beside the ids.
    // Tolerated and dropped: the RPC files every adopted copy as standard, and
    // the handler must not hand it anything it could be tempted to read.
    withDb({ "rpc.adopt_card_copies": { data: 2 } });
    const { adoptCollection } = await import("./card-pulls.functions");
    const res = await callServerFn(adoptCollection, {
      data: { eventParticipantIds: [CARD_A, CARD_B], editions: ["platinum", "gold"] },
      headers: asMe(),
    });
    expect(res).toEqual({ ok: true, adopted: 2 });
    expect(mock.client.rpc).toHaveBeenCalledWith("adopt_card_copies", {
      _participant_id: ME,
      _event_participant_ids: [CARD_A, CARD_B],
      _editions: null,
    });
  });

  it("rejects an empty list and a 65th card before Postgres sees them", async () => {
    const { adoptCollection } = await import("./card-pulls.functions");
    await expect(
      callServerFn(adoptCollection, { data: { eventParticipantIds: [] }, headers: asMe() }),
    ).rejects.toThrow();
    const tooMany = Array.from(
      { length: 65 },
      (_, i) => `00000000-0000-4000-8000-0000000000${(i + 10).toString(16).padStart(2, "0")}`,
    );
    await expect(
      callServerFn(adoptCollection, { data: { eventParticipantIds: tooMany }, headers: asMe() }),
    ).rejects.toThrow();
    expect(mock.client.rpc).not.toHaveBeenCalled();
  });

  it("surfaces the RPC's own message", async () => {
    withDb({ "rpc.adopt_card_copies": { error: { message: "nope" } } });
    const { adoptCollection } = await import("./card-pulls.functions");
    await expect(
      callServerFn(adoptCollection, { data: { eventParticipantIds: [CARD_A] }, headers: asMe() }),
    ).rejects.toThrow("nope");
  });
});
