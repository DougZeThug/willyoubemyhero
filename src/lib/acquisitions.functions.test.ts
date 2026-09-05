// Guards and leaks on the acquisitions read.
//
// This handler mints signed URLs for secret cards, which puts it under the same
// rule secret-cards.functions.ts is written around: the response may say what you
// found, and may never say how much there is to find. So the assertions here are
// deliberately key-EXACT rather than spot checks — a count added to this response
// in six months' time is one careless step from being a count of the set, and the
// only thing that catches that is a test which fails on any new key at all.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseResponses } from "@/test/supabase-mock";
import { adminHeaders, callServerFn, guestHeaders, memberHeaders } from "@/test/server-fn";
import { signAdminToken, signGuestToken, signMemberToken } from "./session.server";
import type { RecentAcquisitions } from "./acquisitions.functions";

let mock = createSupabaseMock();

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return mock.client;
  },
}));

const EVENT_ID = "00000000-0000-4000-8000-0000000000ff";
const ME = "00000000-0000-4000-8000-0000000000aa";
const THEM = "00000000-0000-4000-8000-0000000000bb";
const EP_ONE = "00000000-0000-4000-8000-0000000000e1";
const EP_TWO = "00000000-0000-4000-8000-0000000000e2";
const CARD_ID = "00000000-0000-4000-8000-00000000ce01";
const GUEST = "00000000-0000-4000-8000-0000000000c1";
const SINCE = "2026-09-04T10:00:00.000Z";

const roster = { "event_participants.select": { data: [{ id: EP_ONE }, { id: EP_TWO }] } };

function withDb(responses: SupabaseResponses = {}) {
  mock = createSupabaseMock({ ...roster, ...responses });
}

const asMe = () => memberHeaders(signMemberToken(ME).token);
const asGuest = () => guestHeaders(signGuestToken(GUEST).token);
const asAdmin = () => adminHeaders(signAdminToken(EVENT_ID).token);
const input = { eventId: EVENT_ID, since: SINCE };

const copy = (over: Record<string, unknown> = {}) => ({
  event_participant_id: EP_ONE,
  edition: "gold",
  source: "pull",
  acquired_on: "2026-09-05",
  acquired_at: "2026-09-05T09:00:00.000Z",
  ...over,
});

const pull = (over: Record<string, unknown> = {}) => ({
  secret_card_id: CARD_ID,
  is_duplicate: false,
  tier: "epic",
  acquired_at: "2026-09-05T08:00:00.000Z",
  ...over,
});

const card = (id = CARD_ID, over: Record<string, unknown> = {}) => ({
  id,
  name: "Gary the Grill",
  flavour: "Lit at 11am. Still going at 11pm.",
  foil: "rosette",
  border_fx: "spin",
  collection: "pets",
  weight: 100,
  art_path: `secrets/${id}/art-1.webp`,
  back_path: `secrets/${id}/back-1.webp`,
  active: true,
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
  ...over,
});

/**
 * Imported inside the call rather than at the top of the file, the way every
 * handler test here does it: the vi.mock above is a getter, so the handler has to
 * reach for `supabaseAdmin` after `withDb()` has swapped the mock in.
 */
async function call(over: Record<string, unknown> = {}, headers: Record<string, string> = asMe()) {
  const { getRecentAcquisitions } = await import("./acquisitions.functions");
  return callServerFn<RecentAcquisitions>(getRecentAcquisitions, {
    data: { ...input, ...over },
    headers,
  });
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
  withDb();
});

describe("getRecentAcquisitions — who may ask", () => {
  it("refuses a device with no token at all", async () => {
    await expect(call({}, {})).rejects.toThrow("Claim your player first");
  });

  it("refuses a guest", async () => {
    // Guests are served everywhere secrets are, but card_copies.participant_id is
    // NOT NULL — they have no roster collection — so half this answer cannot exist
    // for them and the strip is members-only by design.
    await expect(call({}, asGuest())).rejects.toThrow("Claim your player first");
  });

  it("is not satisfied by the commissioner's PIN", async () => {
    // An admin token is not an identity: there is nobody to have acquired anything.
    await expect(call({}, asAdmin())).rejects.toThrow("Claim your player first");
  });

  it("rejects a since that is not a timestamp", async () => {
    await expect(call({ since: "yesterday" })).rejects.toThrow();
  });

  it("rejects an event id that is not a uuid", async () => {
    await expect(call({ eventId: "the-combine" })).rejects.toThrow();
  });
});

describe("getRecentAcquisitions — whose rows", () => {
  it("reads for the token holder, never for a caller-supplied id", async () => {
    withDb({ "card_copies.select": { data: [copy()] } });
    await call({ participantId: THEM } as Record<string, unknown>);
    for (const table of ["card_copies", "secret_card_pulls"] as const) {
      const query = mock.callsFor(table, "select")[0]!;
      expect(mock.eqValue(query, "participant_id")).toBe(ME);
    }
  });

  it("scopes roster copies to the combine that was asked about", async () => {
    // card_copies carries no event_id, so without this a copy from last year's
    // combine arrives in this year's strip as news.
    withDb({ "card_copies.select": { data: [copy()] } });
    await call();
    const eps = mock.callsFor("event_participants", "select")[0]!;
    expect(mock.eqValue(eps, "event_id")).toBe(EVENT_ID);
    const copies = mock.callsFor("card_copies", "select")[0]!;
    expect(copies.filters.find((f) => f.method === "in")?.args).toEqual([
      "event_participant_id",
      [EP_ONE, EP_TWO],
    ]);
  });

  it("does not read copies at all for a combine with no roster", async () => {
    withDb({ "event_participants.select": { data: [] } });
    const res = await call();
    expect(mock.callsFor("card_copies")).toHaveLength(0);
    expect(res.roster).toEqual([]);
  });

  it("asks the catalogue only about secrets this member actually pulled", async () => {
    withDb({
      "secret_card_pulls.select": { data: [pull()] },
      "secret_cards.select": { data: [card()] },
    });
    await call();
    const cards = mock.callsFor("secret_cards", "select")[0]!;
    expect(cards.filters.find((f) => f.method === "in")?.args).toEqual(["id", [CARD_ID]]);
  });
});

describe("getRecentAcquisitions — the window", () => {
  it("windows on acquired_at, not on acquired_on or created_at", async () => {
    // Neither of the other two would do. acquired_on is a date that every
    // hand-over path NULLs, so it drops exactly the traded and bought cards this
    // feature exists to surface; created_at is the MINT time and survives a
    // hand-over, because a trade re-parents the row rather than writing a new one
    // — so a card pulled in July and traded over this morning would still read
    // July and never appear. 20260905120000 is the column that means what this
    // needs, and asserting the column name here is what stops a future edit
    // quietly reaching for one of its neighbours.
    withDb({ "card_copies.select": { data: [copy()] } });
    await call();
    for (const table of ["card_copies", "secret_card_pulls"] as const) {
      const query = mock.callsFor(table, "select")[0]!;
      expect(query.filters.find((f) => f.method === "gte")?.args).toEqual(["acquired_at", SINCE]);
      expect(query.filters.find((f) => f.method === "order")?.args[0]).toBe("acquired_at");
      expect(query.columns).not.toMatch(/created_at/);
    }
  });

  it("returns a traded copy, which has no acquired_on at all", async () => {
    withDb({
      "card_copies.select": {
        data: [copy({ source: "trade", acquired_on: null, edition: "platinum" })],
      },
    });
    const res = await call();
    expect(res.roster).toEqual([
      {
        eventParticipantId: EP_ONE,
        edition: "platinum",
        source: "trade",
        acquiredOn: null,
        acquiredAt: "2026-09-05T09:00:00.000Z",
      },
    ]);
  });

  it("caps the answer at fifty, newest first, across both kinds", async () => {
    // The cap is over the ANSWER and not over either query: forty-five roster
    // copies must not be able to push every secret off the strip.
    const copies = Array.from({ length: 45 }, (_, i) =>
      copy({ acquired_at: `2026-09-05T${String(10 + i).padStart(2, "0")}:00:00.000Z` }),
    );
    const pulls = Array.from({ length: 15 }, (_, i) =>
      pull({ acquired_at: `2026-09-05T${String(40 + i).padStart(2, "0")}:00:00.000Z` }),
    );
    withDb({
      "card_copies.select": { data: copies },
      "secret_card_pulls.select": { data: pulls },
      "secret_cards.select": { data: [card()] },
    });
    const res = await call();
    expect(res.roster.length + res.secrets.length).toBe(50);
    // The fifty newest of the sixty, so the oldest roster copies are what went.
    const oldest = [...res.roster, ...res.secrets]
      .map((r) => r.acquiredAt)
      .sort()
      .at(0)!;
    expect(oldest > "2026-09-05T10:00:00.000Z").toBe(true);
  });
});

describe("getRecentAcquisitions — what it may say", () => {
  it("carries no set size, and no count of any kind", async () => {
    // This test's whole job is to catch a denominator. The "×3" the strip draws is
    // computed on the client from the collection it already holds; nothing here
    // counts cards, and nothing here may start to.
    withDb({
      "card_copies.select": { data: [copy()] },
      "secret_card_pulls.select": { data: [pull({ is_duplicate: true })] },
      "secret_cards.select": { data: [card()] },
      "storage.createSignedUrl": { data: { signedUrl: "https://signed/art" } },
    });
    const res = await call();

    expect(Object.keys(res).sort()).toEqual(["roster", "secrets"]);
    expect(Object.keys(res.roster[0]!).sort()).toEqual([
      "acquiredAt",
      "acquiredOn",
      "edition",
      "eventParticipantId",
      "source",
    ]);
    expect(Object.keys(res.secrets[0]!).sort()).toEqual([
      "acquiredAt",
      "artUrl",
      "duplicate",
      "id",
      "name",
      "tier",
    ]);
    expect(JSON.stringify(res)).not.toMatch(/"(total|setSize|size|count|pulled|collection|of)"/);
  });

  it("puts the level of the copy on the card, not the level of the row", async () => {
    withDb({
      "secret_card_pulls.select": { data: [pull({ tier: "mythic" })] },
      "secret_cards.select": { data: [card()] },
    });
    const res = await call();
    expect(res.secrets[0]!.tier).toBe("mythic");
    expect(res.secrets[0]!.duplicate).toBe(false);
  });

  it("falls back to common for a level nobody recognises", async () => {
    withDb({
      "secret_card_pulls.select": { data: [pull({ tier: "ultra" })] },
      "secret_cards.select": { data: [card()] },
    });
    const res = await call();
    expect(res.secrets[0]!.tier).toBe("common");
  });

  it("signs the front of a pulled card and never its back", async () => {
    // A unique path per test, because signPath caches at module scope and a shared
    // one would be answered from a previous test's mint.
    const art = "secrets/acquisitions-front-only/art-1.webp";
    withDb({
      "secret_card_pulls.select": { data: [pull()] },
      "secret_cards.select": {
        data: [card(CARD_ID, { art_path: art, back_path: "secrets/never/back-1.webp" })],
      },
      "storage.createSignedUrl": { data: { signedUrl: "https://signed/art" } },
    });
    const res = await call();
    expect(mock.storageBucket.createSignedUrl.mock.calls.map(([path]) => path)).toEqual([art]);
    expect(res.secrets[0]!.artUrl).toBe("https://signed/art");
  });

  it("skips a pull whose catalogue row has gone missing rather than half-drawing it", async () => {
    withDb({
      "secret_card_pulls.select": { data: [pull()] },
      "secret_cards.select": { data: [] },
    });
    const res = await call();
    expect(res.secrets).toEqual([]);
  });

  it("answers an empty window with two empty lists, not an error", async () => {
    const res = await call();
    expect(res).toEqual({ roster: [], secrets: [] });
  });
});
