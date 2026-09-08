// Guards and leaks on the pack handlers.
//
// The database suite proves one pack per league day and that the deal draws
// from roster and secrets alike. What is checked here is everything above it:
// that the identity comes from the token and never from a payload, that the
// only secret rows ever looked up are the ones the RPC dealt, that a finish is
// passed through the vocabulary rather than trusted, and that the response has
// no denominator in it anywhere.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseResponses } from "@/test/supabase-mock";
import { adminHeaders, callServerFn, guestHeaders, memberHeaders } from "@/test/server-fn";
import { signAdminToken, signGuestToken, signMemberToken } from "./session.server";
import type { OpenPackResponse, PackStatus } from "./pack";

let mock = createSupabaseMock();

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return mock.client;
  },
}));

const EVENT_ID = "00000000-0000-4000-8000-0000000000ff";
const ME = "00000000-0000-4000-8000-0000000000aa";
const THEM = "00000000-0000-4000-8000-0000000000bb";
const GUEST = "00000000-0000-4000-8000-0000000000e1";
const EP_A = "00000000-0000-4000-8000-00000000ca01";
const EP_B = "00000000-0000-4000-8000-00000000ca02";
const CARD_ID = "00000000-0000-4000-8000-00000000ce01";
const OTHER_CARD = "00000000-0000-4000-8000-00000000ce02";

const activeEvent = { "events.select": { data: { id: EVENT_ID } } };

function withDb(responses: SupabaseResponses = {}) {
  mock = createSupabaseMock({ ...activeEvent, ...responses });
}

const asMe = () => memberHeaders(signMemberToken(ME).token);
const asGuest = (id = GUEST) => guestHeaders(signGuestToken(id).token);
const asAdmin = () => adminHeaders(signAdminToken(EVENT_ID).token);

const card = (id = CARD_ID, over: Record<string, unknown> = {}) => ({
  id,
  name: "Gary the Grill",
  flavour: "Lit at 11am. Still going at 11pm.",
  foil: "rosette",
  border_fx: "spin",
  collection: null,
  weight: 100,
  art_path: `secrets/${id}/art-1.webp`,
  back_path: null,
  active: true,
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
  ...over,
});

const roster = (id: string, over: Record<string, unknown> = {}) => ({
  kind: "roster",
  id,
  edition: "standard",
  heldBefore: 0,
  editionBefore: null,
  ...over,
});
const secret = (id = CARD_ID, over: Record<string, unknown> = {}) => ({
  kind: "secret",
  id,
  pullId: "p1",
  tier: "rare",
  duplicate: false,
  tierBefore: null,
  completedCollection: null,
  ...over,
});
const dealt = (cards: unknown[], over: Record<string, unknown> = {}) => ({
  data: { day: "2026-09-08", fresh: true, packsOpened: 1, cards, ...over },
});

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
  withDb();
});

describe("openPack", () => {
  it("requires an identity of some kind", async () => {
    // No member token and no guest token: a device that has never been through
    // the pack screen has nothing to deal a pack to.
    const { openPack } = await import("./pack.functions");
    await expect(callServerFn(openPack)).rejects.toThrow("Claim your player first");
    expect(mock.client.rpc).not.toHaveBeenCalled();
  });

  it("is not satisfied by an admin token", async () => {
    const { openPack } = await import("./pack.functions");
    await expect(callServerFn(openPack, { headers: asAdmin() })).rejects.toThrow(
      "Claim your player first",
    );
  });

  it("deals for the token holder, never for a caller-supplied id", async () => {
    withDb({ "rpc.open_pack": dealt([roster(EP_A), roster(EP_B)]) });
    const { openPack } = await import("./pack.functions");
    // The handler takes no input at all, so there is nothing to smuggle — this
    // asserts the arg the RPC actually received.
    await callServerFn(openPack, { data: { participantId: THEM }, headers: asMe() });
    expect(mock.client.rpc).toHaveBeenCalledWith("open_pack", {
      _participant_id: ME,
      _guest_id: null,
      _event_id: EVENT_ID,
    });
  });

  it("deals for a guest against their guest id", async () => {
    withDb({ "rpc.open_pack": dealt([{ kind: "roster", id: EP_A }]) });
    const { openPack } = await import("./pack.functions");
    const res = await callServerFn<OpenPackResponse>(openPack, { headers: asGuest() });
    expect(mock.client.rpc).toHaveBeenCalledWith(
      "open_pack",
      expect.objectContaining({ _participant_id: null, _guest_id: GUEST }),
    );
    // A guest's roster slot has no finish and no history: nothing was minted.
    expect(res).toMatchObject({
      ok: true,
      cards: [{ kind: "roster", id: EP_A, edition: null, heldBefore: null, editionBefore: null }],
    });
  });

  it("deals out of season, with no event behind the pack", async () => {
    withDb({ "events.select": { data: null }, "rpc.open_pack": dealt([secret()]), "secret_cards.select": { data: [card()] } }); // prettier-ignore
    const { openPack } = await import("./pack.functions");
    await callServerFn(openPack, { headers: asMe() });
    expect(mock.client.rpc).toHaveBeenCalledWith(
      "open_pack",
      expect.objectContaining({ _event_id: null }),
    );
  });

  it("soft-fails when there is nothing to deal, without a round trip for cards", async () => {
    withDb({ "rpc.open_pack": { data: null } });
    const { openPack } = await import("./pack.functions");
    const res = await callServerFn<OpenPackResponse>(openPack, { headers: asMe() });
    expect(res).toEqual({ ok: false, reason: "unavailable" });
    expect(mock.callsFor("secret_cards")).toEqual([]);
  });

  it("passes a roster finish through the vocabulary rather than trusting it", async () => {
    withDb({
      "rpc.open_pack": dealt([
        roster(EP_A, { edition: "gold", heldBefore: 2, editionBefore: "from-the-future" }),
        roster(EP_B, { edition: "from-the-future" }),
      ]),
    });
    const { openPack } = await import("./pack.functions");
    const res = await callServerFn<OpenPackResponse>(openPack, { headers: asMe() });
    expect(res).toMatchObject({
      cards: [
        { id: EP_A, edition: "gold", heldBefore: 2, editionBefore: "standard" },
        { id: EP_B, edition: "standard" },
      ],
    });
  });

  it("keeps a missing finish null rather than calling it standard", async () => {
    // Null means the mint was rationed. The reveal must not celebrate, or price,
    // a finish nobody decided — which it would if this defaulted the way
    // toEdition does.
    withDb({ "rpc.open_pack": dealt([roster(EP_A, { edition: null })]) });
    const { openPack } = await import("./pack.functions");
    const res = await callServerFn<OpenPackResponse>(openPack, { headers: asMe() });
    expect(res).toMatchObject({ cards: [{ id: EP_A, edition: null }] });
  });

  it("signs art only for the secrets the RPC dealt", async () => {
    withDb({
      "rpc.open_pack": dealt([roster(EP_A), secret(CARD_ID), secret(OTHER_CARD, { pullId: "p2" })]),
      "secret_cards.select": { data: [card(CARD_ID), card(OTHER_CARD)] },
      "storage.createSignedUrl": { data: { signedUrl: "https://signed/art" } },
    });
    const { openPack } = await import("./pack.functions");
    const res = await callServerFn<OpenPackResponse>(openPack, { headers: asMe() });
    const [lookup] = mock.callsFor("secret_cards");
    // The lookup is constrained to exactly the dealt ids — never the catalogue.
    expect(lookup.filters).toContainEqual({ method: "in", args: ["id", [CARD_ID, OTHER_CARD]] });
    expect(res).toMatchObject({
      ok: true,
      cards: [
        { kind: "roster", id: EP_A },
        { kind: "secret", id: CARD_ID, card: { id: CARD_ID, artUrl: "https://signed/art", tier: "rare" } }, // prettier-ignore
        { kind: "secret", id: OTHER_CARD },
      ],
    });
  });

  it("carries a secret's duplicate flag, the level it beat, and the set it finished", async () => {
    // The set size is the designed exception to the silence rule and the only
    // number in this response that ever describes the catalogue. It arrives
    // untouched from the slot rather than being recomputed here.
    const finished = { collection: "pets", label: "Pets", size: 9, completedOn: "2026-09-08" };
    withDb({
      "rpc.open_pack": dealt([
        secret(CARD_ID, { duplicate: true, tierBefore: "common", tier: "epic" }),
        secret(OTHER_CARD, { pullId: "p2", completedCollection: finished }),
      ]),
      "secret_cards.select": { data: [card(CARD_ID), card(OTHER_CARD)] },
    });
    const { openPack } = await import("./pack.functions");
    const res = await callServerFn<OpenPackResponse>(openPack, { headers: asMe() });
    expect(res).toMatchObject({
      cards: [
        { id: CARD_ID, duplicate: true, tierBefore: "common", card: { tier: "epic" }, completedCollection: null }, // prettier-ignore
        { id: OTHER_CARD, duplicate: false, tierBefore: null, completedCollection: finished },
      ],
    });
  });

  it("says null, not undefined, on every slot that finished nothing", async () => {
    withDb({
      "rpc.open_pack": dealt([{ ...secret(), completedCollection: undefined }]),
      "secret_cards.select": { data: [card()] },
    });
    const { openPack } = await import("./pack.functions");
    const res = await callServerFn<OpenPackResponse>(openPack, { headers: asMe() });
    if (!res.ok || res.cards[0].kind !== "secret") throw new Error("expected a secret slot");
    expect(res.cards[0].completedCollection).toBeNull();
  });

  it("drops a secret whose catalogue row has gone rather than failing the pack", async () => {
    withDb({
      "rpc.open_pack": dealt([roster(EP_A), secret(CARD_ID)]),
      "secret_cards.select": { data: [] },
    });
    const { openPack } = await import("./pack.functions");
    const res = await callServerFn<OpenPackResponse>(openPack, { headers: asMe() });
    expect(res).toMatchObject({ ok: true, cards: [{ kind: "roster", id: EP_A }] });
  });

  it("passes the day, freshness and running total straight through", async () => {
    withDb({ "rpc.open_pack": dealt([roster(EP_A)], { fresh: false, packsOpened: 12 }) });
    const { openPack } = await import("./pack.functions");
    const res = await callServerFn<OpenPackResponse>(openPack, { headers: asMe() });
    expect(res).toMatchObject({ ok: true, day: "2026-09-08", fresh: false, packsOpened: 12 });
    // Exactly these keys — nothing that could carry a catalogue size.
    expect(Object.keys(res).sort()).toEqual(["cards", "day", "fresh", "ok", "packsOpened"]);
  });

  it("rethrows a database error rather than dealing an empty pack", async () => {
    withDb({ "rpc.open_pack": { error: { message: "boom" } } });
    const { openPack } = await import("./pack.functions");
    await expect(callServerFn(openPack, { headers: asMe() })).rejects.toThrow("boom");
  });
});

describe("getPackStatus", () => {
  it("tells a visitor with no identity at all nothing, and does not throw at them", async () => {
    const { getPackStatus } = await import("./pack.functions");
    const res = await callServerFn<PackStatus>(getPackStatus);
    expect(res).toEqual({
      claimed: false,
      day: null,
      openedToday: false,
      secretsOwned: 0,
      resetsAt: null,
    });
    // Not even a round trip: nothing to ask about.
    expect(mock.client.rpc).not.toHaveBeenCalled();
  });

  it("asks about the token holder", async () => {
    withDb({
      "rpc.pack_status": {
        data: { day: "2026-09-08", openedToday: true, secretsOwned: 2, resetsAt: "2026-09-09T04:00:00Z" }, // prettier-ignore
      },
    });
    const { getPackStatus } = await import("./pack.functions");
    const res = await callServerFn<PackStatus>(getPackStatus, { headers: asMe() });
    expect(mock.client.rpc).toHaveBeenCalledWith("pack_status", {
      _participant_id: ME,
      _guest_id: null,
    });
    expect(res).toEqual({
      claimed: true,
      day: "2026-09-08",
      openedToday: true,
      secretsOwned: 2,
      resetsAt: "2026-09-09T04:00:00Z",
    });
  });

  it("asks about a guest by their guest id", async () => {
    withDb({ "rpc.pack_status": { data: { day: "2026-09-08", openedToday: false, secretsOwned: 0, resetsAt: "x" } } }); // prettier-ignore
    const { getPackStatus } = await import("./pack.functions");
    await callServerFn(getPackStatus, { headers: asGuest() });
    expect(mock.client.rpc).toHaveBeenCalledWith("pack_status", {
      _participant_id: null,
      _guest_id: GUEST,
    });
  });
});
