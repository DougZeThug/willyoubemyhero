// The dust economy, against real Postgres.
//
// Two properties live here and nowhere else. A balance can never go negative,
// which no CHECK can enforce because the invariant is over a sum rather than a
// row — the participant row lock is the whole guard, so the concurrency test is
// the one that matters most. And dust cannot be minted faster than the game hands
// it out: the mill rules, not the prices, are what keep the sinks meaningful.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, isDenied, IDS, newClient, seedEvent, sql } from "./helpers";
import { MILL_BY_EDITION, MILL_CLIENT_FLAT, DUPE_SECRET_CREDIT, DUST_PRICES } from "../../src/lib/dust"; // prettier-ignore

afterAll(closeDb);
beforeEach(seedEvent);

const GUEST = "99999999-9999-4999-8999-999999999999";

/**
 * The league day, as the RPCs see it.
 *
 * Every function here runs under SET timezone = 'America/New_York' while this
 * session is UTC, so a test that writes `current_date` is writing tomorrow's NY
 * date for five hours every evening — and mill_card_copy would answer `too_fresh`
 * for a copy the test meant to be yesterday's.
 */
const NY = `(now() AT TIME ZONE 'America/New_York')::date`;

async function cardIds(): Promise<string[]> {
  const rows = await sql<{ id: string }>(
    "SELECT id FROM public.event_participants ORDER BY running_order",
  );
  return rows.map((r) => r.id);
}

async function seedSecret(name: string) {
  const [row] = await sql<{ id: string }>(
    `INSERT INTO public.secret_cards (name, art_path, active)
     VALUES ($1, $2, true) RETURNING id`,
    [name, `secrets/${name}/art-1.webp`],
  );
  return row.id;
}

async function balance(participantId = IDS.alice): Promise<number> {
  const [row] = await sql<{ b: number }>("SELECT public.dust_balance($1) AS b", [participantId]);
  return row.b;
}

type Pull = { duplicate: boolean; dust: number | null; pullId: string };
async function pullSecret(participantId: string | null, guestId: string | null = null) {
  const [row] = await sql<{ pull_secret_card: Pull }>(
    "SELECT public.pull_secret_card($1, $2, $3)",
    [participantId, guestId, IDS.event],
  );
  return row.pull_secret_card;
}

/** Pretend every pull and copy on file happened `days` ago. */
async function rewindDay(days = 1) {
  await sql("UPDATE public.secret_card_pulls SET pulled_on = pulled_on - $1::int", [days]);
  await sql("UPDATE public.card_copies SET acquired_on = acquired_on - $1::int WHERE source = 'pull'", [days]); // prettier-ignore
}

/** Two copies of one card, the older one millable. Returns the spare's id. */
async function twoCopies(edition = "gold", assertedBy = "server") {
  const ids = await cardIds();
  const [spare] = await sql<{ id: string }>(
    `INSERT INTO public.card_copies
       (participant_id, event_participant_id, edition, acquired_on, source, edition_asserted_by)
     VALUES ($1, $2, $3, ${NY} - 1, 'pull', $4) RETURNING id`,
    [IDS.alice, ids[0], edition, assertedBy],
  );
  await sql(
    `INSERT INTO public.card_copies
       (participant_id, event_participant_id, edition, acquired_on, source, edition_asserted_by)
     VALUES ($1, $2, 'standard', ${NY}, 'pull', 'server')`,
    [IDS.alice, ids[0]],
  );
  await sql("SELECT public.resync_card_pull($1, $2)", [IDS.alice, ids[0]]);
  return { spareId: spare.id, cardId: ids[0] };
}

type MillResult = { ok: boolean; reason?: string; awarded?: number; balance?: number };
async function mill(copyId: string, participantId = IDS.alice): Promise<MillResult> {
  const [row] = await sql<{ mill_card_copy: MillResult }>("SELECT public.mill_card_copy($1, $2)", [
    participantId,
    copyId,
  ]);
  return row.mill_card_copy;
}

async function credit(amount: number, participantId = IDS.alice) {
  await sql(
    `INSERT INTO public.dust_ledger (participant_id, delta, reason) VALUES ($1, $2, 'admin_adjust')`,
    [participantId, amount],
  );
}

describe("dust_ledger", () => {
  it("is unreachable with the publishable key, table and functions alike", async () => {
    // isDenied counts any error as a denial, so a positive control for each of
    // these lives further down — otherwise a renamed function would keep passing
    // here while guarding nothing.
    for (const role of ["anon", "authenticated"] as const) {
      expect(await isDenied(role, "SELECT * FROM public.dust_ledger")).toBe(true);
      expect(await isDenied(role, "SELECT public.dust_balance($1)", [IDS.alice])).toBe(true);
      expect(await isDenied(role, "SELECT public.mill_card_copy($1, $2)", [IDS.alice, IDS.bob])).toBe(true); // prettier-ignore
      expect(await isDenied(role, "SELECT public.buy_bonus_secret_pull($1, $2, $3)", [IDS.alice, IDS.event, IDS.bob])).toBe(true); // prettier-ignore
      expect(await isDenied(role, "SELECT public.reroll_copy_edition($1, $2, $3)", [IDS.alice, IDS.bob, IDS.carol])).toBe(true); // prettier-ignore
    }
  });

  it("is reachable by service_role, which is what makes the revoke meaningful", async () => {
    expect(await balance()).toBe(0);
  });

  it("refuses a zero movement", async () => {
    await expect(credit(0)).rejects.toThrow();
  });

  it("refuses a reason the payout rules do not know", async () => {
    await expect(
      sql(
        `INSERT INTO public.dust_ledger (participant_id, delta, reason) VALUES ($1, 5, 'vibes')`,
        [IDS.alice],
      ),
    ).rejects.toThrow();
  });

  it("sums signed movements rather than storing a total", async () => {
    await credit(25);
    await credit(-10);
    expect(await balance()).toBe(15);
  });

  it("takes somebody's dust with them when they leave the league", async () => {
    await credit(25);
    await sql("DELETE FROM public.participants WHERE id = $1", [IDS.alice]);
    expect(await sql("SELECT count(*)::int AS n FROM public.dust_ledger")).toEqual([{ n: 0 }]);
  });
});

describe("mill_value", () => {
  it("mirrors the ladder in src/lib/dust.ts", async () => {
    // The TS side is what the shop prints. Two numbers that disagree would have
    // the sheet promise one payout and the ledger file another.
    for (const [edition, expected] of Object.entries(MILL_BY_EDITION)) {
      const [row] = await sql<{ v: number }>("SELECT public.mill_value($1) AS v", [edition]);
      expect(row.v, edition).toBe(expected);
    }
  });

  it("pays the floor for a finish it does not recognise, rather than raising", async () => {
    // card_edition_rank answers 99 for an unknown value and ARRAY[...][99] is
    // NULL. Inside a payout that has to land on the floor, not on an exception.
    const [row] = await sql<{ v: number }>("SELECT public.mill_value('mythic') AS v");
    expect(row.v).toBe(MILL_CLIENT_FLAT);
  });
});

describe("the dupe credit", () => {
  it("pays a member for a duplicate secret", async () => {
    await seedSecret("only-card");
    const first = await pullSecret(IDS.alice);
    expect(first.duplicate).toBe(false);
    expect(first.dust).toBe(0);
    expect(await balance()).toBe(0);

    // One card in the pool, so tomorrow's pull can only be a duplicate.
    await rewindDay(1);
    const second = await pullSecret(IDS.alice);
    expect(second.duplicate).toBe(true);
    expect(second.dust).toBe(DUPE_SECRET_CREDIT);
    expect(await balance()).toBe(DUPE_SECRET_CREDIT);
  });

  it("pays once however many times the day's pull is re-asked for", async () => {
    // The client fires this on a reveal that can re-run. The early return for a
    // day already pulled is the idempotence, and the unique index is the backstop.
    await seedSecret("only-card");
    await pullSecret(IDS.alice);
    await rewindDay(1);
    await pullSecret(IDS.alice);
    for (let i = 0; i < 5; i++) {
      const again = await pullSecret(IDS.alice);
      // Null rather than zero: the credit happened, on the call that made the row.
      expect(again.dust).toBeNull();
    }
    expect(await balance()).toBe(DUPE_SECRET_CREDIT);
  });

  it("pays a guest nothing, because dust starts at the claim", async () => {
    await seedSecret("only-card");
    await pullSecret(null, GUEST);
    await rewindDay(1);
    const dupe = await pullSecret(null, GUEST);
    expect(dupe.duplicate).toBe(true);
    expect(dupe.dust).toBe(0);
    expect(await sql("SELECT count(*)::int AS n FROM public.dust_ledger")).toEqual([{ n: 0 }]);
  });
});

describe("mill_card_copy", () => {
  it("pays by edition for a finish the server decided", async () => {
    const { spareId } = await twoCopies("gold", "server");
    const res = await mill(spareId);
    expect(res.ok).toBe(true);
    expect(res.awarded).toBe(MILL_BY_EDITION.gold);
    expect(await balance()).toBe(MILL_BY_EDITION.gold);
  });

  it("pays the flat floor for a finish a phone asserted", async () => {
    // The whole reason edition_asserted_by exists. A hand-filed platinum is worth
    // five, which is what makes forging one pointless.
    const { spareId } = await twoCopies("platinum", "client");
    const res = await mill(spareId);
    expect(res.ok).toBe(true);
    expect(res.awarded).toBe(MILL_CLIENT_FLAT);
  });

  it("refuses your last copy of a card", async () => {
    const ids = await cardIds();
    const [only] = await sql<{ id: string }>(
      `INSERT INTO public.card_copies (participant_id, event_participant_id, acquired_on, source)
       VALUES ($1, $2, ${NY} - 1, 'pull') RETURNING id`,
      [IDS.alice, ids[0]],
    );
    await sql("SELECT public.resync_card_pull($1, $2)", [IDS.alice, ids[0]]);
    expect(await mill(only.id)).toMatchObject({ ok: false, reason: "last_copy" });
  });

  it("refuses today's own pull, which is what closes the mint-and-mill loop", async () => {
    // Milling today's copy frees its slot in record_card_pulls' daily cap AND
    // clears its key on the once-a-day index, so the pack could be recorded again
    // to mint a replacement and the copy milled again, for dust, forever.
    const ids = await cardIds();
    await sql(
      `INSERT INTO public.card_copies (participant_id, event_participant_id, acquired_on, source)
       VALUES ($1, $2, ${NY} - 1, 'pull'), ($1, $2, ${NY}, 'pull')`,
      [IDS.alice, ids[0]],
    );
    const [today] = await sql<{ id: string }>(
      `SELECT id FROM public.card_copies
        WHERE participant_id = $1 AND acquired_on = ${NY}`,
      [IDS.alice],
    );
    expect(await mill(today.id)).toMatchObject({ ok: false, reason: "too_fresh" });
  });

  it("refuses a copy somebody has already been offered", async () => {
    const { spareId } = await twoCopies();
    const [offer] = await sql<{ id: string }>(
      `INSERT INTO public.trade_offers (event_id, proposer_id, recipient_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [IDS.event, IDS.alice, IDS.bob],
    );
    await sql(
      `INSERT INTO public.trade_offer_items (offer_id, giver_side, kind, card_copy_id)
       VALUES ($1, 'proposer', 'roster', $2)`,
      [offer.id, spareId],
    );
    expect(await mill(spareId)).toMatchObject({ ok: false, reason: "staked" });
    expect(await balance()).toBe(0);
  });

  it("refuses a copy that is not yours", async () => {
    const { spareId } = await twoCopies();
    expect(await mill(spareId, IDS.bob)).toMatchObject({ ok: false, reason: "not_yours" });
  });

  it("leaves the public count alone and drops the private one", async () => {
    // "Packed by N" is the ROW count in card_pulls — one row per person per card
    // — and the spare rule guarantees a copy survives, so the row does too.
    const { spareId, cardId } = await twoCopies();
    await mill(spareId);
    const [row] = await sql<{ pull_count: number }>(
      "SELECT pull_count FROM public.card_pulls WHERE participant_id = $1 AND event_participant_id = $2", // prettier-ignore
      [IDS.alice, cardId],
    );
    expect(row.pull_count).toBe(1);
    const [people] = await sql<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.card_pulls WHERE event_participant_id = $1",
      [cardId],
    );
    expect(people.n).toBe(1);
  });

  it("recomputes the best finish once the best copy is gone", async () => {
    // card_pulls.edition is derived from the copies, so milling your gold has to
    // take the advertised finish down with it.
    const { spareId, cardId } = await twoCopies("gold", "server");
    const [before] = await sql<{ edition: string }>(
      "SELECT edition FROM public.card_pulls WHERE participant_id = $1 AND event_participant_id = $2", // prettier-ignore
      [IDS.alice, cardId],
    );
    expect(before.edition).toBe("gold");
    await mill(spareId);
    const [after] = await sql<{ edition: string }>(
      "SELECT edition FROM public.card_pulls WHERE participant_id = $1 AND event_participant_id = $2", // prettier-ignore
      [IDS.alice, cardId],
    );
    expect(after.edition).toBe("standard");
  });

  it("cannot be paid twice for one copy", async () => {
    const { spareId } = await twoCopies();
    await mill(spareId);
    expect(await mill(spareId)).toMatchObject({ ok: false });
    expect(await balance()).toBe(MILL_BY_EDITION.gold);
  });
});

describe("buy_bonus_secret_pull", () => {
  const REQ = "aaaaaaaa-0000-4000-8000-000000000001";

  async function buy(requestId = REQ, participantId = IDS.alice) {
    const [row] = await sql<{ buy_bonus_secret_pull: Record<string, unknown> }>(
      "SELECT public.buy_bonus_secret_pull($1, $2, $3)",
      [participantId, IDS.event, requestId],
    );
    return row.buy_bonus_secret_pull;
  }

  it("refuses a balance that cannot cover it, and files nothing", async () => {
    await seedSecret("a-card");
    await credit(DUST_PRICES.bonusPull - 1);
    expect(await buy()).toMatchObject({ ok: false, reason: "insufficient" });
    expect(await balance()).toBe(DUST_PRICES.bonusPull - 1);
  });

  it("debits and hands over a pull", async () => {
    await seedSecret("a-card");
    await credit(DUST_PRICES.bonusPull);
    const res = await buy();
    expect(res).toMatchObject({ ok: true, price: DUST_PRICES.bonusPull });
    expect(await balance()).toBe(0);
    expect(await sql("SELECT count(*)::int AS n FROM public.secret_card_pulls")).toEqual([
      { n: 1 },
    ]);
  });

  it("answers a repeated tap with the pull it already bought", async () => {
    // A lost response on a 150-dust purchase is the worst bug in this release.
    await seedSecret("a-card");
    await credit(DUST_PRICES.bonusPull);
    const first = await buy();
    const again = await buy();
    expect(again).toEqual(first);
    expect(await balance()).toBe(0);
    expect(await sql("SELECT count(*)::int AS n FROM public.secret_card_pulls")).toEqual([
      { n: 1 },
    ]);
  });

  it("leaves the free daily pull alone, and cannot be doubled by it", async () => {
    // The bought pull is inserted granted = true, which is what sidesteps the
    // daily unique index by design. The free pull still gets exactly one row.
    await seedSecret("a-card");
    await credit(DUST_PRICES.bonusPull);
    await buy();
    const free = await pullSecret(IDS.alice);
    expect(free.duplicate).toBe(true);
    const [granted] = await sql<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.secret_card_pulls WHERE granted",
    );
    expect(granted.n).toBe(1);
    // And the free one still cannot fire twice.
    await pullSecret(IDS.alice);
    const [free_rows] = await sql<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.secret_card_pulls WHERE NOT granted",
    );
    expect(free_rows.n).toBe(1);
  });

  it("never lets two concurrent buys overdraw", async () => {
    // THE TEST THAT MATTERS. No CHECK can enforce this — the invariant is over a
    // sum — so the participant row lock is the entire guard, and a balance read
    // moved above it would let both callers see the same number and both spend.
    await seedSecret("a-card");
    await credit(DUST_PRICES.bonusPull + 50);

    const one = await newClient();
    const two = await newClient();
    try {
      const results = await Promise.all([
        one.query("SELECT public.buy_bonus_secret_pull($1, $2, $3) AS r", [IDS.alice, IDS.event, "aaaaaaaa-0000-4000-8000-00000000000a"]), // prettier-ignore
        two.query("SELECT public.buy_bonus_secret_pull($1, $2, $3) AS r", [IDS.alice, IDS.event, "aaaaaaaa-0000-4000-8000-00000000000b"]), // prettier-ignore
      ]);
      const oks = results.map((r) => r.rows[0].r as { ok: boolean }).filter((r) => r.ok);
      expect(oks).toHaveLength(1);
      expect(await balance()).toBe(50);
    } finally {
      await one.end();
      await two.end();
    }
  });

  it("says so rather than raising when the pool is empty", async () => {
    await credit(DUST_PRICES.bonusPull);
    expect(await buy()).toMatchObject({ ok: false, reason: "unavailable" });
    expect(await balance()).toBe(DUST_PRICES.bonusPull);
  });

  it("mints a trophy for the set it finishes", async () => {
    // The repair. pull_bonus_secret_card never called award_collection_trophy, so
    // a milestone that completed a set minted nothing — and spending 150 dust on
    // the card that finishes yours would have done the same.
    await sql(
      `INSERT INTO public.secret_collections (id, label) VALUES ('set-a', 'Set A')
       ON CONFLICT DO NOTHING`,
    );
    await seedSecret("only-card");
    await sql(`UPDATE public.secret_cards SET collection = 'set-a'`);
    await credit(DUST_PRICES.bonusPull);
    const res = (await buy()) as { pull: { completedCollection: unknown } };
    expect(res.pull.completedCollection).not.toBeNull();
    expect(await sql("SELECT count(*)::int AS n FROM public.collection_trophies")).toEqual([
      { n: 1 },
    ]);
  });
});

describe("reroll_copy_edition", () => {
  const REQ = "bbbbbbbb-0000-4000-8000-000000000001";

  async function reroll(copyId: string, requestId = REQ, participantId = IDS.alice) {
    const [row] = await sql<{ reroll_copy_edition: Record<string, unknown> }>(
      "SELECT public.reroll_copy_edition($1, $2, $3)",
      [participantId, copyId, requestId],
    );
    return row.reroll_copy_edition;
  }

  it("refuses a balance that cannot cover it", async () => {
    const { spareId } = await twoCopies();
    await credit(DUST_PRICES.reroll - 1);
    expect(await reroll(spareId)).toMatchObject({ ok: false, reason: "insufficient" });
  });

  it("debits, replaces the finish and marks it server-decided", async () => {
    const { spareId } = await twoCopies("gold", "client");
    await credit(DUST_PRICES.reroll);
    const res = (await reroll(spareId)) as { ok: boolean; from: string };
    expect(res.ok).toBe(true);
    expect(res.from).toBe("gold");
    expect(await balance()).toBe(0);
    const [row] = await sql<{ edition_asserted_by: string }>(
      "SELECT edition_asserted_by FROM public.card_copies WHERE id = $1",
      [spareId],
    );
    // A re-roll launders a client row into a server one, which is what converges
    // the fleet onto trusted finishes. It is not an exploit: the flat floor is 5
    // and the expected value of a server roll is 8.8, against a 50 dust price.
    expect(row.edition_asserted_by).toBe("server");
  });

  it("can go down, because a best-of would be a risk-free ratchet", async () => {
    // Statistical, not deterministic: seven rolls in ten are standard, so across
    // enough re-rolls of a platinum at least one has to come back worse. A
    // best-of implementation makes this loop forever.
    const { spareId } = await twoCopies("platinum", "server");
    await credit(DUST_PRICES.reroll * 40);
    let wentDown = false;
    for (let i = 0; i < 40 && !wentDown; i++) {
      await sql(`UPDATE public.card_copies SET edition = 'platinum' WHERE id = $1`, [spareId]);
      const res = (await reroll(spareId, `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, "0")}`)) as { to: string }; // prettier-ignore
      wentDown = res.to !== "platinum";
    }
    expect(wentDown).toBe(true);
  });

  it("answers a repeated tap with the roll it already paid for", async () => {
    const { spareId } = await twoCopies();
    await credit(DUST_PRICES.reroll);
    const first = await reroll(spareId);
    expect(await reroll(spareId)).toEqual(first);
    expect(await balance()).toBe(0);
  });

  it("refuses a copy somebody has already been offered", async () => {
    // Sharper than mill's version: a re-roll deletes nothing, so the counterparty
    // would simply receive a different finish than the offer showed them.
    const { spareId } = await twoCopies();
    await credit(DUST_PRICES.reroll);
    const [offer] = await sql<{ id: string }>(
      `INSERT INTO public.trade_offers (event_id, proposer_id, recipient_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [IDS.event, IDS.alice, IDS.bob],
    );
    await sql(
      `INSERT INTO public.trade_offer_items (offer_id, giver_side, kind, card_copy_id)
       VALUES ($1, 'proposer', 'roster', $2)`,
      [offer.id, spareId],
    );
    expect(await reroll(spareId)).toMatchObject({ ok: false, reason: "staked" });
    expect(await balance()).toBe(DUST_PRICES.reroll);
  });

  it("refuses a copy that is not yours", async () => {
    const { spareId } = await twoCopies();
    await credit(DUST_PRICES.reroll, IDS.bob);
    expect(await reroll(spareId, REQ, IDS.bob)).toMatchObject({ ok: false, reason: "not_yours" });
  });

  it("recomputes the derived finish", async () => {
    const { spareId, cardId } = await twoCopies("gold", "server");
    await credit(DUST_PRICES.reroll);
    await reroll(spareId);
    const [copies] = await sql<{ best: string }>(
      `SELECT edition AS best FROM public.card_copies
        WHERE participant_id = $1 AND event_participant_id = $2
        ORDER BY public.card_edition_rank(edition) ASC LIMIT 1`,
      [IDS.alice, cardId],
    );
    const [derived] = await sql<{ edition: string }>(
      "SELECT edition FROM public.card_pulls WHERE participant_id = $1 AND event_participant_id = $2", // prettier-ignore
      [IDS.alice, cardId],
    );
    expect(derived.edition).toBe(copies.best);
  });
});
