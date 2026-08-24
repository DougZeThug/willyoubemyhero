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
import { EDITION_IDS, editionSeed, rollEdition, type Edition } from "./card-edition";
import { packSeed } from "./pack";

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
    withDb({
      "rpc.record_card_pulls": { data: 2 },
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
      "rpc.record_card_pulls": { data: 1 },
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
      "rpc.record_card_pulls": { data: 1 },
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

  it("stores a forged edition's derivation, never the forgery", async () => {
    // The seed inputs are all server-known for a member (the day within ±1),
    // so a claimed set that matches no candidate day cannot have come from the
    // deal. The rpc must receive the derived set — this is what keeps a forged
    // platinum out of every number a second person can see.
    withDb({
      "rpc.record_card_pulls": { data: 2 },
      "rpc.record_pack_open": { data: 1 },
      "events.select": { data: { id: EVENT_ID } },
    });
    const { recordCardPulls } = await import("./card-pulls.functions");
    const ids = [CARD_A, CARD_B];
    // Candidate days computed the same way the handler computes them, taken
    // both before and after the call so a midnight tick between the two cannot
    // flake the assertion.
    const days = (now: Date) => {
      const fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      return [0, -1, 1].map((d) => fmt.format(new Date(now.getTime() + d * 86_400_000)));
    };
    const derive = (day: string) =>
      ids.map((id) => rollEdition(editionSeed(packSeed(EVENT_ID, day, `m:${ME}`), id)));
    const before = days(new Date());
    // An edition no candidate day rolls for the first card — five finishes and
    // at most three candidates guarantees one exists.
    const taken = new Set(before.map((d) => derive(d)[0]));
    const forged = [EDITION_IDS.find((e) => !taken.has(e))!, derive(before[0])[1]];

    await callServerFn(recordCardPulls, {
      data: { eventParticipantIds: ids, editions: forged },
      headers: asMe(),
    });
    const after = days(new Date());
    const call = mock.client.rpc.mock.calls.find((c) => c[0] === "record_card_pulls");
    const stored = (call?.[1] as { _editions: string[] })._editions;
    expect(stored).not.toEqual(forged);
    expect([derive(before[0]), derive(after[0])]).toContainEqual(stored);
  });

  it("stores an honest edition claim exactly as sent", async () => {
    // Built with the same primitives the real deal uses, on the league's own
    // clock — even if NY midnight ticks mid-test, yesterday is still inside
    // the candidate window, so the claim stays honest and stays stored.
    withDb({
      "rpc.record_card_pulls": { data: 2 },
      "rpc.record_pack_open": { data: 1 },
      "events.select": { data: { id: EVENT_ID } },
    });
    const { recordCardPulls } = await import("./card-pulls.functions");
    const ids = [CARD_A, CARD_B];
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const claimed = ids.map((id) =>
      rollEdition(editionSeed(packSeed(EVENT_ID, day, `m:${ME}`), id)),
    );
    await callServerFn(recordCardPulls, {
      data: { eventParticipantIds: ids, editions: claimed },
      headers: asMe(),
    });
    const call = mock.client.rpc.mock.calls.find((c) => c[0] === "record_card_pulls");
    expect((call?.[1] as { _editions: string[] })._editions).toEqual(claimed);
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
      _editions: null,
    });
  });

  it("passes the finishes positionally, lined up with the cards", async () => {
    // The RPC zips the two arrays, so the order here IS the mapping. An exact
    // assertion rather than a shape one: a reordering would still match a
    // toMatchObject and would file every finish against the wrong card.
    withDb({ "rpc.record_card_pulls": { data: 2 } });
    const { recordCardPulls } = await import("./card-pulls.functions");
    await callServerFn(recordCardPulls, {
      data: { eventParticipantIds: [CARD_A, CARD_B], editions: ["platinum", "standard"] },
      headers: asMe(),
    });
    expect(mock.client.rpc).toHaveBeenCalledWith("record_card_pulls", {
      _participant_id: ME,
      _event_participant_ids: [CARD_A, CARD_B],
      _editions: ["platinum", "standard"],
    });
  });

  it("sends null, not an empty array, when the caller names no finishes", async () => {
    // unnest() pads a NULL against the ids and every row falls to standard. An
    // empty array would zip to nothing and drop the whole pack.
    withDb({ "rpc.record_card_pulls": { data: 1 } });
    const { recordCardPulls } = await import("./card-pulls.functions");
    await callServerFn(recordCardPulls, {
      data: { eventParticipantIds: [CARD_A] },
      headers: asMe(),
    });
    const call = mock.client.rpc.mock.calls.find((c) => c[0] === "record_card_pulls");
    expect(call?.[1]).toMatchObject({ _editions: null });
  });

  it("refuses finishes that do not line up one-to-one with the cards", async () => {
    // A mismatch would not fail in Postgres, it would silently misattribute —
    // unnest pads the short side with NULL — so it has to be caught here.
    const { recordCardPulls } = await import("./card-pulls.functions");
    await expect(
      callServerFn(recordCardPulls, {
        data: { eventParticipantIds: [CARD_A, CARD_B], editions: ["gold"] },
        headers: asMe(),
      }),
    ).rejects.toThrow();
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

describe("deriveEditions", () => {
  // Pinned mid-afternoon in New York, well clear of both midnights: the
  // candidate days are exactly the 24th and its two neighbours.
  const NOW = new Date("2026-08-24T18:00:00Z");
  const IDS = [CARD_A, CARD_B];
  const derive = (day: string) =>
    IDS.map((id) => rollEdition(editionSeed(packSeed(EVENT_ID, day, `m:${ME}`), id)));

  async function run(claimed: Edition[] | null, eventId: string | null = EVENT_ID) {
    const { deriveEditions } = await import("./card-pulls.functions");
    return deriveEditions({ eventId, participantId: ME, ids: IDS, claimed, now: NOW });
  }

  it("accepts a claim rolled on the league's own day", async () => {
    const claimed = derive("2026-08-24");
    expect(await run(claimed)).toEqual(claimed);
  });

  it("accepts a claim rolled a day either side — a UTC phone is not a forger", async () => {
    expect(await run(derive("2026-08-23"))).toEqual(derive("2026-08-23"));
    expect(await run(derive("2026-08-25"))).toEqual(derive("2026-08-25"));
  });

  it("replaces a claim no candidate day could have rolled", async () => {
    const taken = new Set(["2026-08-23", "2026-08-24", "2026-08-25"].map((d) => derive(d)[0]));
    const forged = [EDITION_IDS.find((e) => !taken.has(e))!, derive("2026-08-24")[1]];
    expect(await run(forged)).toEqual(derive("2026-08-24"));
  });

  it("leaves an absent claim absent, for phones from before editions", async () => {
    expect(await run(null)).toBeNull();
  });

  it("passes the claim through when no event is resolvable", async () => {
    // The seed's event third would be wrong, so a derivation would be noise —
    // and the claimed value is at worst a self-inflicted stat.
    const claimed: Edition[] = ["platinum", "standard"];
    expect(await run(claimed, null)).toEqual(claimed);
  });
});
