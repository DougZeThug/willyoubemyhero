// The marketplace, against real Postgres.
//
// Four properties live here and nowhere else.
//
// A SALE SUMS TO ZERO. There is no house cut, so the marketplace must move dust
// without creating or destroying any — which keeps the economy's only faucets
// the mill and the secret sale, and is the whole reason a marketplace cannot
// inflate this economy. One INSERT writes both rows; these tests are what say it
// stays that way.
//
// A SALE MAY NOT COST SOMEBODY THEIR LAST COPY. A bare `card_pulls` row count per
// card IS the public "Packed by N", so a sale that took a seller to zero copies
// would move a number no sale is allowed to move. Two listings of one pair is the
// shape that gets there, and it is guarded twice — refused at listing time, and
// re-validated under the participant lock at buy time.
//
// A BUY IS PAID FOR EXACTLY ONCE. The replay check keyed on the caller's request
// id sits ABOVE the status check on purpose: a retry of a successful buy finds
// its own listing already sold, and the wrong order would answer somebody's own
// purchase with a refusal while keeping their dust.
//
// AND NO SALE MAY BUY BACK A DAILY PULL. list -> sell -> pull -> list is the one
// sequence here that would print dust forever, and `trade_item_is_spare`'s secret
// branch, called at both ends, is the only thing standing in front of it.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, isDenied, IDS, newClient, seedEvent, sql } from "./helpers";

afterAll(closeDb);
beforeEach(async () => {
  await seedEvent();
  // Dust ships switched OFF, so every test about what the market does once
  // somebody turns it on has to turn it on. The "while the switch is off" block
  // at the bottom is the other half.
  await sql("UPDATE public.events SET dust_enabled = true");
});

/**
 * The league day, as the RPCs see it. Copied from tests/db/dust.test.ts, which
 * explains why: every function here runs under SET timezone = 'America/New_York'
 * while this session is UTC, so a bare `current_date` is tomorrow's NY date for
 * five hours every evening.
 */
const NY = `(now() AT TIME ZONE 'America/New_York')::date`;

const REQ = (n: string) => `aaaaaaaa-0000-4000-8000-00000000000${n}`;

async function cardIds(): Promise<string[]> {
  const rows = await sql<{ id: string }>(
    "SELECT id FROM public.event_participants ORDER BY running_order",
  );
  return rows.map((r) => r.id);
}

async function balance(participantId: string): Promise<number> {
  const [row] = await sql<{ b: number }>("SELECT public.dust_balance($1) AS b", [participantId]);
  return row.b;
}

async function credit(amount: number, participantId: string) {
  // dust_ledger_delta_nonzero is a CHECK, so a zero credit raises rather than
  // doing nothing — which is what a caller asking for no funds means.
  if (amount === 0) return;
  await sql(
    `INSERT INTO public.dust_ledger (participant_id, delta, reason) VALUES ($1, $2, 'admin_adjust')`,
    [participantId, amount],
  );
}

/** create_trade_offer refuses to send an offer to anybody unclaimed. */
async function claimMember(participantId: string) {
  await sql(
    `INSERT INTO public.member_codes (participant_id, code_salt, code_hash, claimed_at)
     VALUES ($1, 'salt', 'hash', now())
     ON CONFLICT (participant_id) DO UPDATE SET claimed_at = now()`,
    [participantId],
  );
}

/**
 * `copies` copies of one roster card for one person, all dated yesterday.
 *
 * `source = 'trade'` rather than 'pull' so several can share a person and a card
 * without tripping card_copies_one_pull_per_day, which is partial on
 * source = 'pull'. Nothing here is about how the copies arrived.
 */
async function holdCopies(participantId: string, cardId: string, copies: number, edition = "gold") {
  const ids: string[] = [];
  for (let i = 0; i < copies; i++) {
    const [row] = await sql<{ id: string }>(
      `INSERT INTO public.card_copies
         (participant_id, event_participant_id, edition, source, edition_asserted_by)
       VALUES ($1, $2, $3, 'trade', 'server') RETURNING id`,
      [participantId, cardId, edition],
    );
    ids.push(row.id);
  }
  await sql("SELECT public.resync_card_pull($1, $2)", [participantId, cardId]);
  return ids;
}

async function seedSecret(name: string, collection: string | null = null) {
  // award_collection_trophy looks the set up in secret_collections and returns
  // NULL for one it cannot find or that is inactive — a set name on a card is not
  // by itself a set.
  if (collection) {
    await sql(
      `INSERT INTO public.secret_collections (id, label) VALUES ($1, $2)
       ON CONFLICT (id) DO NOTHING`,
      [collection, collection],
    );
  }
  const [row] = await sql<{ id: string }>(
    `INSERT INTO public.secret_cards (name, art_path, active, collection)
     VALUES ($1, $2, true, $3) RETURNING id`,
    [name, `secrets/${name}/art-1.webp`, collection],
  );
  return row.id;
}

/** One granted secret copy on file, already listable. */
async function heldSecret(
  participantId: string,
  name = "gary",
  tier = "rare",
  collection: string | null = null,
) {
  // prettier-ignore
  const cardId = await seedSecret(name, collection);
  const [row] = await sql<{ id: string }>(
    `INSERT INTO public.secret_card_pulls
       (participant_id, secret_card_id, pulled_on, event_id, is_duplicate, granted, tier)
     VALUES ($1, $2, ${NY}, $3, false, true, $4) RETURNING id`,
    [participantId, cardId, IDS.event, tier],
  );
  return { pullId: row.id, cardId };
}

type ListResult = { ok: boolean; reason?: string; listingId?: string; price?: number };
async function list(
  participantId: string,
  opts: { kind?: "roster" | "secret"; copyId?: string; pullId?: string; price?: number },
): Promise<ListResult> {
  const kind = opts.kind ?? (opts.pullId ? "secret" : "roster");
  const [row] = await sql<{ list_card_for_dust: ListResult }>(
    "SELECT public.list_card_for_dust($1, $2, $3, $4, $5)",
    [participantId, kind, opts.copyId ?? null, opts.pullId ?? null, opts.price ?? 100],
  );
  return row.list_card_for_dust;
}

type BuyResult = {
  ok: boolean;
  reason?: string;
  price?: number;
  kind?: string;
  balance?: number;
  edition?: string;
  eventParticipantId?: string;
  secretCardId?: string;
  duplicate?: boolean;
  completedCollection?: unknown;
};
async function buy(participantId: string, listingId: string, req = REQ("1")): Promise<BuyResult> {
  const [row] = await sql<{ buy_market_listing: BuyResult }>(
    "SELECT public.buy_market_listing($1, $2, $3)",
    [participantId, listingId, req],
  );
  return row.buy_market_listing;
}

async function cancel(participantId: string, listingId: string) {
  const [row] = await sql<{ cancel_market_listing: { ok: boolean; reason?: string } }>(
    "SELECT public.cancel_market_listing($1, $2)",
    [participantId, listingId],
  );
  return row.cancel_market_listing;
}

async function statusOf(listingId: string): Promise<string> {
  const [row] = await sql<{ status: string }>(
    "SELECT status FROM public.market_listings WHERE id = $1",
    [listingId],
  );
  return row?.status;
}

/** The public "Packed by N": one card_pulls row per person who holds the card. */
async function packedBy(cardId: string): Promise<number> {
  const [row] = await sql<{ n: number }>(
    "SELECT count(*)::int AS n FROM public.card_pulls WHERE event_participant_id = $1",
    [cardId],
  );
  return row.n;
}

async function copyCount(participantId: string, cardId: string): Promise<number> {
  const [row] = await sql<{ n: number }>(
    `SELECT count(*)::int AS n FROM public.card_copies
      WHERE participant_id = $1 AND event_participant_id = $2`,
    [participantId, cardId],
  );
  return row.n;
}

/** A listed roster card of Alice's, with Bob funded to buy it. */
async function shelf(price = 100, funds = 500) {
  const ids = await cardIds();
  const [spare] = await holdCopies(IDS.alice, ids[0], 2);
  await credit(funds, IDS.bob);
  const res = await list(IDS.alice, { copyId: spare, price });
  return { listingId: res.listingId!, copyId: spare, cardId: ids[0] };
}

describe("market_listings", () => {
  it("is unreachable with the publishable key, table and functions alike", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      expect(await isDenied(role, "SELECT * FROM public.market_listings")).toBe(true);
      expect(
        await isDenied(role, "SELECT public.list_card_for_dust($1, 'roster', $2, NULL, 10)", [
          IDS.alice,
          IDS.alice,
        ]),
      ).toBe(true);
      expect(
        await isDenied(role, "SELECT public.buy_market_listing($1, $2, $3)", [
          IDS.bob,
          IDS.alice,
          REQ("1"),
        ]),
      ).toBe(true);
      expect(
        await isDenied(role, "SELECT public.cancel_market_listing($1, $2)", [IDS.alice, IDS.alice]),
      ).toBe(true);
    }
  });

  it("refuses a price the schema will not take", async () => {
    // Both ends of the CHECK, inserted directly: the rule is the schema's rather
    // than the RPC's, and market_listings_price_ck is what makes a zero-price
    // listing impossible to reach dust_ledger_delta_nonzero with.
    const ids = await cardIds();
    const [copy] = await holdCopies(IDS.alice, ids[0], 2);
    for (const price of [0, -5, 10000]) {
      await expect(
        sql(
          `INSERT INTO public.market_listings (seller_id, kind, card_copy_id, price)
           VALUES ($1, 'roster', $2, $3)`,
          [IDS.alice, copy, price],
        ),
      ).rejects.toThrow();
    }
  });

  it("refuses a listing whose kind and target disagree", async () => {
    const ids = await cardIds();
    const [copy] = await holdCopies(IDS.alice, ids[0], 2);
    await expect(
      sql(
        `INSERT INTO public.market_listings (seller_id, kind, secret_pull_id, price)
         VALUES ($1, 'roster', NULL, 10)`,
        [IDS.alice],
      ),
    ).rejects.toThrow();
    await expect(
      sql(
        `INSERT INTO public.market_listings (seller_id, kind, card_copy_id, price)
         VALUES ($1, 'secret', $2, 10)`,
        [IDS.alice, copy],
      ),
    ).rejects.toThrow();
  });

  it("takes the listing with the copy when the copy is deleted", async () => {
    // CASCADE rather than SET NULL plus a status: a listing whose target is gone
    // would fail market_listings_identity_ck, and dropping that CHECK to keep the
    // row is strictly worse than letting the row go.
    const { listingId, copyId } = await shelf();
    await sql("DELETE FROM public.card_copies WHERE id = $1", [copyId]);
    const [row] = await sql<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.market_listings WHERE id = $1",
      [listingId],
    );
    expect(row.n).toBe(0);
  });
});

describe("list_card_for_dust", () => {
  it("puts a spare on the shelf", async () => {
    const ids = await cardIds();
    const [spare] = await holdCopies(IDS.alice, ids[0], 2);
    const res = await list(IDS.alice, { copyId: spare, price: 250 });
    expect(res.ok).toBe(true);
    expect(res.price).toBe(250);
    expect(await statusOf(res.listingId!)).toBe("active");
  });

  it("refuses somebody else's card", async () => {
    const ids = await cardIds();
    const [spare] = await holdCopies(IDS.alice, ids[0], 2);
    expect(await list(IDS.bob, { copyId: spare })).toMatchObject({
      ok: false,
      reason: "not_yours",
    });
  });

  it("refuses an only copy", async () => {
    // The rule the whole design hangs off: a sale may never take somebody to zero
    // copies, because the row count per card is the public "Packed by N".
    const ids = await cardIds();
    const [only] = await holdCopies(IDS.alice, ids[0], 1);
    expect(await list(IDS.alice, { copyId: only })).toMatchObject({
      ok: false,
      reason: "last_copy",
    });
  });

  it("refuses a price outside the bounds without raising", async () => {
    const ids = await cardIds();
    const [spare] = await holdCopies(IDS.alice, ids[0], 2);
    expect(await list(IDS.alice, { copyId: spare, price: 0 })).toMatchObject({
      ok: false,
      reason: "bad_price",
    });
    expect(await list(IDS.alice, { copyId: spare, price: 10000 })).toMatchObject({
      ok: false,
      reason: "bad_price",
    });
  });

  it("refuses a second listing of a copy that is already up, and says which", async () => {
    // Answered here rather than left to market_listings_copy_once, which raises a
    // unique violation and puts a raw Postgres string on a button.
    const ids = await cardIds();
    const [spare] = await holdCopies(IDS.alice, ids[0], 2);
    const first = await list(IDS.alice, { copyId: spare, price: 100 });
    const second = await list(IDS.alice, { copyId: spare, price: 900 });
    expect(second).toMatchObject({ ok: false, reason: "already_listed", listingId: first.listingId }); // prettier-ignore
    // And the price did not move. That immutability is what lets a buyer trust
    // the number on the tile.
    const [row] = await sql<{ price: number }>(
      "SELECT price FROM public.market_listings WHERE id = $1",
      [first.listingId],
    );
    expect(row.price).toBe(100);
  });

  it("refuses both copies of a pair, so a sale can never take the last one", async () => {
    // THE MULTI-LISTING HOLE. trade_item_is_spare only asks "do you hold >= 2",
    // which each listing of a pair passes on its own — it only ever sees the count
    // before anything moved.
    const ids = await cardIds();
    const [a, b] = await holdCopies(IDS.alice, ids[0], 2);
    expect((await list(IDS.alice, { copyId: a })).ok).toBe(true);
    expect(await list(IDS.alice, { copyId: b })).toMatchObject({
      ok: false,
      reason: "last_copy",
    });
  });

  it("counts a copy staked on a pending offer as a commitment too", async () => {
    // The same over-commitment wearing a different hat: stake your second copy on
    // an offer, shelve the first, and both settling takes you to zero.
    const ids = await cardIds();
    await claimMember(IDS.alice);
    await claimMember(IDS.bob);
    const [a, b] = await holdCopies(IDS.alice, ids[0], 2);
    await holdCopies(IDS.bob, ids[1], 2);
    const [bobSpare] = await sql<{ id: string }>(
      "SELECT id FROM public.card_copies WHERE participant_id = $1 LIMIT 1",
      [IDS.bob],
    );
    await sql("SELECT public.create_trade_offer($1, $2, $3, $4::jsonb, $5::jsonb)", [
      IDS.alice,
      IDS.bob,
      IDS.event,
      JSON.stringify([{ kind: "roster", cardCopyId: a }]),
      JSON.stringify([{ kind: "roster", cardCopyId: bobSpare.id }]),
    ]);
    expect(await list(IDS.alice, { copyId: b })).toMatchObject({
      ok: false,
      reason: "last_copy",
    });
  });

  it("still lets a staked copy be listed while a copy remains uncommitted", async () => {
    // Listing a trade-staked card is ALLOWED, deliberately: create_trade_offer
    // lets one copy sit on several pending offers at once, and a listing promises
    // rather than destroys. Whichever settles first voids the other.
    const ids = await cardIds();
    await claimMember(IDS.alice);
    await claimMember(IDS.bob);
    const [a] = await holdCopies(IDS.alice, ids[0], 3);
    await holdCopies(IDS.bob, ids[1], 2);
    const [bobSpare] = await sql<{ id: string }>(
      "SELECT id FROM public.card_copies WHERE participant_id = $1 LIMIT 1",
      [IDS.bob],
    );
    await sql("SELECT public.create_trade_offer($1, $2, $3, $4::jsonb, $5::jsonb)", [
      IDS.alice,
      IDS.bob,
      IDS.event,
      JSON.stringify([{ kind: "roster", cardCopyId: a }]),
      JSON.stringify([{ kind: "roster", cardCopyId: bobSpare.id }]),
    ]);
    expect((await list(IDS.alice, { copyId: a })).ok).toBe(true);
  });

  it("caps one person's shelf so a browse stays readable", async () => {
    // Not an economic rule — the only shape of denial-of-service a marketplace of
    // thirteen people with no pagination has.
    const ids = await cardIds();
    await holdCopies(IDS.alice, ids[0], 30);
    const copies = await sql<{ id: string }>(
      "SELECT id FROM public.card_copies WHERE participant_id = $1",
      [IDS.alice],
    );
    let refused = "";
    for (const c of copies) {
      const res = await list(IDS.alice, { copyId: c.id, price: 5 });
      if (!res.ok) {
        refused = res.reason!;
        break;
      }
    }
    expect(refused).toBe("too_many");
    const [row] = await sql<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.market_listings WHERE status = 'active'",
    );
    expect(row.n).toBe(20);
  });

  it("lists any secret copy, including an only one", async () => {
    // The rule trading already keeps: no public count rides on holding a secret.
    const { pullId } = await heldSecret(IDS.alice);
    expect((await list(IDS.alice, { pullId, price: 300 })).ok).toBe(true);
  });

  it("refuses today's un-granted pull, which is the seller's spent daily slot", async () => {
    // THE ONE SEQUENCE THAT WOULD PRINT. buy_market_listing sets granted = true on
    // the row it moves — it has to, or secret_card_pulls_one_per_day aborts the
    // sale — so listing today's un-granted pull would hand the SELLER a second
    // daily slot the moment somebody bought it.
    const cardId = await seedSecret("fresh");
    const [row] = await sql<{ id: string }>(
      `INSERT INTO public.secret_card_pulls
         (participant_id, secret_card_id, pulled_on, event_id, is_duplicate, granted, tier)
       VALUES ($1, $2, ${NY}, $3, false, false, 'rare') RETURNING id`,
      [IDS.alice, cardId, IDS.event],
    );
    expect(await list(IDS.alice, { pullId: row.id })).toMatchObject({
      ok: false,
      reason: "too_fresh",
    });

    // Yesterday's identical row lists freely.
    await sql("UPDATE public.secret_card_pulls SET pulled_on = pulled_on - 1 WHERE id = $1", [
      row.id,
    ]);
    expect((await list(IDS.alice, { pullId: row.id })).ok).toBe(true);
  });
});

describe("cancel_market_listing", () => {
  it("takes a listing back down", async () => {
    const { listingId } = await shelf();
    expect((await cancel(IDS.alice, listingId)).ok).toBe(true);
    expect(await statusOf(listingId)).toBe("cancelled");
  });

  it("refuses somebody else's listing", async () => {
    const { listingId } = await shelf();
    expect(await cancel(IDS.bob, listingId)).toMatchObject({ ok: false, reason: "not_yours" });
    expect(await statusOf(listingId)).toBe("active");
  });

  it("answers a listing that already sold with a toast rather than an error", async () => {
    const { listingId } = await shelf();
    await buy(IDS.bob, listingId);
    expect(await cancel(IDS.alice, listingId)).toMatchObject({ ok: false, reason: "resolved" });
  });

  it("still works once the commissioner switches dust off", async () => {
    // The only RPC in the feature without a dust_enabled() gate, on purpose:
    // switching the economy off must not strand somebody's cards on a shelf.
    const { listingId } = await shelf();
    await sql("UPDATE public.events SET dust_enabled = false");
    expect((await cancel(IDS.alice, listingId)).ok).toBe(true);
  });
});

describe("buy_market_listing", () => {
  it("moves the card and the dust, and the dust sums to zero", async () => {
    // NO HOUSE CUT. The marketplace moves dust and creates none, which is what
    // keeps the economy's only faucets the mill and the secret sale.
    const { listingId, cardId } = await shelf(120, 500);
    const before = (await balance(IDS.alice)) + (await balance(IDS.bob));

    const res = await buy(IDS.bob, listingId);
    expect(res.ok).toBe(true);
    expect(res.price).toBe(120);
    expect(await balance(IDS.bob)).toBe(380);
    expect(await balance(IDS.alice)).toBe(120);
    expect((await balance(IDS.alice)) + (await balance(IDS.bob))).toBe(before);

    expect(await copyCount(IDS.alice, cardId)).toBe(1);
    expect(await copyCount(IDS.bob, cardId)).toBe(1);
    expect(await statusOf(listingId)).toBe("sold");
  });

  it("writes exactly two ledger rows, both against the listing", async () => {
    const { listingId } = await shelf(75);
    await buy(IDS.bob, listingId);
    const rows = await sql<{ participant_id: string; delta: number; reason: string; ref: string }>(
      `SELECT participant_id, delta, reason, ref FROM public.dust_ledger
        WHERE reason IN ('market_buy', 'market_sale') ORDER BY reason`,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ participant_id: IDS.bob, delta: -75, reason: "market_buy", ref: listingId }); // prettier-ignore
    expect(rows[1]).toMatchObject({ participant_id: IDS.alice, delta: 75, reason: "market_sale", ref: listingId }); // prettier-ignore
  });

  it("never moves the public Packed by N", async () => {
    // The number a sale may not touch. Alice keeps a copy because the spare rule
    // says so, and Bob gains a row he did not have — so it can rise, never fall.
    const { listingId, cardId } = await shelf();
    expect(await packedBy(cardId)).toBe(1);
    await buy(IDS.bob, listingId);
    expect(await packedBy(cardId)).toBe(2);
  });

  it("carries the finish, and how the finish was decided, across with the copy", async () => {
    // edition_asserted_by travels untouched, so a hand-asserted platinum still
    // mills at the floor in the buyer's hands. Buying cannot launder a finish.
    const ids = await cardIds();
    const copies: string[] = [];
    for (let i = 0; i < 2; i++) {
      const [row] = await sql<{ id: string }>(
        `INSERT INTO public.card_copies
           (participant_id, event_participant_id, edition, source, edition_asserted_by)
         VALUES ($1, $2, 'platinum', 'trade', 'client') RETURNING id`,
        [IDS.alice, ids[0]],
      );
      copies.push(row.id);
    }
    await sql("SELECT public.resync_card_pull($1, $2)", [IDS.alice, ids[0]]);
    await credit(500, IDS.bob);
    const res = await list(IDS.alice, { copyId: copies[0], price: 10 });
    await buy(IDS.bob, res.listingId!);

    const [row] =
      await sql<{ edition: string; edition_asserted_by: string; source: string; acquired_on: string | null }>( // prettier-ignore
        "SELECT edition, edition_asserted_by, source, acquired_on FROM public.card_copies WHERE id = $1",
        [copies[0]],
      );
    expect(row.edition).toBe("platinum");
    expect(row.edition_asserted_by).toBe("client");
    expect(row.source).toBe("market");
    // Cleared, or a buyer who pulled this card today collides on
    // card_copies_one_pull_per_day and the whole sale aborts.
    expect(row.acquired_on).toBeNull();

    // And it still mills at the flat floor for its new owner — who needs a second
    // copy first, because the spare rule binds them exactly as it bound Alice.
    await holdCopies(IDS.bob, ids[0], 1, "standard");
    const [mill] = await sql<{ mill_card_copy: { awarded: number } }>(
      "SELECT public.mill_card_copy($1, $2)",
      [IDS.bob, copies[0]],
    );
    expect(mill.mill_card_copy.awarded).toBe(5);
  });

  it("lets a copy pulled today be bought by somebody who pulled the same card today", async () => {
    // The acquired_on clear, from the other side: without it this is a unique
    // violation on card_copies_one_pull_per_day and the sale raises.
    const ids = await cardIds();
    await sql(
      `INSERT INTO public.card_copies (participant_id, event_participant_id, acquired_on, source)
       VALUES ($1, $2, ${NY}, 'pull'), ($1, $2, NULL, 'trade'), ($3, $2, ${NY}, 'pull')`,
      [IDS.alice, ids[0], IDS.bob],
    );
    await sql("SELECT public.resync_card_pull($1, $2)", [IDS.alice, ids[0]]);
    await sql("SELECT public.resync_card_pull($1, $2)", [IDS.bob, ids[0]]);
    await credit(200, IDS.bob);
    const [todays] = await sql<{ id: string }>(
      `SELECT id FROM public.card_copies
        WHERE participant_id = $1 AND source = 'pull' AND acquired_on = ${NY}`,
      [IDS.alice],
    );
    const res = await list(IDS.alice, { copyId: todays.id, price: 10 });
    expect((await buy(IDS.bob, res.listingId!)).ok).toBe(true);
    expect(await copyCount(IDS.bob, ids[0])).toBe(2);
  });

  it("refuses your own listing", async () => {
    const { listingId } = await shelf();
    await credit(500, IDS.alice);
    expect(await buy(IDS.alice, listingId)).toMatchObject({ ok: false, reason: "own_listing" });
    expect(await statusOf(listingId)).toBe("active");
  });

  it("refuses an empty wallet without moving anything", async () => {
    const ids = await cardIds();
    const [spare] = await holdCopies(IDS.alice, ids[0], 2);
    await credit(50, IDS.bob);
    const res = await list(IDS.alice, { copyId: spare, price: 400 });
    expect(await buy(IDS.bob, res.listingId!)).toMatchObject({
      ok: false,
      reason: "insufficient",
      balance: 50,
      price: 400,
    });
    expect(await balance(IDS.bob)).toBe(50);
    expect(await copyCount(IDS.bob, ids[0])).toBe(0);
    expect(await statusOf(res.listingId!)).toBe("active");
  });

  it("voids a listing whose card has since moved, rather than raising", async () => {
    // A raise would roll the transaction back and the void with it, leaving the
    // listing active and the same failure waiting on every retry.
    const { listingId, copyId, cardId } = await shelf();
    // Alice mills her OTHER copy, so the listed one is now her last.
    const [other] = await sql<{ id: string }>(
      "SELECT id FROM public.card_copies WHERE participant_id = $1 AND id <> $2",
      [IDS.alice, copyId],
    );
    await sql("SELECT public.mill_card_copy($1, $2)", [IDS.alice, other.id]);

    expect(await buy(IDS.bob, listingId)).toMatchObject({ ok: false, reason: "voided" });
    expect(await statusOf(listingId)).toBe("voided");
    expect(await copyCount(IDS.alice, cardId)).toBe(1);
    expect(await packedBy(cardId)).toBe(1);
  });

  it("answers a retry of a successful buy with the sale it already made", async () => {
    // THE REPLAY CHECK SITS ABOVE THE STATUS CHECK, and this is why. A retry finds
    // the listing already 'sold' — sold to this very caller — so the wrong order
    // would answer somebody's own purchase with a refusal and leave them looking
    // for the dust they spent.
    const { listingId } = await shelf(120, 500);
    const first = await buy(IDS.bob, listingId, REQ("7"));
    expect(first.ok).toBe(true);

    const again = await buy(IDS.bob, listingId, REQ("7"));
    expect(again).toEqual(first);
    expect(await balance(IDS.bob)).toBe(380);
    const [row] = await sql<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.dust_ledger WHERE reason = 'market_buy'",
    );
    expect(row.n).toBe(1);
  });

  it("answers a fresh tap on a sold listing with resolved", async () => {
    const { listingId } = await shelf(120, 500);
    await buy(IDS.bob, listingId, REQ("7"));
    expect(await buy(IDS.carol, listingId, REQ("8"))).toMatchObject({
      ok: false,
      reason: "resolved",
    });
  });

  it("refuses a cancelled listing", async () => {
    const { listingId } = await shelf();
    await cancel(IDS.alice, listingId);
    expect(await buy(IDS.bob, listingId)).toMatchObject({ ok: false, reason: "resolved" });
  });
});

describe("buying a secret", () => {
  it("arrives granted, so it cannot pass for the buyer's own daily pull", async () => {
    // secret_card_pulls_one_per_day is UNIQUE (participant_id, pulled_on) WHERE
    // NOT granted. Leave granted false and re-parenting aborts the sale whenever
    // the buyer already pulled that day — and a bought card would masquerade as
    // their unspent slot.
    const { pullId } = await heldSecret(IDS.alice, "mythic-thing", "mythic");
    await credit(500, IDS.bob);
    const res = await list(IDS.alice, { pullId, price: 300 });
    const bought = await buy(IDS.bob, res.listingId!);
    expect(bought.ok).toBe(true);
    expect(bought.duplicate).toBe(false);

    const [row] =
      await sql<{ participant_id: string; granted: boolean; is_duplicate: boolean; tier: string }>( // prettier-ignore
        "SELECT participant_id, granted, is_duplicate, tier FROM public.secret_card_pulls WHERE id = $1",
        [pullId],
      );
    expect(row).toMatchObject({ participant_id: IDS.bob, granted: true, is_duplicate: false, tier: "mythic" }); // prettier-ignore
  });

  it("arrives as a duplicate when the buyer already owns the card", async () => {
    const { pullId, cardId } = await heldSecret(IDS.alice, "shared");
    await sql(
      `INSERT INTO public.secret_card_pulls
         (participant_id, secret_card_id, pulled_on, event_id, is_duplicate, granted, tier)
       VALUES ($1, $2, ${NY} - 2, $3, false, true, 'common')`,
      [IDS.bob, cardId, IDS.event],
    );
    await credit(500, IDS.bob);
    const res = await list(IDS.alice, { pullId, price: 30 });
    expect((await buy(IDS.bob, res.listingId!)).duplicate).toBe(true);
    const [row] = await sql<{ is_duplicate: boolean }>(
      "SELECT is_duplicate FROM public.secret_card_pulls WHERE id = $1",
      [pullId],
    );
    expect(row.is_duplicate).toBe(true);
  });

  it("leaves the seller owning none of it when it was their only copy", async () => {
    const { pullId, cardId } = await heldSecret(IDS.alice, "only-one");
    await credit(500, IDS.bob);
    const res = await list(IDS.alice, { pullId, price: 30 });
    await buy(IDS.bob, res.listingId!);
    const [row] = await sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.secret_card_pulls
        WHERE participant_id = $1 AND secret_card_id = $2`,
      [IDS.alice, cardId],
    );
    expect(row.n).toBe(0);
  });

  it("cannot hand the seller a second daily pull", async () => {
    // pull -> list -> sell -> pull. The buy sets granted = true on the row it
    // moves, so if today's un-granted pull were listable the seller's own
    // "have I pulled today" search would find nothing afterwards.
    await seedSecret("a");
    await seedSecret("b");
    const first = await sql<{ pull_secret_card: { pullId: string } }>(
      "SELECT public.pull_secret_card($1, NULL, $2)",
      [IDS.alice, IDS.event],
    );
    const pullId = first[0].pull_secret_card.pullId;
    expect(await list(IDS.alice, { pullId })).toMatchObject({ ok: false, reason: "too_fresh" });

    // And the slot is still spent: a second pull today grants nothing new.
    const second = await sql<{ pull_secret_card: { ok?: boolean; pullId?: string } }>(
      "SELECT public.pull_secret_card($1, NULL, $2)",
      [IDS.alice, IDS.event],
    );
    expect(second[0].pull_secret_card.pullId).toBe(pullId);
  });

  it("mints a trophy for a set the buyer just completed", async () => {
    const { pullId } = await heldSecret(IDS.alice, "set-closer", "epic", "the-set");
    await credit(500, IDS.bob);
    const res = await list(IDS.alice, { pullId, price: 60 });
    const bought = await buy(IDS.bob, res.listingId!);
    expect(bought.completedCollection).toBeTruthy();
    const [row] = await sql<{ participant_id: string; via: string }>(
      "SELECT participant_id, via FROM public.collection_trophies",
    );
    // 'trade' rather than a sixth rung on the append-only vocabulary: a purchase
    // is a card changing hands between two members.
    expect(row).toMatchObject({ participant_id: IDS.bob, via: "trade" });
  });
});

describe("a listed card is spoken for", () => {
  it("cannot be milled", async () => {
    const { copyId } = await shelf();
    const [row] = await sql<{ mill_card_copy: { ok: boolean; reason: string } }>(
      "SELECT public.mill_card_copy($1, $2)",
      [IDS.alice, copyId],
    );
    expect(row.mill_card_copy).toMatchObject({ ok: false, reason: "staked" });
  });

  it("cannot be re-rolled", async () => {
    const { copyId } = await shelf();
    await credit(500, IDS.alice);
    const [row] = await sql<{ reroll_copy_edition: { ok: boolean; reason: string } }>(
      "SELECT public.reroll_copy_edition($1, $2, $3)",
      [IDS.alice, copyId, REQ("3")],
    );
    expect(row.reroll_copy_edition).toMatchObject({ ok: false, reason: "staked" });
  });

  it("cannot be sold to the house", async () => {
    const { pullId } = await heldSecret(IDS.alice);
    await list(IDS.alice, { pullId, price: 30 });
    const [row] = await sql<{ sell_secret_card: { ok: boolean; reason: string } }>(
      "SELECT public.sell_secret_card($1, $2)",
      [IDS.alice, pullId],
    );
    expect(row.sell_secret_card).toMatchObject({ ok: false, reason: "staked" });
  });

  it("burns, re-rolls and sells freely once the listing comes down", async () => {
    const { copyId, listingId } = await shelf();
    await cancel(IDS.alice, listingId);
    const [row] = await sql<{ mill_card_copy: { ok: boolean } }>(
      "SELECT public.mill_card_copy($1, $2)",
      [IDS.alice, copyId],
    );
    expect(row.mill_card_copy.ok).toBe(true);
  });
});

describe("two people at once", () => {
  it("lets exactly one of two buyers have the listing", async () => {
    const { listingId } = await shelf(100, 0);
    await credit(500, IDS.bob);
    await credit(500, IDS.carol);
    const one = await newClient();
    const two = await newClient();
    try {
      const results = await Promise.all([
        one.query("SELECT public.buy_market_listing($1, $2, $3) AS r", [IDS.bob, listingId, REQ("a")]), // prettier-ignore
        two.query("SELECT public.buy_market_listing($1, $2, $3) AS r", [IDS.carol, listingId, REQ("b")]), // prettier-ignore
      ]);
      const answers = results.map((r) => r.rows[0].r as { ok: boolean; reason?: string });
      expect(answers.filter((a) => a.ok)).toHaveLength(1);
      expect(answers.filter((a) => a.reason === "resolved")).toHaveLength(1);
    } finally {
      await one.end();
      await two.end();
    }
    const [row] = await sql<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.dust_ledger WHERE reason = 'market_buy'",
    );
    expect(row.n).toBe(1);
  });

  it("never lets two sales take a seller's last copy", async () => {
    // THE SELLER LOCK, and the reason it is not politeness. Two listings of one
    // pair are refused at listing time, so this forces them in directly — which is
    // the state a pre-guard race could produce — and proves the buy path holds.
    const ids = await cardIds();
    const [a, b] = await holdCopies(IDS.alice, ids[0], 2);
    await credit(500, IDS.bob);
    await credit(500, IDS.carol);
    const rows = await sql<{ id: string }>(
      `INSERT INTO public.market_listings (event_id, seller_id, kind, card_copy_id, price)
       VALUES ($1, $2, 'roster', $3, 10), ($1, $2, 'roster', $4, 10) RETURNING id`,
      [IDS.event, IDS.alice, a, b],
    );

    const one = await newClient();
    const two = await newClient();
    try {
      const results = await Promise.all([
        one.query("SELECT public.buy_market_listing($1, $2, $3) AS r", [IDS.bob, rows[0].id, REQ("c")]), // prettier-ignore
        two.query("SELECT public.buy_market_listing($1, $2, $3) AS r", [IDS.carol, rows[1].id, REQ("d")]), // prettier-ignore
      ]);
      const answers = results.map((r) => r.rows[0].r as { ok: boolean; reason?: string });
      expect(answers.filter((a) => a.ok)).toHaveLength(1);
      expect(answers.filter((a) => a.reason === "voided")).toHaveLength(1);
    } finally {
      await one.end();
      await two.end();
    }

    // The whole point: Alice still holds one, so the public count did not move.
    expect(await copyCount(IDS.alice, ids[0])).toBe(1);
    expect(await packedBy(ids[0])).toBe(2);
  });

  it("does not deadlock against a trade between the same two people", async () => {
    // buy takes market_listings then both participants sorted; accept_trade_offer
    // takes trade_offers then the same sorted pair. Disjoint at the top, so one
    // queues behind the other rather than cycling.
    const ids = await cardIds();
    await claimMember(IDS.alice);
    await claimMember(IDS.bob);
    const [aliceSpare, aliceOther] = await holdCopies(IDS.alice, ids[0], 3);
    const bobCopies = await holdCopies(IDS.bob, ids[1], 3);
    await credit(500, IDS.bob);
    const listing = await list(IDS.alice, { copyId: aliceSpare, price: 10 });

    const offer = await sql<{ create_trade_offer: { offerId: string } }>(
      "SELECT public.create_trade_offer($1, $2, $3, $4::jsonb, $5::jsonb)",
      [
        IDS.bob,
        IDS.alice,
        IDS.event,
        JSON.stringify([{ kind: "roster", cardCopyId: bobCopies[0] }]),
        // Alice's card, not a second of Bob's — create_trade_offer refuses an
        // offer whose want side is not the recipient's.
        JSON.stringify([{ kind: "roster", cardCopyId: aliceOther }]),
      ],
    );

    const one = await newClient();
    const two = await newClient();
    try {
      const results = await Promise.all([
        one.query("SELECT public.buy_market_listing($1, $2, $3) AS r", [IDS.bob, listing.listingId, REQ("e")]), // prettier-ignore
        two.query("SELECT public.accept_trade_offer($1, $2) AS r", [offer[0].create_trade_offer.offerId, IDS.alice]), // prettier-ignore
      ]);
      // Neither raised, which is the assertion — a deadlock surfaces as a thrown
      // "deadlock detected" out of Promise.all rather than as a false answer.
      expect(results).toHaveLength(2);
    } finally {
      await one.end();
      await two.end();
    }
  });
});

describe("while the switch is off", () => {
  it("refuses to list or buy, and touches nothing", async () => {
    const { listingId } = await shelf(100, 500);
    const ids = await cardIds();
    const [spare] = await holdCopies(IDS.alice, ids[1], 2);
    await sql("UPDATE public.events SET dust_enabled = false");

    expect(await list(IDS.alice, { copyId: spare })).toMatchObject({
      ok: false,
      reason: "disabled",
    });
    expect(await buy(IDS.bob, listingId)).toMatchObject({ ok: false, reason: "disabled" });
    expect(await balance(IDS.bob)).toBe(500);
    expect(await statusOf(listingId)).toBe("active");
    const [row] = await sql<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.dust_ledger WHERE reason LIKE 'market%'",
    );
    expect(row.n).toBe(0);
  });
});
