// Guards and leaks on the secret-card handlers.
//
// The database tests prove one card a day is enforced by the schema. What is
// checked here is everything above it: that the member comes from the token, that
// a response never carries a card the caller has not pulled, and that the
// response shape has no denominator in it — "3 of 12" anywhere gives the set size
// away just as completely as a readable table would.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseResponses } from "@/test/supabase-mock";
import { adminHeaders, callServerFn, guestHeaders, memberHeaders } from "@/test/server-fn";
import { signAdminToken, signGuestToken, signMemberToken } from "./session.server";

let mock = createSupabaseMock();

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return mock.client;
  },
}));

const EVENT_ID = "00000000-0000-4000-8000-0000000000ff";
const OTHER_EVENT = "00000000-0000-4000-8000-0000000000fe";
const ME = "00000000-0000-4000-8000-0000000000aa";
const THEM = "00000000-0000-4000-8000-0000000000bb";
const CARD_ID = "00000000-0000-4000-8000-00000000ce01";
const OTHER_CARD = "00000000-0000-4000-8000-00000000ce02";
const GUEST = "00000000-0000-4000-8000-0000000000e1";

const activeEvent = { "events.select": { data: { id: EVENT_ID } } };

function withDb(responses: SupabaseResponses = {}) {
  mock = createSupabaseMock({ ...activeEvent, ...responses });
}

const asMe = () => memberHeaders(signMemberToken(ME).token);
const asGuest = (id = GUEST) => guestHeaders(signGuestToken(id).token);
const asAdmin = (eventId = EVENT_ID) => adminHeaders(signAdminToken(eventId).token);

const card = (id = CARD_ID, over: Record<string, unknown> = {}) => ({
  id,
  name: "Gary the Grill",
  flavour: "Lit at 11am. Still going at 11pm.",
  foil: "rosette",
  border_fx: "spin",
  weight: 100,
  art_path: `secrets/${id}/art-1.webp`,
  back_path: null,
  active: true,
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
  ...over,
});

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
  withDb();
});

describe("pullSecretCard", () => {
  it("requires an identity of some kind", async () => {
    // No member token and no guest token: a device that has never been through
    // the pack screen has nothing to attach a card to.
    const { pullSecretCard } = await import("./secret-cards.functions");
    await expect(callServerFn(pullSecretCard)).rejects.toThrow("Claim your player first");
  });

  it("is not satisfied by an admin token", async () => {
    // The commissioner PIN is not an identity — there is nobody to pull for.
    const { pullSecretCard } = await import("./secret-cards.functions");
    await expect(callServerFn(pullSecretCard, { headers: asAdmin() })).rejects.toThrow(
      "Claim your player first",
    );
  });

  it("pulls for the token holder, never for a caller-supplied id", async () => {
    withDb({
      "rpc.pull_secret_card": {
        data: { pullId: "p1", cardId: CARD_ID, day: "2026-07-28", duplicate: false, fresh: true },
      },
      "secret_cards.select": { data: card() },
      "storage.createSignedUrl": { data: { signedUrl: "https://signed/art" } },
    });
    const { pullSecretCard } = await import("./secret-cards.functions");
    // The handler takes no input at all, so there is nothing to smuggle — this
    // asserts the arg the RPC actually received.
    await callServerFn(pullSecretCard, { data: { participantId: THEM }, headers: asMe() });
    expect(mock.client.rpc).toHaveBeenCalledWith(
      "pull_secret_card",
      expect.objectContaining({ _participant_id: ME, _guest_id: null }),
    );
  });

  it("hands the finished set straight through, size and all", async () => {
    // The designed exception to the silence rule, and the only response in this
    // file allowed to carry a card count. The handler must not invent it: the
    // detection is atomic with the write inside pull_secret_card, so this asserts
    // the value arrives untouched rather than being recomputed here.
    withDb({
      "rpc.pull_secret_card": {
        data: {
          pullId: "p1",
          cardId: CARD_ID,
          day: "2026-07-28",
          duplicate: false,
          fresh: true,
          completedCollection: {
            collection: "pets",
            label: "Pets",
            size: 9,
            completedOn: "2026-07-28",
          },
        },
      },
      "secret_cards.select": { data: card() },
      "storage.createSignedUrl": { data: { signedUrl: "https://signed/art" } },
    });
    const { pullSecretCard } = await import("./secret-cards.functions");
    const res = await callServerFn<{ completedCollection: { size: number } | null }>(
      pullSecretCard,
      { headers: asMe() },
    );
    expect(res.completedCollection).toEqual({
      collection: "pets",
      label: "Pets",
      size: 9,
      completedOn: "2026-07-28",
    });
  });

  it("says null, not undefined, on every pull that finished nothing", async () => {
    // Which is all but one of them in a season. An absent key would make the
    // ceremony's `if (res.completedCollection)` depend on an old server still
    // being deployed; null is a shape the client can rely on.
    withDb({
      "rpc.pull_secret_card": {
        data: { pullId: "p1", cardId: CARD_ID, day: "2026-07-28", duplicate: false, fresh: true },
      },
      "secret_cards.select": { data: card() },
      "storage.createSignedUrl": { data: { signedUrl: "https://signed/art" } },
    });
    const { pullSecretCard } = await import("./secret-cards.functions");
    const res = await callServerFn<Record<string, unknown>>(pullSecretCard, { headers: asMe() });
    expect(res).toHaveProperty("completedCollection", null);
  });

  it("pulls for the guest the token names, never for a caller-supplied id", async () => {
    // The whole reason the guest identity is signed rather than a plain device
    // id: without this, naming somebody else's id would spend their pull.
    withDb({
      "rpc.pull_secret_card": {
        data: { pullId: "p1", cardId: CARD_ID, day: "2026-08-01", duplicate: false, fresh: true },
      },
      "secret_cards.select": { data: card() },
      "storage.createSignedUrl": { data: { signedUrl: "https://signed/art" } },
    });
    const { pullSecretCard } = await import("./secret-cards.functions");
    await callServerFn(pullSecretCard, {
      data: { guestId: "00000000-0000-4000-8000-0000000000ff" },
      headers: asGuest(),
    });
    expect(mock.client.rpc).toHaveBeenCalledWith(
      "pull_secret_card",
      expect.objectContaining({ _participant_id: null, _guest_id: GUEST }),
    );
  });

  it("prefers the member when a device carries both tokens", async () => {
    // A guest who claims a player keeps their old guest token in storage. Their
    // collection was merged onto the participant at claim time, so the member is
    // the identity that owns it — splitting them again would strand cards.
    withDb({
      "rpc.pull_secret_card": {
        data: { pullId: "p1", cardId: CARD_ID, day: "2026-08-01", duplicate: false, fresh: true },
      },
      "secret_cards.select": { data: card() },
      "storage.createSignedUrl": { data: { signedUrl: "https://signed/art" } },
    });
    const { pullSecretCard } = await import("./secret-cards.functions");
    await callServerFn(pullSecretCard, { headers: { ...asMe(), ...asGuest() } });
    expect(mock.client.rpc).toHaveBeenCalledWith(
      "pull_secret_card",
      expect.objectContaining({ _participant_id: ME, _guest_id: null }),
    );
  });

  it("goes through the RPC rather than writing the ledger itself", async () => {
    // The one-per-day rule is a unique index plus a row lock. A handler that
    // inserted directly would be racing it.
    withDb({
      "rpc.pull_secret_card": {
        data: { pullId: "p1", cardId: CARD_ID, day: "2026-07-28", duplicate: false, fresh: true },
      },
      "secret_cards.select": { data: card() },
    });
    const { pullSecretCard } = await import("./secret-cards.functions");
    await callServerFn(pullSecretCard, { headers: asMe() });
    expect(mock.callsFor("secret_card_pulls", "insert")).toHaveLength(0);
  });

  it("returns the card with a signed URL", async () => {
    withDb({
      "rpc.pull_secret_card": {
        data: { pullId: "p1", cardId: CARD_ID, day: "2026-07-28", duplicate: false, fresh: true },
      },
      "secret_cards.select": { data: card() },
      "storage.createSignedUrl": { data: { signedUrl: "https://signed/art" } },
    });
    const { pullSecretCard } = await import("./secret-cards.functions");
    const res = await callServerFn<{
      ok: true;
      card: { name: string; artUrl: string; foil: string; borderFx: string };
    }>(pullSecretCard, { headers: asMe() });
    expect(res.ok).toBe(true);
    expect(res.card.name).toBe("Gary the Grill");
    expect(res.card.artUrl).toBe("https://signed/art");
    // The look is the admin's choice, so the view must carry it — without these
    // two, every pulled card silently renders the default green spinner.
    expect(res.card.foil).toBe("rosette");
    expect(res.card.borderFx).toBe("spin");
  });

  it("reports a duplicate rather than pretending it is new", async () => {
    withDb({
      "rpc.pull_secret_card": {
        data: { pullId: "p2", cardId: CARD_ID, day: "2026-07-28", duplicate: true, fresh: true },
      },
      "secret_cards.select": { data: card() },
    });
    const { pullSecretCard } = await import("./secret-cards.functions");
    const res = await callServerFn<{ duplicate: boolean }>(pullSecretCard, { headers: asMe() });
    expect(res.duplicate).toBe(true);
  });

  it("fails softly when there is nothing to pull, so the pack screen still works", async () => {
    withDb({ "rpc.pull_secret_card": { data: null } });
    const { pullSecretCard } = await import("./secret-cards.functions");
    const res = await callServerFn<{ ok: false; reason: string }>(pullSecretCard, {
      headers: asMe(),
    });
    expect(res).toEqual({ ok: false, reason: "unavailable" });
  });

  it("never leaks a card id or a set size in the unavailable answer", async () => {
    withDb({ "rpc.pull_secret_card": { data: null } });
    const { pullSecretCard } = await import("./secret-cards.functions");
    const res = await callServerFn<Record<string, unknown>>(pullSecretCard, { headers: asMe() });
    expect(Object.keys(res).sort()).toEqual(["ok", "reason"]);
  });
});

describe("getSecretStatus", () => {
  it("tells a visitor with no identity at all nothing, and does not throw at them", async () => {
    const { getSecretStatus } = await import("./secret-cards.functions");
    const res = await callServerFn<Record<string, unknown>>(getSecretStatus);
    expect(res).toEqual({
      claimed: false,
      day: null,
      pulledToday: false,
      pulled: 0,
      available: false,
      resetsAt: null,
    });
    // Not even a round trip: nothing to ask about.
    expect(mock.client.rpc).not.toHaveBeenCalled();
  });

  it("asks about the token holder", async () => {
    withDb({
      "rpc.secret_pull_status": {
        data: {
          day: "2026-07-28",
          pulledToday: false,
          pulled: 2,
          available: true,
          resetsAt: "2026-07-29T04:00:00Z",
        },
      },
    });
    const { getSecretStatus } = await import("./secret-cards.functions");
    const res = await callServerFn<{ claimed: boolean; pulled: number }>(getSecretStatus, {
      headers: asMe(),
    });
    expect(mock.client.rpc).toHaveBeenCalledWith("secret_pull_status", {
      _participant_id: ME,
      _guest_id: null,
    });
    expect(res).toMatchObject({ claimed: true, pulled: 2 });
  });

  it("answers a guest about their own drop", async () => {
    // `claimed` is a misnomer kept on purpose — it has always meant "there is a
    // drop for you", and now a guest has one.
    withDb({
      "rpc.secret_pull_status": {
        data: {
          day: "2026-08-01",
          pulledToday: true,
          pulled: 1,
          available: true,
          resetsAt: "2026-08-02T04:00:00Z",
        },
      },
    });
    const { getSecretStatus } = await import("./secret-cards.functions");
    const res = await callServerFn<{ claimed: boolean; pulled: number }>(getSecretStatus, {
      headers: asGuest(),
    });
    expect(mock.client.rpc).toHaveBeenCalledWith("secret_pull_status", {
      _participant_id: null,
      _guest_id: GUEST,
    });
    expect(res).toMatchObject({ claimed: true, pulled: 1 });
  });

  it("carries no denominator", async () => {
    withDb({
      "rpc.secret_pull_status": {
        data: {
          day: "2026-07-28",
          pulledToday: true,
          pulled: 2,
          available: true,
          resetsAt: "2026-07-29T04:00:00Z",
        },
      },
    });
    const { getSecretStatus } = await import("./secret-cards.functions");
    const res = await callServerFn<Record<string, unknown>>(getSecretStatus, { headers: asMe() });
    expect(Object.keys(res).sort()).toEqual([
      "available",
      "claimed",
      "day",
      "pulled",
      "pulledToday",
      "resetsAt",
    ]);
  });
});

describe("getMySecrets", () => {
  // Deliberately NOT an error. A device with no token yet — or one whose token has
  // just expired — owns nothing, and throwing at it blanked the vault on its very
  // first paint, before the member token had been attached. Same posture
  // getSecretStatus takes. Do not "fix" this back to a rejection.
  it("gives an unidentified device an empty vault, not an error", async () => {
    const { getMySecrets } = await import("./secret-cards.functions");
    await expect(callServerFn(getMySecrets)).resolves.toEqual({ cards: [], pulled: 0 });
  });

  it("reads the ledger for the token holder", async () => {
    withDb({ "secret_card_pulls.select": { data: [] } });
    const { getMySecrets } = await import("./secret-cards.functions");
    await callServerFn(getMySecrets, { headers: asMe() });
    const [call] = mock.callsFor("secret_card_pulls", "select");
    expect(mock.eqValue(call, "participant_id")).toBe(ME);
  });

  it("reads a guest's ledger by their guest id, not by a participant", async () => {
    withDb({ "secret_card_pulls.select": { data: [] } });
    const { getMySecrets } = await import("./secret-cards.functions");
    await callServerFn(getMySecrets, { headers: asGuest() });
    const [call] = mock.callsFor("secret_card_pulls", "select");
    expect(mock.eqValue(call, "guest_id")).toBe(GUEST);
    expect(mock.eqValue(call, "participant_id")).toBeUndefined();
  });

  it("counts how many people have each card, and asks only about the ones you own", async () => {
    // The `.in(...)` on the owner query is the leak guard: without it the handler
    // reads the whole ledger and the size of the set is sitting in a local
    // variable one careless `return` from the wire.
    //
    // getMySecrets now issues TWO secret_card_pulls.select calls and the mock
    // ignores filters, so the queue form is what tells them apart.
    withDb({
      "secret_card_pulls.select": [
        { data: [{ secret_card_id: CARD_ID, pulled_on: "2026-07-28", is_duplicate: false }] },
        { data: [{ secret_card_id: CARD_ID }, { secret_card_id: CARD_ID }] },
      ],
      "secret_cards.select": { data: [card(CARD_ID)] },
    });
    const { getMySecrets } = await import("./secret-cards.functions");
    const res = await callServerFn<{ cards: { ownerCount: number }[] }>(getMySecrets, {
      headers: asMe(),
    });
    expect(res.cards[0].ownerCount).toBe(2);

    const owners = mock.callsFor("secret_card_pulls", "select")[1];
    expect(owners.filters.find((f) => f.method === "in")?.args).toEqual([
      "secret_card_id",
      [CARD_ID],
    ]);
  });

  it("returns only the cards this member pulled, and signs only those", async () => {
    // The catalogue holds two cards; the member has pulled one. A signed URL for
    // the other one in the response would defeat the whole feature even if the UI
    // never rendered it.
    // A path unique to this test: signPath caches by path at module scope, so a
    // path another test already signed would be served from the cache and never
    // reach the bucket at all.
    const ownedArt = "secrets/owned-only/art-1.webp";
    withDb({
      "secret_card_pulls.select": {
        data: [{ secret_card_id: CARD_ID, pulled_on: "2026-07-28", is_duplicate: false }],
      },
      "secret_cards.select": { data: [card(CARD_ID, { art_path: ownedArt })] },
      "storage.createSignedUrl": { data: { signedUrl: "https://signed/art" } },
    });
    const { getMySecrets } = await import("./secret-cards.functions");
    const res = await callServerFn<{ cards: { id: string }[]; pulled: number }>(getMySecrets, {
      headers: asMe(),
    });
    expect(res.cards.map((c) => c.id)).toEqual([CARD_ID]);
    expect(res.pulled).toBe(1);
    // The pulled card's art is signed, and nothing else is. back_path is null
    // here, so this is the only object with a URL minted for it.
    const signed = mock.storageBucket.createSignedUrl.mock.calls.map(([path]) => path);
    expect(signed).toEqual([ownedArt]);
  });

  it("asks the catalogue only about ids the member owns", async () => {
    withDb({
      "secret_card_pulls.select": {
        data: [{ secret_card_id: CARD_ID, pulled_on: "2026-07-28", is_duplicate: false }],
      },
      "secret_cards.select": { data: [card(CARD_ID)] },
    });
    const { getMySecrets } = await import("./secret-cards.functions");
    await callServerFn(getMySecrets, { headers: asMe() });
    const [call] = mock.callsFor("secret_cards", "select");
    const inFilter = call.filters.find((f) => f.method === "in");
    expect(inFilter?.args).toEqual(["id", [CARD_ID]]);
  });

  it("does not touch the catalogue at all for a member who has pulled nothing", async () => {
    withDb({ "secret_card_pulls.select": { data: [] } });
    const { getMySecrets } = await import("./secret-cards.functions");
    const res = await callServerFn<{ cards: unknown[]; pulled: number }>(getMySecrets, {
      headers: asMe(),
    });
    expect(res).toEqual({ cards: [], pulled: 0 });
    expect(mock.callsFor("secret_cards")).toHaveLength(0);
  });

  it("counts duplicates without counting them as ownership", async () => {
    withDb({
      "secret_card_pulls.select": {
        data: [
          { secret_card_id: CARD_ID, pulled_on: "2026-07-28", is_duplicate: true },
          { secret_card_id: CARD_ID, pulled_on: "2026-07-20", is_duplicate: false },
        ],
      },
      "secret_cards.select": { data: [card(CARD_ID)] },
    });
    const { getMySecrets } = await import("./secret-cards.functions");
    const res = await callServerFn<{
      cards: { count: number; firstPulledOn: string }[];
      pulled: number;
    }>(getMySecrets, { headers: asMe() });
    expect(res.pulled).toBe(1);
    expect(res.cards[0].count).toBe(2);
    // The date shown on the back is when they first found it, not the dupe.
    expect(res.cards[0].firstPulledOn).toBe("2026-07-20");
  });

  it("keeps a retired card in the vault of whoever pulled it", async () => {
    // Deactivating removes a card from future pulls, never from a collection.
    withDb({
      "secret_card_pulls.select": {
        data: [{ secret_card_id: CARD_ID, pulled_on: "2026-07-28", is_duplicate: false }],
      },
      "secret_cards.select": { data: [card(CARD_ID, { active: false })] },
    });
    const { getMySecrets } = await import("./secret-cards.functions");
    const res = await callServerFn<{ cards: unknown[] }>(getMySecrets, { headers: asMe() });
    expect(res.cards).toHaveLength(1);
  });

  it("carries a people count, never a set size", async () => {
    // This test's whole job is to catch a denominator. `ownerCount` is a count of
    // PEOPLE and is allowed; anything that counts CARDS is not, because the size
    // of the set is the one thing the feature withholds.
    withDb({
      "secret_card_pulls.select": [
        { data: [{ secret_card_id: CARD_ID, pulled_on: "2026-07-28", is_duplicate: false }] },
        { data: [{ secret_card_id: CARD_ID }, { secret_card_id: CARD_ID }] },
      ],
      "secret_cards.select": { data: [card(CARD_ID)] },
    });
    const { getMySecrets } = await import("./secret-cards.functions");
    const res = await callServerFn<{ cards: { ownerCount: number }[] }>(getMySecrets, {
      headers: asMe(),
    });
    expect(Object.keys(res).sort()).toEqual(["cards", "pulled"]);
    // Two people, one card in the catalogue: the number on the card must be the
    // people, never the cards.
    expect(res.cards[0].ownerCount).toBe(2);
    expect(JSON.stringify(res)).not.toMatch(/"(total|setSize|of)"/);
  });
});

describe("grantSecretCard", () => {
  it("grants to the participant named in the payload, under an admin token", async () => {
    // Unlike every member-facing handler in this file, the id here IS a payload
    // parameter — the commissioner is acting on somebody else by definition, and
    // requireLeagueAdmin is what makes that safe.
    withDb({ "rpc.grant_secret_card": { data: { duplicate: false } } });
    const { grantSecretCard } = await import("./secret-cards.functions");
    await callServerFn(grantSecretCard, {
      data: { participantId: THEM, cardId: CARD_ID },
      headers: asAdmin(),
    });
    expect(mock.client.rpc).toHaveBeenCalledWith(
      "grant_secret_card",
      expect.objectContaining({ _participant_id: THEM, _secret_card_id: CARD_ID }),
    );
  });

  it("passes the finished set back for the commissioner's toast", async () => {
    // The recipient is somewhere else in the garden holding their own phone, so
    // this value cannot reach them from here — collection_trophies is published
    // to realtime for exactly that reason. This is the admin's confirmation.
    withDb({
      "rpc.grant_secret_card": {
        data: {
          duplicate: false,
          completedCollection: {
            collection: "pets",
            label: "Pets",
            size: 9,
            completedOn: "2026-07-28",
          },
        },
      },
    });
    const { grantSecretCard } = await import("./secret-cards.functions");
    const res = await callServerFn<{ completedCollection: { size: number } | null }>(
      grantSecretCard,
      { data: { participantId: THEM, cardId: CARD_ID }, headers: asAdmin() },
    );
    expect(res.completedCollection).toMatchObject({ collection: "pets", label: "Pets", size: 9 });
  });

  it("reports a duplicate without a trophy", async () => {
    withDb({ "rpc.grant_secret_card": { data: { duplicate: true } } });
    const { grantSecretCard } = await import("./secret-cards.functions");
    const res = await callServerFn<{ duplicate: boolean; completedCollection: unknown }>(
      grantSecretCard,
      { data: { participantId: THEM, cardId: CARD_ID }, headers: asAdmin() },
    );
    expect(res).toMatchObject({ duplicate: true, completedCollection: null });
  });
});

describe("getCollectionTrophies", () => {
  const trophyRow = {
    participant_id: ME,
    collection_id: "pets",
    size_at_completion: 9,
    completed_on: "2026-07-28",
    via: "pull",
  };

  it("answers anybody, because a finished set is public by design", async () => {
    // Unguarded on purpose, the same as getSecretCollections. Other people's
    // trophies on their player page are most of the point, and there is nothing
    // here about a set still being collected.
    withDb({
      "collection_trophies.select": { data: [trophyRow] },
      "secret_collections.select": { data: [{ id: "pets", label: "Pets" }] },
    });
    const { getCollectionTrophies } = await import("./secret-cards.functions");
    const res = await callServerFn<{ trophies: { label: string; size: number }[] }>(
      getCollectionTrophies,
    );
    expect(res.trophies).toEqual([
      {
        participantId: ME,
        collection: "pets",
        label: "Pets",
        size: 9,
        completedOn: "2026-07-28",
        via: "pull",
      },
    ]);
  });

  it("falls back to the id when the set has been hidden or renamed away", async () => {
    // A trophy outlives its set — collection_trophies references
    // secret_collections ON DELETE RESTRICT, but a hidden set is not returned by
    // the label lookup. Rendering the id beats rendering nothing, which is the
    // same fallback secretCollectionLabel makes.
    withDb({
      "collection_trophies.select": { data: [trophyRow] },
      "secret_collections.select": { data: [] },
    });
    const { getCollectionTrophies } = await import("./secret-cards.functions");
    const res = await callServerFn<{ trophies: { label: string }[] }>(getCollectionTrophies);
    expect(res.trophies[0].label).toBe("pets");
  });

  it("looks up no labels at all when nobody has finished anything", async () => {
    // `.in("id", [])` is a query PostgREST will happily run and return everything
    // for; skipping it is cheaper and cannot go wrong.
    withDb({ "collection_trophies.select": { data: [] } });
    const { getCollectionTrophies } = await import("./secret-cards.functions");
    const res = await callServerFn<{ trophies: unknown[] }>(getCollectionTrophies);
    expect(res.trophies).toEqual([]);
    expect(mock.callsFor("secret_collections", "select")).toHaveLength(0);
  });
});

describe("the admin catalogue", () => {
  const ADMIN_FNS = [
    "listSecretCards",
    "createSecretCards",
    "updateSecretCard",
    "uploadSecretCardArt",
    "deleteSecretCard",
    // Added with the trophies. It mints a permanent collection card into somebody
    // else's vault and was the one write in this file with no guard test at all.
    "grantSecretCard",
  ] as const;

  const someInput: Record<string, unknown> = {
    createSecretCards: { cards: [{ name: "Gary" }] },
    updateSecretCard: { id: CARD_ID, name: "Gary" },
    uploadSecretCardArt: { id: CARD_ID, dataUrl: `data:image/webp;base64,${"A".repeat(64)}` },
    deleteSecretCard: { id: CARD_ID },
    grantSecretCard: { participantId: ME, cardId: CARD_ID },
  };

  it.each(ADMIN_FNS)("%s refuses an anonymous caller", async (name) => {
    const mod = await import("./secret-cards.functions");
    await expect(callServerFn(mod[name], { data: someInput[name] })).rejects.toThrow(
      "Admin PIN required",
    );
  });

  it.each(ADMIN_FNS)("%s refuses a member token", async (name) => {
    const mod = await import("./secret-cards.functions");
    await expect(
      callServerFn(mod[name], { data: someInput[name], headers: asMe() }),
    ).rejects.toThrow("Admin PIN required");
  });

  it.each(ADMIN_FNS)("%s refuses a PIN for some other event", async (name) => {
    // The catalogue is league-wide, so authorization pins to the *current*
    // combine — last year's token cannot edit this year's set.
    const mod = await import("./secret-cards.functions");
    await expect(
      callServerFn(mod[name], { data: someInput[name], headers: asAdmin(OTHER_EVENT) }),
    ).rejects.toThrow("Admin PIN required");
  });

  it("refuses out of season with the same message, so the failure is not an oracle", async () => {
    withDb({ "events.select": { data: null } });
    const { listSecretCards } = await import("./secret-cards.functions");
    await expect(callServerFn(listSecretCards, { headers: asAdmin() })).rejects.toThrow(
      "Admin PIN required",
    );
  });

  it("lists the set with owner counts", async () => {
    withDb({
      "secret_cards.select": { data: [card(CARD_ID), card(OTHER_CARD)] },
      "secret_card_pulls.select": {
        data: [
          { secret_card_id: CARD_ID, participant_id: ME },
          { secret_card_id: CARD_ID, participant_id: THEM },
        ],
      },
      "member_codes.select": { data: null, count: 2 },
    });
    const { listSecretCards } = await import("./secret-cards.functions");
    const res = await callServerFn<{
      cards: { id: string; ownerCount: number; foil: string; borderFx: string }[];
      exhausted: boolean;
    }>(listSecretCards, { headers: asAdmin() });
    expect(res.cards.map((c) => [c.id, c.ownerCount])).toEqual([
      [CARD_ID, 2],
      [OTHER_CARD, 0],
    ]);
    // The panel's look pickers seed from these — a missing field would render
    // every select back at its default after a save.
    expect(res.cards[0].foil).toBe("rosette");
    expect(res.cards[0].borderFx).toBe("spin");
    // One card nobody has found, so the set is not exhausted.
    expect(res.exhausted).toBe(false);
  });

  it("reports the set exhausted once everyone who plays owns everything", async () => {
    withDb({
      "secret_cards.select": { data: [card(CARD_ID)] },
      "secret_card_pulls.select": {
        data: [
          { secret_card_id: CARD_ID, participant_id: ME },
          { secret_card_id: CARD_ID, participant_id: THEM },
        ],
      },
      "member_codes.select": { data: null, count: 2 },
    });
    const { listSecretCards } = await import("./secret-cards.functions");
    const res = await callServerFn<{ exhausted: boolean }>(listSecretCards, { headers: asAdmin() });
    expect(res.exhausted).toBe(true);
  });

  it("does not count weight=0 cards toward exhausted", async () => {
    // weight 0 takes a card out of the daily draw, so nobody can ever find it.
    // Counting it would keep the set reading as not exhausted forever.
    withDb({
      "secret_cards.select": { data: [card(CARD_ID), card(OTHER_CARD, { weight: 0 })] },
      "secret_card_pulls.select": {
        data: [
          { secret_card_id: CARD_ID, participant_id: ME },
          { secret_card_id: CARD_ID, participant_id: THEM },
          { secret_card_id: OTHER_CARD, participant_id: ME },
        ],
      },
      "member_codes.select": { data: null, count: 2 },
    });
    const { listSecretCards } = await import("./secret-cards.functions");
    const res = await callServerFn<{ exhausted: boolean }>(listSecretCards, { headers: asAdmin() });
    expect(res.exhausted).toBe(true);
  });

  it("does not let guest pulls declare the set exhausted early", async () => {
    // `exhausted` is measured against the claimed-member count, so it has to be
    // counted in members. Two guests holding a card would otherwise clear the bar
    // for two members while both members still had it to find, and the panel
    // would tell the admin the drop had gone quiet while it had not.
    withDb({
      "secret_cards.select": { data: [card(CARD_ID)] },
      "secret_card_pulls.select": {
        data: [
          { secret_card_id: CARD_ID, participant_id: ME },
          { secret_card_id: CARD_ID, participant_id: null },
          { secret_card_id: CARD_ID, participant_id: null },
        ],
      },
      "member_codes.select": { data: null, count: 2 },
    });
    const { listSecretCards } = await import("./secret-cards.functions");
    const res = await callServerFn<{
      cards: { ownerCount: number }[];
      exhausted: boolean;
    }>(listSecretCards, { headers: asAdmin() });
    // Three people hold it, and the admin sees that…
    expect(res.cards[0].ownerCount).toBe(3);
    // …but only one of the two members does.
    expect(res.exhausted).toBe(false);
  });

  it("creates a card without art rather than failing, and leaves it unpullable", async () => {
    // pull_secret_card skips a row with no art_path, so a half-made card cannot
    // burn somebody's once-a-day pull on a blank.
    withDb({ "secret_cards.insert": { data: { id: CARD_ID } } });
    const { createSecretCards } = await import("./secret-cards.functions");
    const res = await callServerFn<{ results: { hasArt: boolean }[] }>(createSecretCards, {
      data: { cards: [{ name: "Gary the Grill" }] },
      headers: asAdmin(),
    });
    expect(res.results[0].hasArt).toBe(false);
    const [insert] = mock.callsFor("secret_cards", "insert");
    expect(insert.payload).toEqual({
      name: "Gary the Grill",
      flavour: null,
      collection: null,
    });
  });

  it("never stamps an event onto a catalogue row", async () => {
    // The set is league-wide. An event_id here would quietly make it per-combine.
    withDb({ "secret_cards.insert": { data: { id: CARD_ID } } });
    const { createSecretCards } = await import("./secret-cards.functions");
    await callServerFn(createSecretCards, {
      data: { cards: [{ name: "Gary the Grill" }] },
      headers: asAdmin(),
    });
    const [insert] = mock.callsFor("secret_cards", "insert");
    expect(insert.payload).not.toHaveProperty("event_id");
  });

  it("uploads art to a path that gives nothing away", async () => {
    withDb({
      "secret_cards.select": { data: { art_path: null } },
      "storage.createSignedUrl": { data: { signedUrl: "https://signed/art" } },
    });
    const { uploadSecretCardArt } = await import("./secret-cards.functions");
    await callServerFn(uploadSecretCardArt, {
      data: { id: CARD_ID, dataUrl: `data:image/webp;base64,${btoa("hello world!!")}` },
      headers: asAdmin(),
    });
    const [path] = mock.storageBucket.upload.mock.calls[0];
    // The card's name never appears in the path: a signed URL carries its path in
    // plaintext, so a filename would hand over the joke and hint at the set size.
    expect(path).toMatch(new RegExp(`^secrets/${CARD_ID}/art-\\d+\\.webp$`));
    expect(path).not.toContain("gary");
  });

  it("only bins the old art after the row points at the new file", async () => {
    withDb({
      "secret_cards.select": { data: { art_path: "secrets/x/art-old.webp" } },
      "storage.createSignedUrl": { data: { signedUrl: "https://signed/art" } },
    });
    const { uploadSecretCardArt } = await import("./secret-cards.functions");
    await callServerFn(uploadSecretCardArt, {
      data: { id: CARD_ID, dataUrl: `data:image/webp;base64,${btoa("hello world!!")}` },
      headers: asAdmin(),
    });
    expect(mock.callsFor("secret_cards", "update")).toHaveLength(1);
    expect(mock.storageBucket.remove).toHaveBeenCalledWith(["secrets/x/art-old.webp"]);
    // Ordering is the point: the update is recorded before the remove happens.
    const removeOrder = mock.storageBucket.remove.mock.invocationCallOrder[0];
    const uploadOrder = mock.storageBucket.upload.mock.invocationCallOrder[0];
    expect(uploadOrder).toBeLessThan(removeOrder);
  });

  it.each(["image/svg+xml", "image/gif", "application/pdf"])("rejects %s", async (mime) => {
    const { uploadSecretCardArt } = await import("./secret-cards.functions");
    await expect(
      callServerFn(uploadSecretCardArt, {
        data: { id: CARD_ID, dataUrl: `data:${mime};base64,${"A".repeat(64)}` },
        headers: asAdmin(),
      }),
    ).rejects.toThrow("Unsupported image format");
  });

  it("cannot be tricked into setting the id through the update patch", async () => {
    withDb({ "secret_cards.update": { data: { id: CARD_ID } } });
    const { updateSecretCard } = await import("./secret-cards.functions");
    await callServerFn(updateSecretCard, {
      data: { id: CARD_ID, name: "Renamed", active: false, art_path: "secrets/evil.webp" },
      headers: asAdmin(),
    });
    const [update] = mock.callsFor("secret_cards", "update");
    // The alien key vanished: the patch is a literal, not a spread of the input.
    expect(update.payload).toEqual({ name: "Renamed", active: false });
  });

  it("saves an admin-picked look, in the column casing the table uses", async () => {
    withDb({ "secret_cards.update": { data: { id: CARD_ID } } });
    const { updateSecretCard } = await import("./secret-cards.functions");
    await callServerFn(updateSecretCard, {
      data: { id: CARD_ID, foil: "aurora", borderFx: "pulse" },
      headers: asAdmin(),
    });
    const [update] = mock.callsFor("secret_cards", "update");
    // Pins the camelCase→snake_case mapping: a payload of `borderFx` would be a
    // column Postgres has never heard of.
    expect(update.payload).toEqual({ foil: "aurora", border_fx: "pulse" });
  });

  it.each([
    ["foil", { foil: "nope" }],
    ["border animation", { borderFx: "wobble" }],
  ])("rejects an unknown %s instead of writing it", async (_what, look) => {
    // The columns carry no CHECK, so the validator is the entire enforcement
    // layer between a request and a string secretFoil would silently swallow.
    withDb({ "secret_cards.update": { data: { id: CARD_ID } } });
    const { updateSecretCard } = await import("./secret-cards.functions");
    await expect(
      callServerFn(updateSecretCard, { data: { id: CARD_ID, ...look }, headers: asAdmin() }),
    ).rejects.toThrow();
    expect(mock.callsFor("secret_cards", "update")).toHaveLength(0);
  });

  it("reports a missing card instead of succeeding against zero rows", async () => {
    withDb({ "secret_cards.update": { data: null } });
    const { updateSecretCard } = await import("./secret-cards.functions");
    const res = await callServerFn<{ ok: boolean; reason?: string }>(updateSecretCard, {
      data: { id: CARD_ID, name: "Renamed" },
      headers: asAdmin(),
    });
    expect(res).toEqual({ ok: false, reason: "not_found" });
  });

  it("deactivates rather than deletes a card somebody has already pulled", async () => {
    withDb({ "secret_card_pulls.select": { data: null, count: 3 } });
    const { deleteSecretCard } = await import("./secret-cards.functions");
    const res = await callServerFn<{ ok: boolean; deactivated?: boolean }>(deleteSecretCard, {
      data: { id: CARD_ID },
      headers: asAdmin(),
    });
    expect(res).toMatchObject({ ok: false, reason: "has_pulls", deactivated: true });
    expect(mock.callsFor("secret_cards", "delete")).toHaveLength(0);
    expect(mock.callsFor("secret_cards", "update")[0].payload).toEqual({ active: false });
  });

  it("deletes a card nobody has found, and its bytes with it", async () => {
    withDb({
      "secret_card_pulls.select": { data: null, count: 0 },
      "secret_cards.select": { data: { art_path: "secrets/x/art-1.webp" } },
    });
    const { deleteSecretCard } = await import("./secret-cards.functions");
    const res = await callServerFn<{ ok: boolean }>(deleteSecretCard, {
      data: { id: CARD_ID },
      headers: asAdmin(),
    });
    expect(res).toEqual({ ok: true });
    expect(mock.callsFor("secret_cards", "delete")).toHaveLength(1);
    expect(mock.storageBucket.remove).toHaveBeenCalledWith(["secrets/x/art-1.webp"]);
  });
});
