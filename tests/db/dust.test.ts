// The dust economy, against real Postgres.
//
// Three properties live here and nowhere else. A balance can never go negative,
// which no CHECK can enforce because the invariant is over a sum rather than a
// row — the participant row lock is the whole guard, so the concurrency test is
// the one that matters most. Dust cannot be minted faster than the game hands
// it out: the mill and sale rules, not the prices, are what keep the sinks
// meaningful. And no sale may buy back a daily pull — pull, sell, pull is the
// one sequence that would print dust forever, and `sell_secret_card`'s
// `too_fresh` guard is the only thing standing in front of it.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, isDenied, IDS, newClient, seedEvent, sql } from "./helpers";
import { MILL_BY_EDITION, MILL_CLIENT_FLAT, SELL_BY_SECRET_TIER, DUST_PRICES } from "../../src/lib/dust"; // prettier-ignore

afterAll(closeDb);
beforeEach(async () => {
  await seedEvent();
  // Dust ships switched OFF — 20260828120000 defaults events.dust_enabled to
  // false, which is what makes deploying it a no-op. Every test below is about
  // what the economy does once somebody turns it on, so the fixture turns it on;
  // the "while the switch is off" block at the bottom is the other half.
  await sql("UPDATE public.events SET dust_enabled = true");
});

/** Put the switch back where production has it. */
async function switchOff() {
  await sql("UPDATE public.events SET dust_enabled = false");
}

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

type Pull = { duplicate: boolean; pullId: string; tier: string };
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
  await sql(
    "UPDATE public.card_copies SET acquired_on = acquired_on - $1::int WHERE source = 'pull'",
    [days],
  ); // prettier-ignore  // card_mints as well, or "a later day" never arrives: record_card_pulls asks
  // that table whether this card was already minted today, so a rewind that left
  // it alone would report every seeded copy as still being today's.
  await sql("UPDATE public.card_mints SET minted_on = minted_on - $1::int", [days]);
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

type SellResult = {
  ok: boolean;
  reason?: string;
  awarded?: number;
  tier?: string;
  secretCardId?: string;
  balance?: number;
};
async function sell(pullId: string, participantId = IDS.alice): Promise<SellResult> {
  const [row] = await sql<{ sell_secret_card: SellResult }>(
    "SELECT public.sell_secret_card($1, $2)",
    [participantId, pullId],
  );
  return row.sell_secret_card;
}

/**
 * One secret on file at a given tier, already sellable.
 *
 * Written directly rather than pulled and rewound, because the tier is what every
 * assertion here is about and `roll_secret_tier()` will not be told what to roll.
 * `granted` is what keeps it out of the daily-slot rule — it is not the row
 * `pull_secret_card` looks for — which is also true of a real bonus pull.
 */
async function heldSecret(tier = "common", participantId = IDS.alice, name = "gary") {
  const cardId = await seedSecret(name);
  const [row] = await sql<{ id: string }>(
    `INSERT INTO public.secret_card_pulls
       (participant_id, secret_card_id, pulled_on, event_id, is_duplicate, granted, tier)
     VALUES ($1, $2, ${NY}, $3, false, true, $4) RETURNING id`,
    [participantId, cardId, IDS.event, tier],
  );
  return { pullId: row.id, cardId };
}

type MillResult = { ok: boolean; reason?: string; awarded?: number; balance?: number };
async function mill(copyId: string, participantId = IDS.alice): Promise<MillResult> {
  const [row] = await sql<{ mill_card_copy: MillResult }>("SELECT public.mill_card_copy($1, $2)", [
    participantId,
    copyId,
  ]);
  return row.mill_card_copy;
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
      expect(await isDenied(role, "SELECT public.sell_secret_card($1, $2)", [IDS.alice, IDS.bob])).toBe(true); // prettier-ignore
      expect(await isDenied(role, "SELECT public.secret_sell_value($1)", ["mythic"])).toBe(true); // prettier-ignore
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

describe("secret_sell_value", () => {
  it("mirrors the ladder in src/lib/dust.ts", async () => {
    // Same mirror mill_value keeps, and for the same reason: the shop prints the
    // TS number before the call, and a disagreement is a sheet promising one
    // payout while the ledger files another.
    for (const [tier, expected] of Object.entries(SELL_BY_SECRET_TIER)) {
      const [row] = await sql<{ v: number }>("SELECT public.secret_sell_value($1) AS v", [tier]);
      expect(row.v, tier).toBe(expected);
    }
  });

  it("pays the common rung for a level it does not recognise, rather than raising", async () => {
    // secret_tier_rank answers 99 for an unknown value and ARRAY[...][99] is
    // NULL. Inside a payout that has to land on the floor, not on an exception.
    // 'platinum' is the trap worth naming: it is a real value in the OTHER
    // ladder, which is exactly why the two vocabularies are kept apart.
    for (const unknown of ["platinum", "MYTHIC", "", "vibes"]) {
      const [row] = await sql<{ v: number }>("SELECT public.secret_sell_value($1) AS v", [unknown]);
      expect(row.v, unknown).toBe(SELL_BY_SECRET_TIER.common);
    }
    const [nul] = await sql<{ v: number }>("SELECT public.secret_sell_value(NULL) AS v");
    expect(nul.v).toBe(SELL_BY_SECRET_TIER.common);
  });
});

describe("sell_secret_card", () => {
  it("pays each rung the number the ladder pins", async () => {
    for (const [tier, expected] of Object.entries(SELL_BY_SECRET_TIER)) {
      const { pullId } = await heldSecret(tier, IDS.alice, `card-${tier}`);
      const res = await sell(pullId);
      expect(res, tier).toMatchObject({ ok: true, awarded: expected, tier });
    }
    const total = Object.values(SELL_BY_SECRET_TIER).reduce((a, b) => a + b, 0);
    expect(await balance()).toBe(total);
  });

  it("pays the floor for a level it does not recognise", async () => {
    // A row written before a tier was retired, or by a migration nobody has
    // taught this about. It must land on the floor rather than raise inside a
    // payout — the same direction mill_value errs in.
    const { pullId } = await heldSecret("common");
    await sql("UPDATE public.secret_card_pulls SET tier = 'vibes' WHERE id = $1", [pullId]);
    expect(await sell(pullId)).toMatchObject({ ok: true, awarded: SELL_BY_SECRET_TIER.common });
  });

  it("sells your ONLY copy, which is the headline", async () => {
    // No last-copy rule, deliberately: the rule trade_item_is_spare's secret
    // branch already keeps, since no public count rides on a member holding one.
    const { pullId, cardId } = await heldSecret("mythic");
    const res = await sell(pullId);
    expect(res).toMatchObject({ ok: true, awarded: SELL_BY_SECRET_TIER.mythic, secretCardId: cardId }); // prettier-ignore
    expect(
      await sql("SELECT count(*)::int AS n FROM public.secret_card_pulls WHERE id = $1", [pullId]),
    ).toEqual([{ n: 0 }]);
    expect(await balance()).toBe(SELL_BY_SECRET_TIER.mythic);
  });

  it("refuses today's own un-granted pull", async () => {
    await seedSecret("only-card");
    const pull = await pullSecret(IDS.alice);
    expect(await sell(pull.pullId)).toMatchObject({ ok: false, reason: "too_fresh" });
    expect(await balance()).toBe(0);
  });

  it("cannot buy back the day's pull — the sequence this guard exists for", async () => {
    // THE EXPLOIT, as a test. pull_secret_card decides whether you have pulled by
    // looking for exactly `pulled_on = today AND NOT granted`, so deleting that
    // row would hand the slot straight back and pull -> sell -> pull would print
    // dust for as long as somebody kept tapping.
    await seedSecret("only-card");
    const first = await pullSecret(IDS.alice);
    expect(await sell(first.pullId)).toMatchObject({ ok: false, reason: "too_fresh" });

    // And the second pull is still the same row rather than a new card.
    const again = await pullSecret(IDS.alice);
    expect(again.pullId).toBe(first.pullId);
    const [rows] = await sql<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.secret_card_pulls WHERE participant_id = $1",
      [IDS.alice],
    );
    expect(rows.n).toBe(1);
    expect(await balance()).toBe(0);
  });

  it("sells yesterday's pull quite happily", async () => {
    // The other side of too_fresh: it is today's slot that is protected, not the
    // row forever. rewindDay is what every mill test uses for the same reason.
    await seedSecret("only-card");
    const pull = await pullSecret(IDS.alice);
    await rewindDay(1);
    expect(await sell(pull.pullId)).toMatchObject({ ok: true });
  });

  it("refuses a copy somebody has already been offered", async () => {
    // trade_offer_items.secret_pull_id cascades, so selling a staked copy would
    // silently shrink an offer the counterparty is about to accept.
    const { pullId } = await heldSecret("epic");
    const [offer] = await sql<{ id: string }>(
      `INSERT INTO public.trade_offers (event_id, proposer_id, recipient_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [IDS.event, IDS.alice, IDS.bob],
    );
    await sql(
      `INSERT INTO public.trade_offer_items (offer_id, giver_side, kind, secret_pull_id)
       VALUES ($1, 'proposer', 'secret', $2)`,
      [offer.id, pullId],
    );
    expect(await sell(pullId)).toMatchObject({ ok: false, reason: "staked" });
    expect(await balance()).toBe(0);
  });

  it("refuses a copy that is not yours", async () => {
    // Proved under the lock. The id comes from the verified token, never from a
    // payload — but the row still has to be shown to belong to it.
    const { pullId } = await heldSecret("rare");
    expect(await sell(pullId, IDS.bob)).toMatchObject({ ok: false, reason: "not_yours" });
    expect(
      await sql("SELECT count(*)::int AS n FROM public.secret_card_pulls WHERE id = $1", [pullId]),
    ).toEqual([{ n: 1 }]);
  });

  it("promotes a duplicate when the owning row is the one sold", async () => {
    // resync_secret_ownership, for the reason accept_trade_offer calls it:
    // `is_duplicate = false` is what four separate counts read as "this person
    // owns this card", so leaving it unset behind a sale would show a vault card
    // that every count says is not theirs.
    const cardId = await seedSecret("gary");
    const [owning] = await sql<{ id: string }>(
      `INSERT INTO public.secret_card_pulls
         (participant_id, secret_card_id, pulled_on, event_id, is_duplicate, granted, tier)
       VALUES ($1, $2, ${NY} - 1, $3, false, false, 'common') RETURNING id`,
      [IDS.alice, cardId, IDS.event],
    );
    const [dupe] = await sql<{ id: string }>(
      `INSERT INTO public.secret_card_pulls
         (participant_id, secret_card_id, pulled_on, event_id, is_duplicate, granted, tier)
       VALUES ($1, $2, ${NY} - 1, $3, true, true, 'mythic') RETURNING id`,
      [IDS.alice, cardId, IDS.event],
    );

    expect(await sell(owning.id)).toMatchObject({ ok: true });
    const [after] = await sql<{ is_duplicate: boolean }>(
      "SELECT is_duplicate FROM public.secret_card_pulls WHERE id = $1",
      [dupe.id],
    );
    expect(after.is_duplicate).toBe(false);
  });

  it("cannot be paid twice for one copy", async () => {
    // The row is gone after the first sale, so the replay is answered not_yours
    // — and the earn-once index is the backstop under that.
    const { pullId } = await heldSecret("legendary");
    await sell(pullId);
    expect(await sell(pullId)).toMatchObject({ ok: false, reason: "not_yours" });
    expect(await balance()).toBe(SELL_BY_SECRET_TIER.legendary);
  });

  it("refuses a guest's copy, because dust starts at the claim", async () => {
    // A guest holds secrets and has no ledger. The row is keyed on guest_id, so
    // no participant id can ever match it.
    await seedSecret("only-card");
    const pull = await pullSecret(null, GUEST);
    await rewindDay(1);
    expect(await sell(pull.pullId)).toMatchObject({ ok: false, reason: "not_yours" });
    expect(await sql("SELECT count(*)::int AS n FROM public.dust_ledger")).toEqual([{ n: 0 }]);
  });

  it("answers a missing row rather than raising", async () => {
    expect(await sell(IDS.bob)).toMatchObject({ ok: false, reason: "not_yours" });
  });
});

describe("the dupe, now that the credit is folded into the sale", () => {
  it("credits nothing at all when a duplicate lands", async () => {
    // The old behaviour, deleted: a flat 25 paid automatically, ignoring the tier
    // entirely. The duplicate is still the moment the economy answers — it just
    // answers with a card worth selling rather than an automatic payout.
    await seedSecret("only-card");
    await pullSecret(IDS.alice);
    expect(await balance()).toBe(0);

    // One card in the pool, so tomorrow's pull can only be a duplicate.
    await rewindDay(1);
    const second = await pullSecret(IDS.alice);
    expect(second.duplicate).toBe(true);
    expect(await sql("SELECT count(*)::int AS n FROM public.dust_ledger")).toEqual([{ n: 0 }]);
    expect(await balance()).toBe(0);
  });

  it("keeps the row, so the dupe is something to sell rather than nothing", async () => {
    // The whole trade this release makes. Without a second row there would be no
    // copy to put on the counter, and the duplicate really would be worth zero.
    await seedSecret("only-card");
    await pullSecret(IDS.alice);
    await rewindDay(1);
    await pullSecret(IDS.alice);
    const [rows] = await sql<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.secret_card_pulls WHERE participant_id = $1",
      [IDS.alice],
    );
    expect(rows.n).toBe(2);
  });

  it("still upgrades the copy you own when the duplicate rolls better", async () => {
    // Best wins, never down. The credit went; this did not, and it is the other
    // half of what makes a duplicate worth having.
    await seedSecret("only-card");
    const first = await pullSecret(IDS.alice);
    await sql("UPDATE public.secret_card_pulls SET tier = 'common' WHERE id = $1", [first.pullId]);
    await rewindDay(1);
    const dupe = await pullSecret(IDS.alice);
    expect(dupe.duplicate).toBe(true);

    // Stated as the invariant rather than as one expected tier, since the roll is
    // random: whatever the dupe came in at, the owning row is at least as good.
    const [owning] = await sql<{ rank: number }>(
      "SELECT public.secret_tier_rank(tier) AS rank FROM public.secret_card_pulls WHERE id = $1",
      [first.pullId],
    );
    const [rolled] = await sql<{ rank: number }>(
      "SELECT public.secret_tier_rank(tier) AS rank FROM public.secret_card_pulls WHERE id = $1",
      [dupe.pullId],
    );
    expect(owning.rank).toBeLessThanOrEqual(rolled.rank);
  });

  it("pays a guest nothing either, because dust starts at the claim", async () => {
    await seedSecret("only-card");
    await pullSecret(null, GUEST);
    await rewindDay(1);
    const dupe = await pullSecret(null, GUEST);
    expect(dupe.duplicate).toBe(true);
    expect(await sql("SELECT count(*)::int AS n FROM public.dust_ledger")).toEqual([{ n: 0 }]);
  });
});

describe("the daily mint cap", () => {
  // The cap used to count copies the member currently held today, and every term
  // of that predicate is mutable: accept_trade_offer re-parents the row, sets
  // source = 'trade' and nulls acquired_on, all at once. Trading today's copy
  // away handed the slot back AND took the row out of the partial unique index,
  // so the same pack could be recorded again for a replacement — and the copy the
  // counterparty received escaped mill_card_copy's freshness guard, still priced
  // at the full server rate. Two members with duplicates could swap, re-mint and
  // burn on a loop. card_mints is what makes the budget unspendable.
  async function record(participantId: string, ids: string[]) {
    const [row] = await sql<{
      record_card_pulls: { recorded: number; editions: Record<string, string> };
    }>("SELECT public.record_card_pulls($1, $2, NULL)", [participantId, ids]);
    return row.record_card_pulls;
  }

  async function mintCount(participantId = IDS.alice) {
    const [row] = await sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.card_mints
        WHERE participant_id = $1 AND minted_on = ${NY}`,
      [participantId],
    );
    return row.n;
  }

  async function copyCount(participantId: string, ep: string) {
    const [row] = await sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.card_copies
        WHERE participant_id = $1 AND event_participant_id = $2`,
      [participantId, ep],
    );
    return row.n;
  }

  it("does not hand the slot back when the copy is traded away", async () => {
    // THE EXPLOIT, as a test.
    const ids = await cardIds();
    await claimMember(IDS.alice);
    await claimMember(IDS.bob);

    // Alice needs a second copy of the card so the spare rule lets her stake it,
    // and Bob needs a spare of his own — create_trade_offer refuses a one-sided
    // offer.
    await sql(
      `INSERT INTO public.card_copies (participant_id, event_participant_id, source)
       VALUES ($1, $2, 'backfill'), ($3, $4, 'backfill'), ($3, $4, 'backfill')`,
      [IDS.alice, ids[0], IDS.bob, ids[1]],
    );
    await sql("SELECT public.resync_card_pull($1, $2)", [IDS.bob, ids[1]]);
    await record(IDS.alice, [ids[0]]);
    expect(await mintCount()).toBe(1);

    const [today] = await sql<{ id: string }>(
      `SELECT id FROM public.card_copies
        WHERE participant_id = $1 AND source = 'pull' AND acquired_on = ${NY}`,
      [IDS.alice],
    );
    const [bobSpare] = await sql<{ id: string }>(
      `SELECT id FROM public.card_copies WHERE participant_id = $1 LIMIT 1`,
      [IDS.bob],
    );

    const offer = await sql<{ create_trade_offer: { ok: boolean; offerId: string } }>(
      "SELECT public.create_trade_offer($1, $2, $3, $4::jsonb, $5::jsonb)",
      [
        IDS.alice,
        IDS.bob,
        IDS.event,
        JSON.stringify([{ kind: "roster", cardCopyId: today.id }]),
        JSON.stringify([{ kind: "roster", cardCopyId: bobSpare.id }]),
      ],
    );
    const offerId = offer[0].create_trade_offer.offerId;
    await sql("SELECT public.accept_trade_offer($1, $2)", [offerId, IDS.bob]);

    // The copy is Bob's now, so nothing of Alice's is left marked as today's pull.
    expect(await copyCount(IDS.bob, ids[0])).toBe(1);

    // And the re-record mints nothing: the mint row outlived the copy.
    const again = await record(IDS.alice, [ids[0]]);
    expect(await mintCount()).toBe(1);
    expect(await copyCount(IDS.alice, ids[0])).toBe(1);
    // Alice no longer holds a today-pull copy of it, so it is absent from the
    // answer rather than reported as a card she owns.
    expect(again.editions[ids[0]]).toBeUndefined();
  });

  it("does not hand the slot back when the copy is milled", async () => {
    const ids = await cardIds();
    await sql(
      `INSERT INTO public.card_copies (participant_id, event_participant_id, acquired_on, source)
       VALUES ($1, $2, ${NY} - 1, 'pull')`,
      [IDS.alice, ids[0]],
    );
    await record(IDS.alice, [ids[0]]);
    const [today] = await sql<{ id: string }>(
      `SELECT id FROM public.card_copies
        WHERE participant_id = $1 AND source = 'pull' AND acquired_on = ${NY}`,
      [IDS.alice],
    );
    // too_fresh blocks this one directly, but prove the budget holds even if a
    // future sink ever consumes a same-day copy some other way.
    await sql("DELETE FROM public.card_copies WHERE id = $1", [today.id]);

    await record(IDS.alice, [ids[0]]);
    expect(await mintCount()).toBe(1);
  });

  it("still answers a plain retry with the finishes it already filed", async () => {
    // The property the old ON CONFLICT DO UPDATE trick was protecting. It is the
    // read-back at the end of the RPC that provides it now.
    const ids = await cardIds();
    const first = await record(IDS.alice, ids);
    for (let i = 0; i < 4; i++) {
      expect((await record(IDS.alice, ids)).editions).toEqual(first.editions);
    }
    expect(await mintCount()).toBe(ids.length);
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

describe("while the switch is off", () => {
  // The whole economy behind one flag, checked in SQL rather than only in the
  // handlers, because that is where the money moves. A client that skipped the
  // check still gets refused here.
  const REQ = "cccccccc-0000-4000-8000-000000000001";

  it("says so rather than burning a spare", async () => {
    const { spareId } = await twoCopies();
    await switchOff();
    expect(await mill(spareId)).toEqual({ ok: false, reason: "disabled" });
    // Refused before it touched anything: the copy is still there.
    const [row] = await sql<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.card_copies WHERE id = $1",
      [spareId],
    );
    expect(row.n).toBe(1);
    expect(await balance()).toBe(0);
  });

  it("says so rather than selling a pull", async () => {
    await seedSecret("a-card");
    await credit(DUST_PRICES.bonusPull);
    await switchOff();
    const [row] = await sql<{ buy_bonus_secret_pull: { ok: boolean; reason: string } }>(
      "SELECT public.buy_bonus_secret_pull($1, $2, $3)",
      [IDS.alice, IDS.event, REQ],
    );
    expect(row.buy_bonus_secret_pull).toEqual({ ok: false, reason: "disabled" });
    // Nothing bought and nothing spent.
    expect(await sql("SELECT count(*)::int AS n FROM public.secret_card_pulls")).toEqual([
      { n: 0 },
    ]);
    expect(await balance()).toBe(DUST_PRICES.bonusPull);
  });

  it("says so rather than re-rolling a finish", async () => {
    const { spareId } = await twoCopies("gold", "server");
    await credit(DUST_PRICES.reroll);
    await switchOff();
    const [row] = await sql<{ reroll_copy_edition: { ok: boolean; reason: string } }>(
      "SELECT public.reroll_copy_edition($1, $2, $3)",
      [IDS.alice, spareId, REQ],
    );
    expect(row.reroll_copy_edition).toEqual({ ok: false, reason: "disabled" });
    const [row2] = await sql<{ edition: string }>(
      "SELECT edition FROM public.card_copies WHERE id = $1",
      [spareId],
    );
    expect(row2.edition).toBe("gold");
    expect(await balance()).toBe(DUST_PRICES.reroll);
  });

  it("says so rather than selling a secret", async () => {
    const { pullId } = await heldSecret("legendary");
    await switchOff();
    expect(await sell(pullId)).toEqual({ ok: false, reason: "disabled" });
    // Refused before it touched anything: the copy is still there.
    const [row] = await sql<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.secret_card_pulls WHERE id = $1",
      [pullId],
    );
    expect(row.n).toBe(1);
    expect(await balance()).toBe(0);
  });

  it("pays nothing at all for a duplicate secret", async () => {
    // The decision behind the switch: no ledger row while it is off. A balance
    // built out of history nobody knew was being scored — during a stretch when
    // burning was unavailable — would be lopsided towards whoever pulled most.
    // Since the credit was folded into the sale this is the sale being refused
    // rather than the credit being skipped, but the property is the same one.
    await seedSecret("only-card");
    await pullSecret(IDS.alice);
    await rewindDay(1);
    await switchOff();

    const dupe = await pullSecret(IDS.alice);
    expect(dupe.duplicate).toBe(true);
    expect(await sql("SELECT count(*)::int AS n FROM public.dust_ledger")).toEqual([{ n: 0 }]);
    expect(await balance()).toBe(0);
  });

  it("leaves the pull itself working, switch or no switch", async () => {
    // The economy is off, not the game. A dupe still lands, still upgrades a
    // tier, still counts — it simply pays nothing.
    await seedSecret("only-card");
    await switchOff();
    const first = await pullSecret(IDS.alice);
    expect(first.duplicate).toBe(false);
    expect(first.pullId).toBeTruthy();
  });

  it("is off by default, which is what makes deploying it a no-op", async () => {
    // seedEvent inserts a plain event and the beforeEach above switches it on;
    // this asserts the column's own default rather than the fixture's choice.
    const [row] = await sql<{ dust_enabled: boolean }>(
      `INSERT INTO public.events (name, year, active) VALUES ('Defaults', 2027, false)
       RETURNING dust_enabled`,
    );
    expect(row.dust_enabled).toBe(false);
  });

  it("reads off the ACTIVE event, and calls no active event off", async () => {
    // dust_ledger carries no event id — a balance is a fact about a person, not
    // about a combine — so there is one answer rather than one per event.
    await sql("UPDATE public.events SET active = false");
    const [row] = await sql<{ dust_enabled: boolean }>("SELECT public.dust_enabled()");
    expect(row.dust_enabled).toBe(false);
  });
});
