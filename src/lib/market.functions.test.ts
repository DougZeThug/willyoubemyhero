// The marketplace handlers, against a fake PostgREST.
//
// Everything about WHETHER a listing or a sale is allowed lives in SQL under the
// participant row lock, and tests/db/market.test.ts is where that is pinned. What
// is asserted here is the half these handlers actually own: that the participant
// comes off the verified token and never off the payload, that a soft failure
// comes back as a reason rather than a throw, that the seller is poked only on a
// sale that happened — and, the one this feature adds, that a secret the viewer
// does not hold crosses the wire with no name, no art and no card id on it.
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

const nudged: string[] = [];
vi.mock("@/lib/nudge.server", () => ({
  tradeNudgeTopic: (id: string) => `nudge:v1:${id.slice(0, 8)}`,
  sendTradeNudge: async (id: string) => {
    nudged.push(id);
  },
}));

// signPath reaches for the storage client; the shelf only needs it to answer.
vi.mock("@/lib/media.functions", () => ({
  signPath: async (path: string | null) => (path ? `signed:${path}` : null),
}));

const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";
const COPY = "33333333-3333-4333-8333-333333333333";
const PULL = "44444444-4444-4444-8444-444444444444";
const LISTING = "55555555-5555-4555-8555-555555555555";
const REQ = "66666666-6666-4666-8666-666666666666";
const EVENT = "77777777-7777-4777-8777-777777777777";
const SECRET_CARD = "88888888-8888-4888-8888-888888888888";

function withDb(responses: SupabaseResponses = {}) {
  mock = createSupabaseMock(responses);
}

const asMe = () => memberHeaders(signMemberToken(ME).token);

/** The active-event lookup every read here does first. */
const activeEvent = { "events.select": { data: { id: EVENT } } };

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
  nudged.length = 0;
  withDb();
});

describe("getMarketListings", () => {
  it("refuses a caller with no account", async () => {
    // market_listings is keyed on participants, so there is nothing for a guest
    // to buy with even though a guest can hold cards.
    const { getMarketListings } = await import("./market.functions");
    await expect(callServerFn(getMarketListings)).rejects.toThrow();
  });

  it("asks only for other people's active listings at the live event", async () => {
    withDb({ ...activeEvent, "market_listings.select": { data: [] } });
    const { getMarketListings } = await import("./market.functions");
    await callServerFn(getMarketListings, { headers: asMe() });

    const [call] = mock.callsFor("market_listings", "select");
    expect(mock.eqValue(call, "status")).toBe("active");
    expect(mock.eqValue(call, "event_id")).toBe(EVENT);
    // Your own are in your stall, where they carry a price and a cancel button.
    expect(call.filters).toContainEqual({ method: "neq", args: ["seller_id", ME] });
  });

  it("hands back the caller's own nudge topic and nobody else's", async () => {
    withDb({ ...activeEvent, "market_listings.select": { data: [] } });
    const { getMarketListings } = await import("./market.functions");
    const res = await callServerFn<{ nudgeTopic: string | null }>(getMarketListings, {
      headers: asMe(),
    });
    expect(res.nudgeTopic).toBe(`nudge:v1:${ME.slice(0, 8)}`);
  });

  it("names a secret the viewer already holds", async () => {
    withDb({
      ...activeEvent,
      "market_listings.select": {
        data: [
          {
            id: LISTING,
            event_id: EVENT,
            seller_id: THEM,
            kind: "secret",
            card_copy_id: null,
            secret_pull_id: PULL,
            price: 120,
            status: "active",
            buyer_id: null,
            created_at: "2026-08-30T00:00:00Z",
            resolved_at: null,
          },
        ],
      },
      "secret_card_pulls.select": [
        // viewerSecrets: the caller holds a copy of this very card.
        { data: [{ secret_card_id: SECRET_CARD }] },
        { data: [{ id: PULL, secret_card_id: SECRET_CARD, tier: "legendary" }] },
      ],
      "secret_cards.select": { data: [{ id: SECRET_CARD, name: "Tucker", art_path: "a/b.webp" }] },
    });
    const { getMarketListings } = await import("./market.functions");
    const res = await callServerFn<{ listings: { item: Record<string, unknown> }[] }>(
      getMarketListings,
      { headers: asMe() },
    );
    expect(res.listings[0].item).toMatchObject({
      kind: "secret",
      name: "Tucker",
      artUrl: "signed:a/b.webp",
      tier: "legendary",
      concealed: false,
    });
  });

  it("withholds the name AND the art of a secret the viewer has never pulled", async () => {
    // THE RULE THIS FEATURE ADDS. The trade screen hides only the art, because you
    // cannot judge an offer sight unseen and you are inside a two-party
    // negotiation. The public feed goes further and names a secret — but only one
    // that ACTUALLY CHANGED HANDS, precisely so an untraded card appears nowhere
    // and the catalogue is not enumerable. A listing is not a completed trade, and
    // every unowned secret in the league could be on the shelf at once.
    withDb({
      ...activeEvent,
      "market_listings.select": {
        data: [
          {
            id: LISTING,
            event_id: EVENT,
            seller_id: THEM,
            kind: "secret",
            card_copy_id: null,
            secret_pull_id: PULL,
            price: 300,
            status: "active",
            buyer_id: null,
            created_at: "2026-08-30T00:00:00Z",
            resolved_at: null,
          },
        ],
      },
      "secret_card_pulls.select": [
        // The caller holds nothing.
        { data: [] },
        { data: [{ id: PULL, secret_card_id: SECRET_CARD, tier: "mythic" }] },
      ],
      "secret_cards.select": { data: [{ id: SECRET_CARD, name: "Tucker", art_path: "a/b.webp" }] },
    });
    const { getMarketListings } = await import("./market.functions");
    const res = await callServerFn(getMarketListings, { headers: asMe() });

    const json = JSON.stringify(res);
    expect(json).not.toContain("Tucker");
    expect(json).not.toContain("a/b.webp");
    expect(json).not.toContain(SECRET_CARD);
    // The tier still crosses, because it is what prices the card and it names
    // nothing about which card it is.
    expect(json).toContain("mythic");
  });

  it("never ships the row id behind a listing", async () => {
    // Buying names the LISTING. Shipping the copy or pull id would hand every
    // member a stable handle on every other member's individual rows, in bulk.
    withDb({
      ...activeEvent,
      "market_listings.select": {
        data: [
          {
            id: LISTING,
            event_id: EVENT,
            seller_id: THEM,
            kind: "roster",
            card_copy_id: COPY,
            secret_pull_id: null,
            price: 40,
            status: "active",
            buyer_id: null,
            created_at: "2026-08-30T00:00:00Z",
            resolved_at: null,
          },
        ],
      },
      "card_copies.select": {
        data: [
          { id: COPY, event_participant_id: "ep", edition: "gold", edition_asserted_by: "server" },
        ],
      },
      "secret_card_pulls.select": { data: [] },
    });
    const { getMarketListings } = await import("./market.functions");
    const res = await callServerFn(getMarketListings, { headers: asMe() });
    const json = JSON.stringify(res);
    expect(json).not.toContain(COPY);
    expect(json).toContain(LISTING);
    // And no total, no denominator, no set size — the rule the rest of the app keeps.
    expect(json).not.toContain("total");
    expect(json).not.toContain("remaining");
    expect(json).not.toContain("participant_id");
  });
});

describe("getMyStall", () => {
  it("refuses a caller with no account", async () => {
    const { getMyStall } = await import("./market.functions");
    await expect(callServerFn(getMyStall)).rejects.toThrow();
  });

  it("asks for the token holder's own listings and nobody else's", async () => {
    withDb({ "market_listings.select": { data: [] } });
    const { getMyStall } = await import("./market.functions");
    await callServerFn(getMyStall, { headers: asMe() });
    for (const call of mock.callsFor("market_listings", "select")) {
      expect(mock.eqValue(call, "seller_id")).toBe(ME);
    }
  });

  it("caps the settled half in SQL rather than after hydrating it", async () => {
    // A settled listing is never deleted and cancel-then-relist is two taps, so
    // one member's history grows without bound. Reading the lot and slicing to
    // ten afterwards would expand every listing they had ever made into an
    // `.in(...)` of copy and pull ids on every visit — slower every week, and
    // eventually a URL long enough to fail, which would take the ACTIVE half of
    // the stall down with it. getMyTradeOffers caps before it expands its items
    // for the same reason; this had drifted from it.
    withDb({ "market_listings.select": { data: [] } });
    const { getMyStall } = await import("./market.functions");
    await callServerFn(getMyStall, { headers: asMe() });

    const calls = mock.callsFor("market_listings", "select");
    expect(calls).toHaveLength(2);
    expect(calls.some((c) => mock.eqValue(c, "status") === "active")).toBe(true);

    const settled = calls.find((c) =>
      c.filters.some((f) => f.method === "neq" && f.args[0] === "status"),
    );
    expect(settled?.filters).toContainEqual({ method: "limit", args: [10] });
    // Ordered by when it settled, which is the question that list asks — not by
    // when it was created and re-sorted in JavaScript afterwards.
    expect(settled?.filters).toContainEqual({
      method: "order",
      args: ["resolved_at", { ascending: false }],
    });
  });

  it("hydrates only the rows it will actually return", async () => {
    // The property the cap exists for: whatever the history looks like, the
    // expansion below it is bounded.
    const row = (id: string, status: string) => ({
      id,
      event_id: EVENT,
      seller_id: ME,
      kind: "roster",
      card_copy_id: `copy-${id}`,
      secret_pull_id: null,
      price: 40,
      status,
      buyer_id: null,
      created_at: "2026-08-30T00:00:00Z",
      resolved_at: "2026-08-30T01:00:00Z",
    });
    withDb({
      "market_listings.select": [{ data: [row("a", "active")] }, { data: [row("b", "sold")] }],
      "card_copies.select": { data: [] },
      "secret_card_pulls.select": { data: [] },
    });
    const { getMyStall } = await import("./market.functions");
    await callServerFn(getMyStall, { headers: asMe() });

    const [copies] = mock.callsFor("card_copies", "select");
    expect(copies.filters).toContainEqual({ method: "in", args: ["id", ["copy-a", "copy-b"]] });
  });

  it("splits what is up from what settled, and says who bought it", async () => {
    // The settled half is the only place a sale is ever visible: it writes no row
    // into trades and reaches no public feed.
    const row = (id: string, status: string, resolved: string | null, buyer: string | null) => ({
      id,
      event_id: EVENT,
      seller_id: ME,
      kind: "roster",
      card_copy_id: COPY,
      secret_pull_id: null,
      price: 40,
      status,
      buyer_id: buyer,
      created_at: "2026-08-30T00:00:00Z",
      resolved_at: resolved,
    });
    // A queue rather than one answer: the active and settled halves are two
    // separate queries now, and a single response would serve both and duplicate
    // every row.
    withDb({
      "market_listings.select": [
        { data: [row(LISTING, "active", null, null)] },
        { data: [row(EVENT, "sold", "2026-08-30T01:00:00Z", THEM)] },
      ],
      "card_copies.select": {
        data: [
          { id: COPY, event_participant_id: "ep", edition: "gold", edition_asserted_by: "server" },
        ],
      },
      "secret_card_pulls.select": { data: [] },
    });
    const { getMyStall } = await import("./market.functions");
    const res = await callServerFn<{
      active: { id: string }[];
      recent: { id: string; status: string; buyerId: string | null }[];
    }>(getMyStall, { headers: asMe() });
    expect(res.active.map((l) => l.id)).toEqual([LISTING]);
    expect(res.recent[0]).toMatchObject({ status: "sold", buyerId: THEM });
  });

  it("shows a listing that settled between its two reads once, on the settled side", async () => {
    // The two reads go out together, so they are two snapshots. A listing that
    // sells in between satisfies BOTH predicates and comes back twice — once
    // still carrying "active". Splitting by status cannot tell that stale copy
    // from a live row, so the card used to appear in `active`, under a Take down
    // button its own RPC would refuse, and in `recent` as sold at the same time.
    const row = (status: string, resolved: string | null, buyer: string | null) => ({
      id: LISTING,
      event_id: EVENT,
      seller_id: ME,
      kind: "roster",
      card_copy_id: COPY,
      secret_pull_id: null,
      price: 40,
      status,
      buyer_id: buyer,
      created_at: "2026-08-30T00:00:00Z",
      resolved_at: resolved,
    });
    withDb({
      "market_listings.select": [
        // The live read, off the earlier snapshot.
        { data: [row("active", null, null)] },
        // The settled read, off the later one. Same row.
        { data: [row("sold", "2026-08-30T01:00:00Z", THEM)] },
      ],
      "card_copies.select": {
        data: [
          { id: COPY, event_participant_id: "ep", edition: "gold", edition_asserted_by: "server" },
        ],
      },
      "secret_card_pulls.select": { data: [] },
    });
    const { getMyStall } = await import("./market.functions");
    const res = await callServerFn<{
      active: { id: string }[];
      recent: { id: string; status: string; buyerId: string | null }[];
    }>(getMyStall, { headers: asMe() });
    expect(res.active).toEqual([]);
    expect(res.recent.map((l) => l.id)).toEqual([LISTING]);
    expect(res.recent[0]).toMatchObject({ status: "sold", buyerId: THEM });
  });

  it("orders two listings that settled mid-read by when they settled", async () => {
    // `recent` answers "what settled lately", so it is ordered by resolved_at --
    // and the live half is ordered by created_at. A row de-duplicated in place at
    // its live position would carry the wrong one of those two into the list.
    // Here the OLDER listing settles LAST, so the two orders disagree and only
    // resolved_at is right.
    const row = (id: string, status: string, created: string, resolved: string | null) => ({
      id,
      event_id: EVENT,
      seller_id: ME,
      kind: "roster",
      card_copy_id: `copy-${id}`,
      secret_pull_id: null,
      price: 40,
      status,
      buyer_id: status === "sold" ? THEM : null,
      created_at: created,
      resolved_at: resolved,
    });
    withDb({
      "market_listings.select": [
        // Live read, created_at desc: the NEWER listing first.
        {
          data: [
            row("new", "active", "2026-08-30T02:00:00Z", null),
            row("old", "active", "2026-08-30T01:00:00Z", null),
          ],
        },
        // Settled read, resolved_at desc: the older one settled last, so it leads.
        {
          data: [
            row("old", "sold", "2026-08-30T01:00:00Z", "2026-08-30T04:00:00Z"),
            row("new", "sold", "2026-08-30T02:00:00Z", "2026-08-30T03:00:00Z"),
          ],
        },
      ],
      "card_copies.select": {
        data: [
          { id: "copy-old", event_participant_id: "ep", edition: "standard", edition_asserted_by: "server" }, // prettier-ignore
          { id: "copy-new", event_participant_id: "ep", edition: "standard", edition_asserted_by: "server" }, // prettier-ignore
        ],
      },
      "secret_card_pulls.select": { data: [] },
    });
    const { getMyStall } = await import("./market.functions");
    const res = await callServerFn<{
      active: { id: string }[];
      recent: { id: string }[];
    }>(getMyStall, { headers: asMe() });
    expect(res.active).toEqual([]);
    expect(res.recent.map((l) => l.id)).toEqual(["old", "new"]);
  });

  describe("a sale whose card the buyer has since destroyed", () => {
    // The listing row survives now (20260924120000_keep_market_receipts.sql), but
    // with its copy or pull reference nulled. What it listed is on the row itself,
    // and this list is the only receipt the seller will ever get.
    const sold = (over: Record<string, unknown>) => ({
      id: LISTING,
      event_id: EVENT,
      seller_id: ME,
      card_copy_id: null,
      secret_pull_id: null,
      price: 300,
      status: "sold",
      buyer_id: THEM,
      created_at: "2026-08-30T00:00:00Z",
      resolved_at: "2026-08-30T01:00:00Z",
      listed_event_participant_id: null,
      listed_edition: null,
      listed_edition_asserted_by: null,
      listed_secret_card_id: null,
      listed_tier: null,
      ...over,
    });

    it("still shows a secret sold to the house, by name", async () => {
      withDb({
        "market_listings.select": [
          { data: [] },
          { data: [sold({ kind: "secret", listed_secret_card_id: SECRET_CARD, listed_tier: "rare" })] }, // prettier-ignore
        ],
        // Neither the seller's holdings nor the pull itself: both are gone.
        "secret_card_pulls.select": { data: [] },
        "secret_cards.select": { data: [{ id: SECRET_CARD, name: "Gary", art_path: "g/a.webp" }] },
      });
      const { getMyStall } = await import("./market.functions");
      const res = await callServerFn<{ recent: { id: string; item: Record<string, unknown> }[] }>(
        getMyStall,
        { headers: asMe() },
      );
      expect(res.recent.map((l) => l.id)).toEqual([LISTING]);
      expect(res.recent[0].item).toMatchObject({
        kind: "secret",
        name: "Gary",
        tier: "rare",
        concealed: false,
      });
      // Named from the snapshot, and the snapshot's id stays on the server.
      expect(JSON.stringify(res)).not.toContain(SECRET_CARD);
    });

    it("still shows a roster copy the buyer milled, in the finish it sold in", async () => {
      withDb({
        "market_listings.select": [
          { data: [] },
          {
            data: [
              sold({
                kind: "roster",
                listed_event_participant_id: "ep",
                listed_edition: "gold",
                listed_edition_asserted_by: "server",
              }),
            ],
          },
        ],
        "card_copies.select": { data: [] },
        "secret_card_pulls.select": { data: [] },
      });
      const { getMyStall } = await import("./market.functions");
      const res = await callServerFn<{ recent: { item: Record<string, unknown> }[] }>(getMyStall, {
        headers: asMe(),
      });
      expect(res.recent[0].item).toEqual({
        kind: "roster",
        eventParticipantId: "ep",
        edition: "gold",
        assertedBy: "server",
      });
    });
  });
});

describe("listCardForDust", () => {
  it("refuses a caller with no account", async () => {
    const { listCardForDust } = await import("./market.functions");
    await expect(
      callServerFn(listCardForDust, { data: { kind: "roster", copyId: COPY, price: 10 } }),
    ).rejects.toThrow();
  });

  it("lists for the token holder, whatever the payload claims", async () => {
    // There is no participant parameter at all, which is the strongest version of
    // this rule — but a caller can still put one in the payload, and it must go
    // nowhere. Shelving somebody else's card would be the worst bug here.
    withDb({ "rpc.list_card_for_dust": { data: { ok: true, listingId: LISTING, price: 10 } } });
    const { listCardForDust } = await import("./market.functions");
    await callServerFn(listCardForDust, {
      data: { kind: "roster", copyId: COPY, price: 10, participantId: THEM },
      headers: asMe(),
    });
    expect(mock.client.rpc).toHaveBeenCalledWith("list_card_for_dust", {
      _participant_id: ME,
      _kind: "roster",
      _card_copy_id: COPY,
      _secret_pull_id: null,
      _price: 10,
    });
  });

  it("sends a secret listing on its pull id and nothing else", async () => {
    withDb({ "rpc.list_card_for_dust": { data: { ok: true, listingId: LISTING, price: 300 } } });
    const { listCardForDust } = await import("./market.functions");
    await callServerFn(listCardForDust, {
      data: { kind: "secret", pullId: PULL, price: 300 },
      headers: asMe(),
    });
    expect(mock.client.rpc).toHaveBeenCalledWith("list_card_for_dust", {
      _participant_id: ME,
      _kind: "secret",
      _card_copy_id: null,
      _secret_pull_id: PULL,
      _price: 300,
    });
  });

  it("passes a refusal back as a reason rather than throwing", async () => {
    withDb({ "rpc.list_card_for_dust": { data: { ok: false, reason: "last_copy" } } });
    const { listCardForDust } = await import("./market.functions");
    const res = await callServerFn<{ ok: boolean; reason: string }>(listCardForDust, {
      data: { kind: "roster", copyId: COPY, price: 10 },
      headers: asMe(),
    });
    expect(res).toMatchObject({ ok: false, reason: "last_copy" });
  });

  it("carries back the listing that is already up, so the sheet can say its price", async () => {
    withDb({
      "rpc.list_card_for_dust": { data: { ok: false, reason: "already_listed", listingId: LISTING } }, // prettier-ignore
    });
    const { listCardForDust } = await import("./market.functions");
    const res = await callServerFn<{ reason: string; listingId: string }>(listCardForDust, {
      data: { kind: "roster", copyId: COPY, price: 10 },
      headers: asMe(),
    });
    expect(res).toMatchObject({ reason: "already_listed", listingId: LISTING });
  });

  it("treats a missing answer as a refusal, not a listing", async () => {
    withDb({ "rpc.list_card_for_dust": { data: null } });
    const { listCardForDust } = await import("./market.functions");
    const res = await callServerFn<{ ok: boolean }>(listCardForDust, {
      data: { kind: "roster", copyId: COPY, price: 10 },
      headers: asMe(),
    });
    expect(res.ok).toBe(false);
  });

  it("rejects a price Postgres would refuse, before it gets there", async () => {
    // Mirrored in market_listings_price_ck. The floor especially: a price of 0
    // would reach dust_ledger_delta_nonzero and raise inside a paid transaction.
    const { listCardForDust } = await import("./market.functions");
    for (const price of [0, -1, 10000, 1.5]) {
      await expect(
        callServerFn(listCardForDust, {
          data: { kind: "roster", copyId: COPY, price },
          headers: asMe(),
        }),
      ).rejects.toThrow();
    }
  });

  it("rejects a copy id that is not a uuid", async () => {
    const { listCardForDust } = await import("./market.functions");
    await expect(
      callServerFn(listCardForDust, {
        data: { kind: "roster", copyId: "../../etc", price: 10 },
        headers: asMe(),
      }),
    ).rejects.toThrow();
  });
});

describe("cancelMarketListing", () => {
  it("refuses a caller with no account", async () => {
    const { cancelMarketListing } = await import("./market.functions");
    await expect(callServerFn(cancelMarketListing, { data: { listingId: LISTING } })).rejects.toThrow(); // prettier-ignore
  });

  it("cancels for the token holder, whatever the payload claims", async () => {
    withDb({ "rpc.cancel_market_listing": { data: { ok: true } } });
    const { cancelMarketListing } = await import("./market.functions");
    await callServerFn(cancelMarketListing, {
      data: { listingId: LISTING, participantId: THEM },
      headers: asMe(),
    });
    expect(mock.client.rpc).toHaveBeenCalledWith("cancel_market_listing", {
      _participant_id: ME,
      _listing_id: LISTING,
    });
  });

  it("passes a listing that already sold back as a reason", async () => {
    withDb({ "rpc.cancel_market_listing": { data: { ok: false, reason: "resolved" } } });
    const { cancelMarketListing } = await import("./market.functions");
    const res = await callServerFn<{ ok: boolean; reason: string }>(cancelMarketListing, {
      data: { listingId: LISTING },
      headers: asMe(),
    });
    expect(res).toEqual({ ok: false, reason: "resolved" });
  });
});

describe("buyMarketListing", () => {
  const SALE = {
    ok: true,
    price: 120,
    kind: "roster",
    sellerId: THEM,
    eventParticipantId: "ep",
    edition: "gold",
    secretCardId: null,
    tier: null,
    duplicate: false,
    completedCollection: null,
    balance: 80,
  };

  it("refuses a caller with no account", async () => {
    const { buyMarketListing } = await import("./market.functions");
    await expect(
      callServerFn(buyMarketListing, { data: { listingId: LISTING, requestId: REQ } }),
    ).rejects.toThrow();
  });

  it("buys for the token holder, whatever the payload claims", async () => {
    withDb({ "rpc.buy_market_listing": { data: SALE } });
    const { buyMarketListing } = await import("./market.functions");
    await callServerFn(buyMarketListing, {
      data: { listingId: LISTING, requestId: REQ, participantId: THEM },
      headers: asMe(),
    });
    expect(mock.client.rpc).toHaveBeenCalledWith("buy_market_listing", {
      _participant_id: ME,
      _listing_id: LISTING,
      _request_id: REQ,
    });
  });

  it("pokes the seller read off the RPC's answer, never off a payload", async () => {
    withDb({ "rpc.buy_market_listing": { data: SALE } });
    const { buyMarketListing } = await import("./market.functions");
    await callServerFn(buyMarketListing, {
      data: { listingId: LISTING, requestId: REQ, sellerId: ME },
      headers: asMe(),
    });
    expect(nudged).toEqual([THEM]);
  });

  it("pokes nobody when the buy was refused", async () => {
    withDb({ "rpc.buy_market_listing": { data: { ok: false, reason: "resolved" } } });
    const { buyMarketListing } = await import("./market.functions");
    const res = await callServerFn<{ ok: boolean; reason: string }>(buyMarketListing, {
      data: { listingId: LISTING, requestId: REQ },
      headers: asMe(),
    });
    expect(res).toMatchObject({ ok: false, reason: "resolved" });
    expect(nudged).toEqual([]);
  });

  it("passes an empty wallet back with the numbers to say why", async () => {
    withDb({
      "rpc.buy_market_listing": { data: { ok: false, reason: "insufficient", balance: 20, price: 120 } }, // prettier-ignore
    });
    const { buyMarketListing } = await import("./market.functions");
    const res = await callServerFn<{ ok: boolean; reason: string; balance: number; price: number }>(
      buyMarketListing,
      { data: { listingId: LISTING, requestId: REQ }, headers: asMe() },
    );
    expect(res).toMatchObject({ ok: false, reason: "insufficient", balance: 20, price: 120 });
  });

  it("treats a missing answer as a refusal, not a card", async () => {
    withDb({ "rpc.buy_market_listing": { data: null } });
    const { buyMarketListing } = await import("./market.functions");
    const res = await callServerFn<{ ok: boolean }>(buyMarketListing, {
      data: { listingId: LISTING, requestId: REQ },
      headers: asMe(),
    });
    expect(res.ok).toBe(false);
    expect(nudged).toEqual([]);
  });

  it("carries no secret card id back to the buyer", async () => {
    // The invariant secret-cards.functions.ts states, kept through the one handler
    // that could plausibly break it: buying a secret tells you it is yours and
    // what tier it was, never which row of the catalogue it is.
    withDb({
      "rpc.buy_market_listing": {
        data: { ...SALE, kind: "secret", secretCardId: SECRET_CARD, tier: "mythic", eventParticipantId: null, edition: null }, // prettier-ignore
      },
    });
    const { buyMarketListing } = await import("./market.functions");
    const res = await callServerFn(buyMarketListing, {
      data: { listingId: LISTING, requestId: REQ },
      headers: asMe(),
    });
    const json = JSON.stringify(res);
    expect(json).not.toContain(SECRET_CARD);
    expect(json).not.toContain("total");
  });

  it("rejects a request id that is not a uuid", async () => {
    const { buyMarketListing } = await import("./market.functions");
    await expect(
      callServerFn(buyMarketListing, {
        data: { listingId: LISTING, requestId: "../../etc" },
        headers: asMe(),
      }),
    ).rejects.toThrow();
  });
});

describe("the disabled reason", () => {
  // The commissioner's switch is enforced in Postgres — every marketplace RPC
  // checks dust_enabled() before it takes a lock — so what these handlers owe is
  // passing the refusal through as something the sheet can say.
  it("comes back from a listing instead of a thrown error", async () => {
    withDb({ "rpc.list_card_for_dust": { data: { ok: false, reason: "disabled" } } });
    const { listCardForDust } = await import("./market.functions");
    const res = await callServerFn<{ reason: string }>(listCardForDust, {
      data: { kind: "roster", copyId: COPY, price: 10 },
      headers: asMe(),
    });
    expect(res.reason).toBe("disabled");
  });

  it("comes back from a purchase too", async () => {
    withDb({ "rpc.buy_market_listing": { data: { ok: false, reason: "disabled" } } });
    const { buyMarketListing } = await import("./market.functions");
    const res = await callServerFn<{ reason: string }>(buyMarketListing, {
      data: { listingId: LISTING, requestId: REQ },
      headers: asMe(),
    });
    expect(res.reason).toBe("disabled");
  });
});

describe("getMarketListings and provenance", () => {
  it("tells the buyer who decided a roster copy's finish", async () => {
    // A client-asserted "platinum" mills for the flat floor. Without this the
    // shelf showed the word and nothing else, and the word was what got paid for.
    withDb({
      ...activeEvent,
      "market_listings.select": {
        data: [
          {
            id: LISTING,
            event_id: EVENT,
            seller_id: THEM,
            kind: "roster",
            card_copy_id: COPY,
            secret_pull_id: null,
            price: 100,
            status: "active",
            buyer_id: null,
            created_at: "2026-08-30T00:00:00Z",
            resolved_at: null,
          },
        ],
      },
      "card_copies.select": {
        data: [{ id: COPY, event_participant_id: "ep", edition: "platinum", edition_asserted_by: "client" }], // prettier-ignore
      },
      "secret_card_pulls.select": { data: [] },
    });
    const { getMarketListings } = await import("./market.functions");
    const res = await callServerFn<{ listings: { item: Record<string, unknown> }[] }>(
      getMarketListings,
      { headers: asMe() },
    );
    expect(res.listings[0].item).toEqual({
      kind: "roster",
      eventParticipantId: "ep",
      edition: "platinum",
      assertedBy: "client",
    });
  });
});
