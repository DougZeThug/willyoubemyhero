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
      "SELECT public.grant_card_copy_once($1, $2, $3, $4)",
      ["key-1", IDS.alice, ep, "standard"],
    );
    const second = await sql<{ grant_card_copy_once: { copies: number; repeat: boolean } }>(
      "SELECT public.grant_card_copy_once($1, $2, $3, $4)",
      ["key-1", IDS.alice, ep, "standard"],
    );
    expect(first[0].grant_card_copy_once).toMatchObject({ copies: 1, repeat: false });
    expect(second[0].grant_card_copy_once).toMatchObject({ copies: 1, repeat: true });
    expect(await copies(IDS.alice)).toBe(1);
  });

  it("still lets a commissioner deliberately give a second copy", async () => {
    // Two grants are two keys. Idempotency is about the retry, not the intent.
    const ep = await epFor(IDS.alice);
    await sql("SELECT public.grant_card_copy_once($1, $2, $3, $4)", [
      "key-1",
      IDS.alice,
      ep,
      "standard",
    ]);
    await sql("SELECT public.grant_card_copy_once($1, $2, $3, $4)", [
      "key-2",
      IDS.alice,
      ep,
      "standard",
    ]);
    expect(await copies(IDS.alice)).toBe(2);
  });

  it("leaves no key behind when the grant itself fails", async () => {
    // Otherwise the retry would replay a grant that never happened.
    await expect(
      sql("SELECT public.grant_card_copy_once($1, $2, $3, $4)", [
        "key-1",
        IDS.alice,
        "00000000-0000-4000-8000-00000000dead",
        "standard",
      ]),
    ).rejects.toThrow();
    const [row] = await sql<{ n: string }>("SELECT count(*)::text AS n FROM public.admin_grants");
    expect(Number(row.n)).toBe(0);
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
