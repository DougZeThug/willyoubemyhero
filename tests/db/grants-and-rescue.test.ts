// The commissioner's repair tools: handing somebody a card, and pulling a
// device's collection onto a player.
//
// Both used to be sequences with nothing tying them together. A grant inserted
// unconditionally, so a request that timed out after committing handed out a
// real second copy on the next tap — in a game whose whole economy is scarcity.
// A rescue was three RPCs plus an account repair, and the half where packs moved
// but their milestone claims did not is the one that pays a milestone twice.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, IDS, seedEvent, sql } from "./helpers";

const GUEST = "00000000-0000-4000-8000-00000000de01";
const CARD = "00000000-0000-4000-8000-00000000ca11";

afterAll(closeDb);
beforeEach(seedEvent);

async function epFor(participant: string): Promise<string> {
  const [row] = await sql<{ id: string }>(
    "SELECT id::text FROM public.event_participants WHERE event_id = $1 AND participant_id = $2",
    [IDS.event, participant],
  );
  return row.id;
}

function copies(participant: string) {
  return sql<{ n: string }>(
    "SELECT count(*)::text AS n FROM public.card_copies WHERE participant_id = $1",
    [participant],
  ).then((r) => Number(r[0].n));
}

describe("grant_card_copy_once", () => {
  it("hands over exactly one copy however many times the key arrives", async () => {
    const ep = await epFor(IDS.alice);
    const first = await sql<{ grant_card_copy_once: { copies: number; repeat: boolean } }>(
      "SELECT public.grant_card_copy_once($1, $2, $3, $4, $5)",
      ["key-1", IDS.alice, ep, "standard", IDS.event],
    );
    const second = await sql<{ grant_card_copy_once: { copies: number; repeat: boolean } }>(
      "SELECT public.grant_card_copy_once($1, $2, $3, $4, $5)",
      ["key-1", IDS.alice, ep, "standard", IDS.event],
    );
    expect(first[0].grant_card_copy_once).toMatchObject({ copies: 1, repeat: false });
    expect(second[0].grant_card_copy_once).toMatchObject({ copies: 1, repeat: true });
    expect(await copies(IDS.alice)).toBe(1);
  });

  it("still lets a commissioner deliberately give a second copy", async () => {
    // Two grants are two keys. Idempotency is about the retry, not the intent.
    const ep = await epFor(IDS.alice);
    await sql("SELECT public.grant_card_copy_once($1, $2, $3, $4, $5)", [
      "key-1",
      IDS.alice,
      ep,
      "standard",
      IDS.event,
    ]);
    await sql("SELECT public.grant_card_copy_once($1, $2, $3, $4, $5)", [
      "key-2",
      IDS.alice,
      ep,
      "standard",
      IDS.event,
    ]);
    expect(await copies(IDS.alice)).toBe(2);
  });

  it("leaves no key behind when the grant itself fails", async () => {
    // Otherwise the retry would replay a grant that never happened.
    await expect(
      sql("SELECT public.grant_card_copy_once($1, $2, $3, $4, $5)", [
        "key-1",
        IDS.alice,
        "00000000-0000-4000-8000-00000000dead",
        "standard",
        IDS.event,
      ]),
    ).rejects.toThrow();
    const [row] = await sql<{ n: string }>("SELECT count(*)::text AS n FROM public.admin_grants");
    expect(Number(row.n)).toBe(0);
  });
});

describe("a grant is scoped to the event it was authorized for", () => {
  // The admin token names one combine. Everything below is what that has to
  // mean at the write: before this, the RPC asked only whether the ids EXISTED,
  // so a valid token for this event minted copies of any other event's cards,
  // to anybody in the league — and resync_card_pull bumped that other event's
  // public "packed by N" count on the way past.
  const OTHER_EVENT = "00000000-0000-4000-8000-0000000000ee";

  /** A second combine with Alice on its roster and nobody else. */
  async function seedOtherEvent(): Promise<string> {
    await sql(
      `INSERT INTO public.events (id, name, year, active)
       VALUES ($1, 'Last Year', 2025, false)
       ON CONFLICT (id) DO NOTHING`,
      [OTHER_EVENT],
    );
    const [row] = await sql<{ id: string }>(
      `INSERT INTO public.event_participants (event_id, participant_id, running_order)
       VALUES ($1, $2, 1) RETURNING id::text`,
      [OTHER_EVENT, IDS.alice],
    );
    return row.id;
  }

  it("refuses a card from somebody else's combine", async () => {
    const theirs = await seedOtherEvent();
    await expect(
      sql("SELECT public.grant_card_copy_once($1, $2, $3, $4, $5)", [
        "key-1",
        IDS.alice,
        theirs,
        "standard",
        IDS.event,
      ]),
    ).rejects.toThrow(/Card not found/);
    expect(await copies(IDS.alice)).toBe(0);
  });

  it("leaves the other event's public count exactly where it was", async () => {
    // The half of the breach that is visible to people who are not in this
    // league's admin panel at all.
    const theirs = await seedOtherEvent();
    await expect(
      sql("SELECT public.grant_card_copy_once($1, $2, $3, $4, $5)", [
        "key-1",
        IDS.alice,
        theirs,
        "standard",
        IDS.event,
      ]),
    ).rejects.toThrow();
    const [row] = await sql<{ n: string }>(
      "SELECT count(*)::text AS n FROM public.card_pulls WHERE event_participant_id = $1",
      [theirs],
    );
    expect(Number(row.n)).toBe(0);
  });

  it("refuses a recipient who is not on this event's roster", async () => {
    // Outsider is a real participant with a real id and is deliberately off the
    // roster. A copy filed against them is a card in a vault this commissioner
    // has no say over.
    const ep = await epFor(IDS.alice);
    await expect(
      sql("SELECT public.grant_card_copy_once($1, $2, $3, $4, $5)", [
        "key-1",
        IDS.outsider,
        ep,
        "standard",
        IDS.event,
      ]),
    ).rejects.toThrow(/not in this event/);
    expect(await copies(IDS.outsider)).toBe(0);
  });

  it("burns no key on a refusal, so the honest retry still works", async () => {
    const theirs = await seedOtherEvent();
    await expect(
      sql("SELECT public.grant_card_copy_once($1, $2, $3, $4, $5)", [
        "key-1",
        IDS.alice,
        theirs,
        "standard",
        IDS.event,
      ]),
    ).rejects.toThrow();
    const [row] = await sql<{ n: string }>("SELECT count(*)::text AS n FROM public.admin_grants");
    expect(Number(row.n)).toBe(0);
  });

  it("refuses a grant that names no event at all", async () => {
    // The signature defaults `_event_id` so a server still running the old
    // bundle against a migrated database fails loudly here instead of resolving
    // to an unscoped grant. A deploy is the one moment both versions exist.
    const ep = await epFor(IDS.alice);
    await expect(
      sql("SELECT public.grant_card_copy($1, $2, $3)", [IDS.alice, ep, "standard"]),
    ).rejects.toThrow(/needs the event/);
    expect(await copies(IDS.alice)).toBe(0);
  });

  it("still grants freely inside the event the token names", async () => {
    // The honest path, unchanged — including on a combine that is over, which is
    // exactly when a lost collection gets put back. `active` is deliberately not
    // part of the rule.
    await sql("UPDATE public.events SET active = false WHERE id = $1", [IDS.event]);
    const ep = await epFor(IDS.bob);
    await sql("SELECT public.grant_card_copy_once($1, $2, $3, $4, $5)", [
      "key-1",
      IDS.alice,
      ep,
      "standard",
      IDS.event,
    ]);
    expect(await copies(IDS.alice)).toBe(1);
  });
});

describe("grant_secret_card_once", () => {
  beforeEach(async () => {
    // A one-card set, so the first grant finishes it and the trophy is in play.
    await sql(
      `INSERT INTO public.secret_collections (id, label, active)
       VALUES ('pets', 'Pets', true)
       ON CONFLICT (id) DO UPDATE SET active = true`,
    );
    await sql(
      `INSERT INTO public.secret_cards (id, name, collection, active, art_path)
       VALUES ($1, 'Ghost', 'pets', true, 'secret/ghost.png')`,
      [CARD],
    );
  });

  it("deals a secret once per key", async () => {
    const first = await sql<{ grant_secret_card_once: { repeat: boolean } }>(
      "SELECT public.grant_secret_card_once($1, $2, $3, $4)",
      ["key-1", IDS.alice, CARD, IDS.event],
    );
    const second = await sql<{ grant_secret_card_once: { repeat: boolean } }>(
      "SELECT public.grant_secret_card_once($1, $2, $3, $4)",
      ["key-1", IDS.alice, CARD, IDS.event],
    );
    expect(first[0].grant_secret_card_once.repeat).toBe(false);
    expect(second[0].grant_secret_card_once.repeat).toBe(true);
    const [row] = await sql<{ n: string }>(
      "SELECT count(*)::text AS n FROM public.secret_card_pulls WHERE participant_id = $1",
      [IDS.alice],
    );
    expect(Number(row.n)).toBe(1);
  });

  it("does not celebrate the same finished set twice", async () => {
    const first = await sql<{
      grant_secret_card_once: { completedCollection: unknown };
    }>("SELECT public.grant_secret_card_once($1, $2, $3, $4)", [
      "key-1",
      IDS.alice,
      CARD,
      IDS.event,
    ]);
    const second = await sql<{
      grant_secret_card_once: { completedCollection: unknown };
    }>("SELECT public.grant_secret_card_once($1, $2, $3, $4)", [
      "key-1",
      IDS.alice,
      CARD,
      IDS.event,
    ]);
    expect(first[0].grant_secret_card_once.completedCollection).not.toBeNull();
    expect(second[0].grant_secret_card_once.completedCollection).toBeNull();
  });
});

describe("bind_account_to_player", () => {
  // The claim screen's own path, and the shape attach_device_to_player was
  // written to retire still standing on it: an account row committed as a member
  // and only THEN three separate requests to move the collection that row now
  // claims to own. A failure partway left the account bound with its packs and
  // rungs behind on a guest id nothing reads again — and no rollback, because
  // each of those was its own transaction.
  const USER = "00000000-0000-4000-8000-00000000ac02";

  /** A device with one of each of the three things a guest can be holding. */
  async function seedGuestCollection(guestId = GUEST) {
    await sql(
      `INSERT INTO public.secret_cards (id, name, collection, active)
       VALUES ($1, 'Ghost', 'pets', true) ON CONFLICT (id) DO NOTHING`,
      [CARD],
    );
    await sql(
      `INSERT INTO public.secret_card_pulls (guest_id, secret_card_id, pulled_on, tier)
       VALUES ($1, $2, current_date, 'common')`,
      [guestId, CARD],
    );
    await sql(
      `INSERT INTO public.pack_opens (guest_id, opened_on, event_id, card_count)
       VALUES ($1, current_date, $2, 3)`,
      [guestId, IDS.event],
    );
    await sql(
      `INSERT INTO public.streak_milestone_claims
         (guest_id, streak_started_on, milestone, claimed_on, event_id)
       VALUES ($1, current_date, 3, current_date, $2)`,
      [guestId, IDS.event],
    );
  }

  /** What is still filed against the guest, across all three tables. */
  async function stillOnGuest(guestId = GUEST) {
    const [row] = await sql<{ secrets: string; packs: string; rungs: string }>(
      `SELECT
         (SELECT count(*) FROM public.secret_card_pulls WHERE guest_id = $1)::text        AS secrets,
         (SELECT count(*) FROM public.pack_opens WHERE guest_id = $1)::text               AS packs,
         (SELECT count(*) FROM public.streak_milestone_claims WHERE guest_id = $1)::text  AS rungs`,
      [guestId],
    );
    return { secrets: Number(row.secrets), packs: Number(row.packs), rungs: Number(row.rungs) };
  }

  it("upgrades a guest account and empties the guest id in one go", async () => {
    await sql(`INSERT INTO public.account_identities (user_id, guest_id) VALUES ($1, $2)`, [
      USER,
      GUEST,
    ]);
    await seedGuestCollection();

    const [res] = await sql<{ bind_account_to_player: { bound: boolean; name: string } }>(
      "SELECT public.bind_account_to_player($1, $2)",
      [USER, IDS.alice],
    );
    expect(res.bind_account_to_player).toMatchObject({ bound: true, name: "Alice" });

    const [row] = await sql<{ participant_id: string | null; guest_id: string | null }>(
      "SELECT participant_id::text, guest_id::text FROM public.account_identities WHERE user_id = $1",
      [USER],
    );
    expect(row).toEqual({ participant_id: IDS.alice, guest_id: null });
    // All three, which is the property. Two out of three is the state that pays
    // a milestone twice.
    expect(await stillOnGuest()).toEqual({ secrets: 0, packs: 0, rungs: 0 });
  });

  it("creates the row when the account has never had one", async () => {
    const [res] = await sql<{ bind_account_to_player: { bound: boolean } }>(
      "SELECT public.bind_account_to_player($1, $2)",
      [USER, IDS.alice],
    );
    expect(res.bind_account_to_player).toMatchObject({ bound: true });
    const [row] = await sql<{ participant_id: string | null }>(
      "SELECT participant_id::text FROM public.account_identities WHERE user_id = $1",
      [USER],
    );
    expect(row.participant_id).toBe(IDS.alice);
  });

  it("treats re-claiming the same player as a no-op", async () => {
    // The phone may simply have lost its token and re-run the paper code.
    await sql(`INSERT INTO public.account_identities (user_id, participant_id) VALUES ($1, $2)`, [
      USER,
      IDS.alice,
    ]);
    const [res] = await sql<{ bind_account_to_player: { bound: boolean; name: string } }>(
      "SELECT public.bind_account_to_player($1, $2)",
      [USER, IDS.alice],
    );
    expect(res.bind_account_to_player).toMatchObject({ bound: true, name: "Alice" });
  });

  it("refuses a second, different player and names the one that stands", async () => {
    // syncAccount treats this row as authoritative, so taking it over would
    // re-mint every other device onto the new player.
    await sql(`INSERT INTO public.account_identities (user_id, participant_id) VALUES ($1, $2)`, [
      USER,
      IDS.alice,
    ]);
    const [res] = await sql<{
      bind_account_to_player: { bound: boolean; boundName: string };
    }>("SELECT public.bind_account_to_player($1, $2)", [USER, IDS.bob]);
    expect(res.bind_account_to_player).toMatchObject({ bound: false, boundName: "Alice" });
    const [row] = await sql<{ participant_id: string }>(
      "SELECT participant_id::text FROM public.account_identities WHERE user_id = $1",
      [USER],
    );
    expect(row.participant_id).toBe(IDS.alice);
  });

  it("files a guest the caller names against whoever actually won the row", async () => {
    // syncAccount read the account's guest identity before calling. If a bind
    // from another device landed in between, the row's own guest_id has already
    // been cleared by the winner — and that collection would be stranded by the
    // very write meant to rescue it.
    await sql(`INSERT INTO public.account_identities (user_id, participant_id) VALUES ($1, $2)`, [
      USER,
      IDS.alice,
    ]);
    await seedGuestCollection();

    const [res] = await sql<{ bind_account_to_player: { bound: boolean } }>(
      "SELECT public.bind_account_to_player($1, $2, $3)",
      [USER, IDS.bob, GUEST],
    );
    expect(res.bind_account_to_player).toMatchObject({ bound: false });
    expect(await stillOnGuest()).toEqual({ secrets: 0, packs: 0, rungs: 0 });
    const [packs] = await sql<{ participant_id: string }>(
      "SELECT participant_id::text FROM public.pack_opens",
    );
    expect(packs.participant_id).toBe(IDS.alice);
  });

  it("refuses a player the league has never heard of, moving nothing", async () => {
    await sql(`INSERT INTO public.account_identities (user_id, guest_id) VALUES ($1, $2)`, [
      USER,
      GUEST,
    ]);
    await seedGuestCollection();
    await expect(
      sql("SELECT public.bind_account_to_player($1, $2)", [
        USER,
        "00000000-0000-4000-8000-00000000dead",
      ]),
    ).rejects.toThrow(/No such player/);
    expect(await stillOnGuest()).toEqual({ secrets: 1, packs: 1, rungs: 1 });
    const [row] = await sql<{ guest_id: string | null }>(
      "SELECT guest_id::text FROM public.account_identities WHERE user_id = $1",
      [USER],
    );
    expect(row.guest_id).toBe(GUEST);
  });

  it("binds nothing at all when a move partway through fails", async () => {
    // The property the three sequential requests could not have. Breaking the
    // LAST of the three moves is the harshest version: the row has been written
    // and two tables have already moved by the time it raises.
    await sql(`INSERT INTO public.account_identities (user_id, guest_id) VALUES ($1, $2)`, [
      USER,
      GUEST,
    ]);
    await seedGuestCollection();
    // NOT VALID, so the existing row is left alone and the constraint still
    // fires on the UPDATE that re-parents it — which is the third move.
    await sql(
      `ALTER TABLE public.streak_milestone_claims ADD CONSTRAINT tmp_boom CHECK (false) NOT VALID`,
    );
    try {
      await expect(
        sql("SELECT public.bind_account_to_player($1, $2)", [USER, IDS.alice]),
      ).rejects.toThrow();
      // Everything, back where it started — including the account row, which the
      // old path had already committed as a member by this point.
      expect(await stillOnGuest()).toEqual({ secrets: 1, packs: 1, rungs: 1 });
      const [row] = await sql<{ participant_id: string | null; guest_id: string | null }>(
        "SELECT participant_id::text, guest_id::text FROM public.account_identities WHERE user_id = $1",
        [USER],
      );
      expect(row).toEqual({ participant_id: null, guest_id: GUEST });
    } finally {
      await sql(`ALTER TABLE public.streak_milestone_claims DROP CONSTRAINT IF EXISTS tmp_boom`);
    }
  });
});

describe("attach_device_to_player", () => {
  it("moves the whole device or none of it", async () => {
    await sql(
      `INSERT INTO public.secret_cards (id, name, collection, active)
       VALUES ($1, 'Ghost', 'pets', true)`,
      [CARD],
    );
    await sql(
      `INSERT INTO public.secret_card_pulls (guest_id, secret_card_id, pulled_on, tier)
       VALUES ($1, $2, current_date, 'common')`,
      [GUEST, CARD],
    );
    await sql(
      `INSERT INTO public.pack_opens (guest_id, opened_on, event_id, card_count)
       VALUES ($1, current_date, $2, 3)`,
      [GUEST, IDS.event],
    );

    const [res] = await sql<{ attach_device_to_player: { name: string; secrets: number } }>(
      "SELECT public.attach_device_to_player($1, $2)",
      [IDS.alice, GUEST],
    );
    expect(res.attach_device_to_player).toMatchObject({ name: "Alice", secrets: 1 });

    const [pulls] = await sql<{ guest_id: string | null; participant_id: string | null }>(
      "SELECT guest_id::text, participant_id::text FROM public.secret_card_pulls",
    );
    expect(pulls).toEqual({ guest_id: null, participant_id: IDS.alice });

    const [packs] = await sql<{ guest_id: string | null; participant_id: string | null }>(
      "SELECT guest_id::text, participant_id::text FROM public.pack_opens",
    );
    expect(packs).toEqual({ guest_id: null, participant_id: IDS.alice });
  });

  it("refuses a player the league has never heard of, moving nothing", async () => {
    await sql(
      `INSERT INTO public.pack_opens (guest_id, opened_on, event_id, card_count)
       VALUES ($1, current_date, $2, 3)`,
      [GUEST, IDS.event],
    );
    await expect(
      sql("SELECT public.attach_device_to_player($1, $2)", [
        "00000000-0000-4000-8000-00000000dead",
        GUEST,
      ]),
    ).rejects.toThrow(/No such player/);
    const [row] = await sql<{ guest_id: string | null }>(
      "SELECT guest_id::text FROM public.pack_opens",
    );
    expect(row.guest_id).toBe(GUEST);
  });

  it("binds an account that was still acting as this guest", async () => {
    const user = "00000000-0000-4000-8000-00000000ac01";
    await sql(`INSERT INTO public.account_identities (user_id, guest_id) VALUES ($1, $2)`, [
      user,
      GUEST,
    ]);
    await sql("SELECT public.attach_device_to_player($1, $2)", [IDS.alice, GUEST]);
    const [row] = await sql<{ participant_id: string | null }>(
      "SELECT participant_id::text FROM public.account_identities WHERE user_id = $1",
      [user],
    );
    expect(row.participant_id).toBe(IDS.alice);
  });
});
