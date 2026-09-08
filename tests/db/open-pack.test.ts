// The pack, dealt by Postgres.
//
// Three properties live here and nowhere else. A stranger holding the
// publishable key cannot deal a pack. One identity gets exactly one pack per
// league day however many times and from however many phones it asks, and asks
// after the first read the same three cards back. And the deal draws from ONE
// pool — every roster card and every active secret — so a secret is simply a
// card that can be in the pack, owned or not.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, isDenied, IDS, newClient, seedEvent, sql } from "./helpers";

afterAll(closeDb);
beforeEach(seedEvent);

const GUEST_A = "00000000-0000-4000-8000-0000000000e1";
const GUEST_B = "00000000-0000-4000-8000-0000000000e2";

type RosterSlot = {
  kind: "roster";
  id: string;
  edition?: string | null;
  heldBefore?: number;
  editionBefore?: string | null;
};
type SecretSlot = {
  kind: "secret";
  id: string;
  pullId: string;
  tier: string;
  duplicate: boolean;
  tierBefore: string | null;
  completedCollection: { collection: string; label: string; size: number } | null;
};
type Slot = RosterSlot | SecretSlot;
type Pack = { day: string; fresh: boolean; packsOpened: number; cards: Slot[] } | null;

async function addCard(
  name: string,
  over: { active?: boolean; artPath?: string | null; weight?: number; collection?: string } = {},
) {
  const [row] = await sql<{ id: string }>(
    `INSERT INTO public.secret_cards (name, art_path, active, weight, collection)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [name, over.artPath === undefined ? `secrets/${name}/art-1.webp` : over.artPath, over.active ?? true, over.weight ?? 100, over.collection ?? null], // prettier-ignore
  );
  return row.id;
}

async function open(participantId = IDS.alice, eventId: string | null = IDS.event): Promise<Pack> {
  const [row] = await sql<{ open_pack: Pack }>("SELECT public.open_pack($1, null, $2)", [
    participantId,
    eventId,
  ]);
  return row.open_pack;
}

async function openAsGuest(guestId = GUEST_A, eventId: string | null = IDS.event): Promise<Pack> {
  const [row] = await sql<{ open_pack: Pack }>("SELECT public.open_pack(null, $1, $2)", [
    guestId,
    eventId,
  ]);
  return row.open_pack;
}

async function status(participantId: string | null = IDS.alice, guestId: string | null = null) {
  const [row] = await sql<{
    pack_status: { day: string; openedToday: boolean; secretsOwned: number; resetsAt: string };
  }>("SELECT public.pack_status($1, $2)", [participantId, guestId]);
  return row.pack_status;
}

const secrets = (p: Pack) => (p?.cards ?? []).filter((c): c is SecretSlot => c.kind === "secret");
const roster = (p: Pack) => (p?.cards ?? []).filter((c): c is RosterSlot => c.kind === "roster");

const rosterIds = async () =>
  (await sql<{ id: string }>("SELECT id FROM public.event_participants ORDER BY running_order")).map(
    (r) => r.id,
  );

const packRows = async () =>
  sql<{ participant_id: string | null; guest_id: string | null; opened_on: string; cards: Slot[] | null }>( // prettier-ignore
    "SELECT participant_id, guest_id, opened_on, cards FROM public.pack_opens ORDER BY opened_on",
  );

const secretRows = async () =>
  sql<{ participant_id: string | null; guest_id: string | null; secret_card_id: string; is_duplicate: boolean; granted: boolean; tier: string }>( // prettier-ignore
    "SELECT participant_id, guest_id, secret_card_id, is_duplicate, granted, tier FROM public.secret_card_pulls ORDER BY created_at",
  );

const copyRows = async () =>
  sql<{ participant_id: string; event_participant_id: string; edition: string; source: string; edition_asserted_by: string | null }>( // prettier-ignore
    "SELECT participant_id, event_participant_id, edition, source, edition_asserted_by FROM public.card_copies ORDER BY created_at",
  );

/** Move everything dealt today back a day, so the next deal is a new pack. */
async function rewindDay() {
  await sql("UPDATE public.pack_opens SET opened_on = opened_on - 1");
  await sql("UPDATE public.secret_card_pulls SET pulled_on = pulled_on - 1");
  await sql("UPDATE public.card_mints SET minted_on = minted_on - 1");
  await sql("UPDATE public.card_copies SET acquired_on = acquired_on - 1 WHERE acquired_on IS NOT NULL"); // prettier-ignore
}

describe("the RPCs are unreachable with the publishable key", () => {
  it.each(["anon", "authenticated"] as const)("%s cannot execute open_pack", async (role) => {
    expect(await isDenied(role, "SELECT public.open_pack($1, null, null)", [IDS.alice])).toBe(true);
  });

  it.each(["anon", "authenticated"] as const)("%s cannot execute pack_status", async (role) => {
    expect(await isDenied(role, "SELECT public.pack_status($1, null)", [IDS.alice])).toBe(true);
  });
});

describe("open_pack deals from one pool", () => {
  it("deals exactly three distinct cards", async () => {
    await addCard("Gary the Grill");
    await addCard("The Gazebo");
    await addCard("The Dog");
    const pack = await open();
    expect(pack?.fresh).toBe(true);
    expect(pack?.cards).toHaveLength(3);
    expect(new Set(pack!.cards.map((c) => c.id)).size).toBe(3);
    for (const c of pack!.cards) expect(["roster", "secret"]).toContain(c.kind);
  });

  it("can be all roster, all secrets, or anything between — the hat decides", async () => {
    // The roster alone fills a pack: three players, three slots.
    const rosterOnly = await open();
    expect(roster(rosterOnly)).toHaveLength(3);
    expect((await rosterIds()).sort()).toEqual(roster(rosterOnly).map((c) => c.id).sort());

    // And with no event at all the pool is the secrets, so every slot is one.
    await rewindDay();
    await addCard("Gary the Grill");
    await addCard("The Gazebo");
    await addCard("The Dog");
    const secretsOnly = await open(IDS.alice, null);
    expect(secrets(secretsOnly)).toHaveLength(3);
  });

  it("puts a secret in the pack as an ordinary slot, in dealt order", async () => {
    // Weight is what tunes a secret against the roster's 100. A card weighted so
    // heavily it cannot lose the draw lands in every pack.
    const heavy = await addCard("Gary the Grill", { weight: 10000 });
    const pack = await open();
    const slot = pack!.cards.find((c) => c.id === heavy);
    expect(slot).toMatchObject({ kind: "secret", duplicate: false, tierBefore: null });
    expect((slot as SecretSlot).pullId).toBeTruthy();
  });

  it("skips a retired card, one without art, and one weighted to zero", async () => {
    await addCard("Retired", { active: false, weight: 10000 });
    await addCard("Half-made", { artPath: null, weight: 10000 });
    await addCard("Benched", { weight: 0 });
    const pack = await open();
    expect(secrets(pack)).toHaveLength(0);
  });

  it("deals nothing and spends nothing when the pool is empty", async () => {
    expect(await open(IDS.alice, null)).toBeNull();
    expect(await packRows()).toHaveLength(0);
    expect((await status()).openedToday).toBe(false);
    // …and the moment there is something to deal, the day is still theirs.
    await addCard("Gary the Grill");
    expect((await open(IDS.alice, null))?.fresh).toBe(true);
  });

  it("refuses a call with neither a participant nor a guest, and one with both", async () => {
    await expect(sql("SELECT public.open_pack(null, null, null)")).rejects.toThrow();
    await expect(
      sql("SELECT public.open_pack($1, $2, null)", [IDS.alice, GUEST_A]),
    ).rejects.toThrow();
  });

  it("refuses a participant who does not exist", async () => {
    await expect(open("00000000-0000-4000-8000-0000000000ee")).rejects.toThrow();
  });
});

describe("one pack per league day", () => {
  it("answers a second call the same day with the same three cards and fresh: false", async () => {
    await addCard("Gary the Grill", { weight: 10000 });
    const first = await open();
    const second = await open();
    expect(second?.fresh).toBe(false);
    expect(second?.cards).toEqual(first?.cards);
    expect(await packRows()).toHaveLength(1);
    expect(await secretRows()).toHaveLength(1);
    expect(await copyRows()).toHaveLength(2);
  });

  it("deals a new pack tomorrow", async () => {
    await open();
    await rewindDay();
    const today = await open();
    expect(today?.fresh).toBe(true);
    expect(today?.packsOpened).toBe(2);
    expect(await packRows()).toHaveLength(2);
  });

  it("leaves exactly one pack when two connections race for one member", async () => {
    await addCard("Gary the Grill");
    const [a, b] = [await newClient(), await newClient()];
    try {
      const results = await Promise.all([
        a.query("SELECT public.open_pack($1, null, $2)", [IDS.alice, IDS.event]),
        b.query("SELECT public.open_pack($1, null, $2)", [IDS.alice, IDS.event]),
      ]);
      // The loser of the race gets a pack, not an error — and the same pack.
      const packs = results.map((r) => r.rows[0].open_pack as Pack);
      expect(packs[0]?.cards).toEqual(packs[1]?.cards);
      expect(await packRows()).toHaveLength(1);
    } finally {
      await Promise.all([a.end(), b.end()]);
    }
  });

  it("leaves exactly one pack when two connections race for one guest", async () => {
    // A guest has no participant row to lock; the advisory lock carries this.
    await addCard("Gary the Grill");
    const [a, b] = [await newClient(), await newClient()];
    try {
      const results = await Promise.all([
        a.query("SELECT public.open_pack(null, $1, $2)", [GUEST_A, IDS.event]),
        b.query("SELECT public.open_pack(null, $1, $2)", [GUEST_A, IDS.event]),
      ]);
      const packs = results.map((r) => r.rows[0].open_pack as Pack);
      expect(packs[0]?.cards).toEqual(packs[1]?.cards);
      expect(await packRows()).toHaveLength(1);
    } finally {
      await Promise.all([a.end(), b.end()]);
    }
  });

  it("keeps two people, and a guest, apart on the same day", async () => {
    await open(IDS.alice);
    await open(IDS.bob);
    await openAsGuest(GUEST_A);
    expect(await packRows()).toHaveLength(3);
  });

  it("deals into a row the old client recorded today without its cards", async () => {
    // Deploy day: record_pack_open wrote the row, nothing wrote the slots. The
    // member gets a pack rather than an empty screen, and still only one row.
    await sql("SELECT public.record_pack_open($1, $2, 3, null)", [IDS.alice, IDS.event]);
    const pack = await open();
    expect(pack?.fresh).toBe(true);
    expect(pack?.cards).toHaveLength(3);
    const rows = await packRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].cards).toEqual(pack?.cards);
  });

  it("counts the pack once for the streak and the stats", async () => {
    const pack = await open();
    expect(pack?.packsOpened).toBe(1);
    expect((await open())?.packsOpened).toBe(1);
    const [row] = await sql<{ card_count: number }>("SELECT card_count FROM public.pack_opens");
    expect(row.card_count).toBe(3);
  });
});

describe("roster slots", () => {
  it("mints a member's copies through the same path the old pack used", async () => {
    const pack = await open();
    const ids = roster(pack).map((c) => c.id);
    const copies = await copyRows();
    expect(copies.map((c) => c.event_participant_id).sort()).toEqual([...ids].sort());
    for (const c of copies) expect(c).toMatchObject({ source: "pull", edition_asserted_by: "server" });
    const mints = await sql<{ n: number }>("SELECT count(*)::int AS n FROM public.card_mints");
    expect(mints[0].n).toBe(3);
    const pulls = await sql<{ pull_count: number }>("SELECT pull_count FROM public.card_pulls");
    expect(pulls.map((p) => p.pull_count)).toEqual([1, 1, 1]);
  });

  it("stamps each slot with the finish Postgres derived, not one it rolled", async () => {
    const pack = await open();
    const [{ day }] = await sql<{ day: string }>(
      "SELECT (now() AT TIME ZONE 'America/New_York')::date::text AS day",
    );
    for (const slot of roster(pack)) {
      const [row] = await sql<{ e: string }>("SELECT public.roll_card_edition($1, $2, $3::date) AS e", [
        IDS.alice,
        slot.id,
        day,
      ]);
      expect(slot.edition).toBe(row.e);
    }
  });

  it("says a first copy was held zero times before, and a second once", async () => {
    const first = await open();
    for (const slot of roster(first)) expect(slot).toMatchObject({ heldBefore: 0, editionBefore: null });
    await rewindDay();
    const second = await open();
    for (const slot of roster(second)) {
      expect(slot.heldBefore).toBe(1);
      expect(slot.editionBefore).toBe(roster(first).find((c) => c.id === slot.id)?.edition);
    }
  });

  it("reports the best copy held before, not the copy just minted", async () => {
    // A platinum handed over earlier is what today's standard has to beat.
    const [ep] = await rosterIds();
    await sql("SELECT public.grant_card_copy_once($1, $2, $3, $4)", ["k-1", IDS.alice, ep, "platinum"]);
    const pack = await open();
    const slot = roster(pack).find((c) => c.id === ep)!;
    expect(slot).toMatchObject({ heldBefore: 1, editionBefore: "platinum" });
  });

  it("mints nothing for a guest, whose collection lives on the phone until they claim", async () => {
    const pack = await openAsGuest();
    expect(roster(pack)).toHaveLength(3);
    for (const slot of roster(pack)) expect(Object.keys(slot).sort()).toEqual(["id", "kind"]);
    expect(await copyRows()).toHaveLength(0);
    expect(await sql("SELECT 1 FROM public.card_pulls")).toHaveLength(0);
  });
});

describe("secret slots", () => {
  it("writes the ledger row for a member, un-granted, at a rolled level", async () => {
    const id = await addCard("Gary the Grill", { weight: 10000 });
    const pack = await open();
    const [slot] = secrets(pack);
    expect(slot).toMatchObject({ id, duplicate: false, tierBefore: null });
    const rows = await secretRows();
    expect(rows).toEqual([
      { participant_id: IDS.alice, guest_id: null, secret_card_id: id, is_duplicate: false, granted: false, tier: slot.tier }, // prettier-ignore
    ]);
    expect(["mythic", "legendary", "epic", "rare", "common"]).toContain(slot.tier);
  });

  it("writes a guest's row against their guest id", async () => {
    const id = await addCard("Gary the Grill", { weight: 10000 });
    const pack = await openAsGuest();
    expect(secrets(pack)).toHaveLength(1);
    expect(await secretRows()).toMatchObject([
      { participant_id: null, guest_id: GUEST_A, secret_card_id: id, is_duplicate: false },
    ]);
  });

  it("can put three secrets in one day's pack, which the old one-a-day rule refused", async () => {
    await addCard("Gary the Grill");
    await addCard("The Gazebo");
    await addCard("The Dog");
    const pack = await open(IDS.alice, null);
    expect(secrets(pack)).toHaveLength(3);
    expect(await secretRows()).toHaveLength(3);
    expect((await status()).secretsOwned).toBe(3);
  });

  it("hands a card you own back as a duplicate, without a second ownership row", async () => {
    const id = await addCard("Gary the Grill");
    const first = await open(IDS.alice, null);
    await rewindDay();
    const second = await open(IDS.alice, null);
    const dupe = secrets(second)[0];
    expect(dupe).toMatchObject({ id, duplicate: true, tierBefore: secrets(first)[0].tier });
    expect((await secretRows()).map((r) => r.is_duplicate)).toEqual([false, true]);
    expect((await status()).secretsOwned).toBe(1);
  });

  it("upgrades the copy you own when the duplicate rolls better, and never downgrades it", async () => {
    const id = await addCard("Gary the Grill");
    await open(IDS.alice, null);
    await sql("UPDATE public.secret_card_pulls SET tier = 'common'");
    await rewindDay();
    const second = await open(IDS.alice, null);
    const rolled = secrets(second)[0].tier;
    const [owning] = await sql<{ tier: string }>(
      "SELECT tier FROM public.secret_card_pulls WHERE secret_card_id = $1 AND NOT is_duplicate",
      [id],
    );
    // Whatever was rolled, the owning row is now the better of the two.
    expect(owning.tier).toBe(rolled === "common" ? "common" : rolled);

    // And a worse roll leaves a better copy alone.
    await sql("UPDATE public.secret_card_pulls SET tier = 'mythic' WHERE NOT is_duplicate");
    await rewindDay();
    await open(IDS.alice, null);
    const [still] = await sql<{ tier: string }>(
      "SELECT tier FROM public.secret_card_pulls WHERE secret_card_id = $1 AND NOT is_duplicate",
      [id],
    );
    expect(still.tier).toBe("mythic");
  });

  it("hands the set size back on the slot that finishes it, once, and again on the replay", async () => {
    await sql(
      "INSERT INTO public.secret_collections (id, label, sort_order) VALUES ('pets', 'Pets', 1) ON CONFLICT (id) DO NOTHING",
    );
    const a = await addCard("Gary the Grill", { collection: "pets" });
    const b = await addCard("The Gazebo", { collection: "pets" });
    await sql(
      `INSERT INTO public.secret_card_pulls (participant_id, secret_card_id, pulled_on, event_id, granted, tier)
       VALUES ($1, $2, current_date - 5, $3, true, 'common')`,
      [IDS.alice, a, IDS.event],
    );
    const pack = await open(IDS.alice, null);
    const closer = secrets(pack).find((c) => c.id === b)!;
    expect(closer.completedCollection).toMatchObject({ collection: "pets", label: "Pets", size: 2 });
    expect(secrets(pack).find((c) => c.id === a)!.completedCollection).toBeNull();
    expect(await sql("SELECT 1 FROM public.collection_trophies")).toHaveLength(1);

    // The replay reads the stored slot back rather than asking the trophy
    // function again, which would answer null a second time.
    const again = await open(IDS.alice, null);
    expect(again?.fresh).toBe(false);
    expect(secrets(again).find((c) => c.id === b)!.completedCollection).toMatchObject({ size: 2 });
    expect(await sql("SELECT 1 FROM public.collection_trophies")).toHaveLength(1);
  });

  it("awards a guest nothing — claim_guest_secrets banks the set later", async () => {
    await sql(
      "INSERT INTO public.secret_collections (id, label, sort_order) VALUES ('pets', 'Pets', 1) ON CONFLICT (id) DO NOTHING",
    );
    await addCard("Gary the Grill", { collection: "pets" });
    const pack = await openAsGuest(GUEST_A, null);
    expect(secrets(pack)[0].completedCollection).toBeNull();
    expect(await sql("SELECT 1 FROM public.collection_trophies")).toHaveLength(0);
  });

  it("keeps the ledger when a dealt secret is deleted, and the pack when the event is", async () => {
    const id = await addCard("Gary the Grill", { weight: 10000 });
    await open();
    await expect(sql("DELETE FROM public.secret_cards WHERE id = $1", [id])).rejects.toThrow();
    await sql("DELETE FROM public.events WHERE id = $1", [IDS.event]);
    expect(await packRows()).toHaveLength(1);
  });
});

describe("pack_status", () => {
  it("never carries a set size", async () => {
    await addCard("Gary the Grill");
    await addCard("The Gazebo");
    const s = await status();
    expect(Object.keys(s).sort()).toEqual(["day", "openedToday", "resetsAt", "secretsOwned"]);
    expect(s.secretsOwned).toBe(0);
  });

  it("flips openedToday without dealing anything itself", async () => {
    expect((await status()).openedToday).toBe(false);
    expect(await packRows()).toHaveLength(0);
    await open();
    expect((await status()).openedToday).toBe(true);
    expect((await status(IDS.bob)).openedToday).toBe(false);
    expect((await status(null, GUEST_A)).openedToday).toBe(false);
  });

  it("counts the league day, not the caller's session timezone", async () => {
    const rows = await sql<{ proname: string; tz: string }>(`
      SELECT p.proname, cfg AS tz
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN LATERAL unnest(p.proconfig) AS cfg
       WHERE n.nspname = 'public'
         AND p.proname IN ('open_pack', 'pack_status')
         AND cfg LIKE 'TimeZone=%'
       ORDER BY p.proname
    `);
    expect(rows).toEqual([
      { proname: "open_pack", tz: "TimeZone=America/New_York" },
      { proname: "pack_status", tz: "TimeZone=America/New_York" },
    ]);
  });
});

describe("the pack travels with the rest of a guest's history", () => {
  it("claim_guest_packs carries the dealt slots onto the player", async () => {
    await addCard("Gary the Grill", { weight: 10000 });
    const pack = await openAsGuest(GUEST_A);
    await sql("SELECT public.claim_guest_packs($1, $2)", [IDS.alice, GUEST_A]);
    const rows = await packRows();
    expect(rows).toMatchObject([{ participant_id: IDS.alice, guest_id: null }]);
    expect(rows[0].cards).toEqual(pack?.cards);
    // And the member's own open today is now a replay of that pack.
    expect(await open(IDS.alice)).toMatchObject({ fresh: false, cards: pack?.cards });
  });

  it("claim_guest_secrets moves every secret from a three-secret pack", async () => {
    await addCard("Gary the Grill");
    await addCard("The Gazebo");
    await addCard("The Dog");
    await openAsGuest(GUEST_A, null);
    expect(await sql("SELECT public.claim_guest_secrets($1, $2)", [IDS.alice, GUEST_A])).toEqual([
      { claim_guest_secrets: 3 },
    ]);
    expect((await status()).secretsOwned).toBe(3);
  });

  it("still lets a milestone pay out a bonus secret after today's pack", async () => {
    // The bonus inserts granted = true; with the daily unique index gone this is
    // the property that keeps it distinguishable from the pack's own secrets.
    await addCard("Gary the Grill", { weight: 10000 });
    await open();
    const [row] = await sql<{ r: { granted: boolean } | null }>(
      "SELECT public.pull_bonus_secret_card($1, null, $2, null) AS r",
      [IDS.alice, IDS.event],
    );
    expect(row.r?.granted).toBe(true);
    expect(await secretRows()).toHaveLength(2);
  });

  it("keeps a second guest's pack out of the first's on merge", async () => {
    await openAsGuest(GUEST_A);
    await openAsGuest(GUEST_B);
    await sql("SELECT public.merge_guest_packs($1, $2)", [GUEST_A, GUEST_B]);
    expect(await packRows()).toMatchObject([{ guest_id: GUEST_A }]);
  });
});
