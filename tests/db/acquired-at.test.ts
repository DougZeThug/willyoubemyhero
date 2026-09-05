// When a card became YOURS, against real Postgres.
//
// The "new since your last visit" strip (§12 of docs/ux-audit-mobile.md) needs one
// fact nothing in this schema recorded: the moment a copy entered the collection
// it is currently in. Both columns that looked like they meant that do not, and
// the difference is only visible against a real database, because it is a fact
// about what accept_trade_offer and buy_market_listing DO to a row rather than
// about any of our code:
//
//   * `acquired_on` is a DATE and is deliberately CLEARED on every hand-over, so
//     a traded or bought copy has none at all.
//   * `created_at` is the MINT time and SURVIVES a hand-over, because the accept
//     re-parents the existing row rather than writing a new one — that is the
//     whole point of card_copies, so the rolled finish travels with the copy.
//
// So the two readings of "recent" that already existed were wrong in opposite
// directions, and 20260905120000 adds the one that is right. What is pinned here
// is the trigger, and above all the case it must NOT fire on.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, IDS, seedEvent, sql } from "./helpers";

afterAll(closeDb);
beforeEach(seedEvent);

const PAST_DAY = "2026-01-01";
const GUEST = "00000000-0000-4000-8000-0000000000e9";

async function firstEp(): Promise<string> {
  const [row] = await sql<{ id: string }>(
    "SELECT id FROM public.event_participants ORDER BY running_order LIMIT 1",
  );
  return row.id;
}

/** One copy, minted well in the past, so a stamp is unmistakable. */
async function oldCopy(participantId: string, ep: string): Promise<string> {
  const [row] = await sql<{ id: string }>(
    `INSERT INTO public.card_copies (participant_id, event_participant_id, source, created_at, acquired_at)
     VALUES ($1, $2, 'backfill', now() - interval '30 days', now() - interval '30 days')
     RETURNING id`,
    [participantId, ep],
  );
  return row.id;
}

/** A member who has actually claimed their player, which trading requires. */
async function claimed(participantId: string) {
  await sql(
    `INSERT INTO public.member_codes (participant_id, code_salt, code_hash, claimed_at)
     VALUES ($1, 'salt', 'hash', now())
     ON CONFLICT (participant_id) DO UPDATE SET claimed_at = now()`,
    [participantId],
  );
}

/**
 * N copies of one card, then the derived card_pulls row.
 *
 * `source = 'backfill'` so `acquired_on` stays null and these never meet
 * card_copies_one_pull_per_day — seeding several copies of one card for one person
 * is the normal case here and would otherwise collide.
 */
async function giveCopies(participantId: string, ep: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const [row] = await sql<{ id: string }>(
      `INSERT INTO public.card_copies (participant_id, event_participant_id, source)
       VALUES ($1, $2, 'backfill') RETURNING id`,
      [participantId, ep],
    );
    ids.push(row.id);
  }
  await sql("SELECT public.resync_card_pull($1, $2)", [participantId, ep]);
  return ids;
}

async function copyRow(id: string) {
  const [row] = await sql<{ created_at: string; acquired_at: string; participant_id: string }>(
    "SELECT created_at, acquired_at, participant_id FROM public.card_copies WHERE id = $1",
    [id],
  );
  return row;
}

/** How long ago, in seconds. Beats comparing timestamps across two clocks. */
const agoSeconds = async (at: string) => {
  const [row] = await sql<{ s: string }>("SELECT extract(epoch from (now() - $1::timestamptz)) AS s", [at]); // prettier-ignore
  return Number(row.s);
};

describe("card_copies.acquired_at", () => {
  it("starts life at the mint, for a copy that has never moved", async () => {
    const ep = await firstEp();
    const [row] = await sql<{ created_at: string; acquired_at: string }>(
      `INSERT INTO public.card_copies (participant_id, event_participant_id, source)
       VALUES ($1, $2, 'backfill') RETURNING created_at, acquired_at`,
      [IDS.alice, ep],
    );
    expect(await agoSeconds(row.acquired_at)).toBeLessThan(5);
    // The pg driver hands back Date objects, so this is an equality of instants
    // rather than of references.
    expect(row.acquired_at).toEqual(row.created_at);
  });

  it("restarts the moment the copy changes hands", async () => {
    // THE WHOLE POINT. A month-old copy handed over now is news now, and
    // `created_at` — untouched by the re-parent — would still say a month ago.
    const ep = await firstEp();
    const id = await oldCopy(IDS.alice, ep);
    expect(await agoSeconds((await copyRow(id)).acquired_at)).toBeGreaterThan(60);

    await sql("UPDATE public.card_copies SET participant_id = $1, source = 'trade' WHERE id = $2", [
      IDS.bob,
      id,
    ]);

    const after = await copyRow(id);
    expect(after.participant_id).toBe(IDS.bob);
    expect(await agoSeconds(after.acquired_at)).toBeLessThan(5);
    // The mint is history and stays history: the finish travelled with the copy,
    // and so does the date it was rolled.
    expect(await agoSeconds(after.created_at)).toBeGreaterThan(60);
  });

  it("is stamped by a REAL accept, not only by a hand-written UPDATE", async () => {
    // The end-to-end case, and the one that actually justifies the trigger. Every
    // test above drives the owner column directly, so they would all keep passing
    // if accept_trade_offer stopped re-parenting the row — recreated it, say, or
    // moved ownership some other way — while the strip silently went blank for the
    // one arrival it exists for. This drives the real RPC.
    const [ep, other] = await sql<{ id: string }>(
      "SELECT id FROM public.event_participants ORDER BY running_order LIMIT 2",
    ).then((rows) => rows.map((r) => r.id));

    await claimed(IDS.alice);
    await claimed(IDS.bob);
    // Two copies a side, because only a spare can be offered.
    const [aliceSpare] = await giveCopies(IDS.alice, ep!, 2);
    const [bobSpare] = await giveCopies(IDS.bob, other!, 2);
    // Aged, so a stamp is unmistakable against the mint.
    await sql(
      "UPDATE public.card_copies SET created_at = now() - interval '30 days', acquired_at = now() - interval '30 days' WHERE id = ANY($1)",
      [[aliceSpare, bobSpare]],
    );

    const [offer] = await sql<{ create_trade_offer: { ok: boolean; offerId: string } }>(
      "SELECT public.create_trade_offer($1, $2, $3, $4::jsonb, $5::jsonb)",
      [
        IDS.alice,
        IDS.bob,
        IDS.event,
        JSON.stringify([{ kind: "roster", cardCopyId: aliceSpare }]),
        JSON.stringify([{ kind: "roster", cardCopyId: bobSpare }]),
      ],
    );
    const [accepted] = await sql<{ accept_trade_offer: { ok: boolean; reason?: string } }>(
      "SELECT public.accept_trade_offer($1, $2)",
      [offer.create_trade_offer.offerId, IDS.bob],
    );
    expect(accepted.accept_trade_offer.ok).toBe(true);

    // Both copies changed hands, so both clocks restarted — and neither mint did.
    for (const id of [aliceSpare!, bobSpare!]) {
      const row = await copyRow(id);
      expect(await agoSeconds(row.acquired_at)).toBeLessThan(5);
      expect(await agoSeconds(row.created_at)).toBeGreaterThan(60);
    }
    expect((await copyRow(aliceSpare!)).participant_id).toBe(IDS.bob);
    expect((await copyRow(bobSpare!)).participant_id).toBe(IDS.alice);
  });

  it("leaves the clock alone when something else about the copy changes", async () => {
    // Re-rolling a finish for dust rewrites the row without moving it. Stamping
    // there would put a card you have held for a month at the front of the strip.
    const ep = await firstEp();
    const id = await oldCopy(IDS.alice, ep);
    await sql("UPDATE public.card_copies SET edition = 'gold' WHERE id = $1", [id]);
    expect(await agoSeconds((await copyRow(id)).acquired_at)).toBeGreaterThan(60);
  });
});

describe("secret_card_pulls.acquired_at", () => {
  async function addCard(name: string): Promise<string> {
    const [row] = await sql<{ id: string }>(
      "INSERT INTO public.secret_cards (name, art_path) VALUES ($1, $2) RETURNING id",
      [name, `secrets/${name}/art-1.webp`],
    );
    return row.id;
  }

  async function oldPull(owner: { participant?: string; guest?: string }, cardId: string) {
    const [row] = await sql<{ id: string }>(
      `INSERT INTO public.secret_card_pulls
         (participant_id, guest_id, secret_card_id, pulled_on, granted, created_at, acquired_at)
       VALUES ($1, $2, $3, $4::date, true, now() - interval '30 days', now() - interval '30 days')
       RETURNING id`,
      [owner.participant ?? null, owner.guest ?? null, cardId, PAST_DAY],
    );
    return row.id;
  }

  const pullAcquiredAt = async (id: string) => {
    const [row] = await sql<{ acquired_at: string }>(
      "SELECT acquired_at FROM public.secret_card_pulls WHERE id = $1",
      [id],
    );
    return row.acquired_at;
  };

  it("restarts when a pull is traded to somebody else", async () => {
    const card = await addCard("gary");
    const id = await oldPull({ participant: IDS.alice }, card);
    await sql("UPDATE public.secret_card_pulls SET participant_id = $1 WHERE id = $2", [
      IDS.bob,
      id,
    ]);
    expect(await agoSeconds(await pullAcquiredAt(id))).toBeLessThan(5);
  });

  it("does NOT restart when a guest puts a name to the phone they already had", async () => {
    // The case the whole trigger turns on. claim_guest_secrets sets participant_id
    // FROM NULL and guest_id TO NULL — one identity being relabelled, not a card
    // changing hands. Stamping it would open a new member's vault with every card
    // they ever pulled as a guest, presented as having arrived this second, which
    // is the loudest possible way to get this wrong.
    const card = await addCard("gazebo");
    const id = await oldPull({ guest: GUEST }, card);

    await sql("SELECT public.claim_guest_secrets($1, $2)", [IDS.carol, GUEST]);

    const [row] = await sql<{ participant_id: string; acquired_at: string }>(
      "SELECT participant_id, acquired_at FROM public.secret_card_pulls WHERE id = $1",
      [id],
    );
    expect(row.participant_id).toBe(IDS.carol);
    expect(await agoSeconds(row.acquired_at)).toBeGreaterThan(60);
  });
});
