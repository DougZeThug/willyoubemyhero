// The trading RPCs, against real Postgres.
//
// Four properties live here and nowhere else, and each one is invisible to a
// mocked test because each one is a fact about Postgres rather than about our
// code:
//
//  1. A traded roster copy carries its FINISH. That is the whole reason
//     card_copies exists — before it there was only a person-level "best finish
//     ever pulled", so every traded card arrived standard.
//  2. Re-parenting a secret pull does not trip `secret_card_pulls_one_per_day`,
//     and re-parenting a card copy does not trip `card_copies_one_pull_per_day`.
//     Both indexes are partial on a "did this come from a pack" flag, and the
//     accept only survives because it clears that flag on the row it moves.
//  3. The giver's card_pulls row survives every roster transfer, so the row count
//     per card — the public "Packed by N" number — cannot move because of a trade.
//  4. Two accepts racing over one spare produce one winner and one voided offer,
//     rather than a deadlock or two winners.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, IDS, newClient, seedEvent, sql } from "./helpers";
import { leagueDay, LEAGUE_TIME_ZONE } from "@/lib/trades";

afterAll(closeDb);
beforeEach(seedEvent);

/** A past league day. Anything seeded on `current_date` is somebody's spent daily slot. */
const PAST_DAY = "2026-01-01";
const OTHER_DAY = "2026-01-02";

type OfferResult = { ok: boolean; offerId: string };
type AcceptResult = { ok: boolean; reason?: string; tradeId?: string };
type ReopenResult = { ok: boolean; reason?: string; counterpartyId?: string };
type Item = { kind: "roster"; cardCopyId: string } | { kind: "secret"; secretPullId: string };

/** A roster item names a COPY now, exactly as a secret item names a ledger row. */
const copy = (cardCopyId: string): Item => ({ kind: "roster", cardCopyId });
const secret = (secretPullId: string): Item => ({ kind: "secret", secretPullId });

async function cardIds(): Promise<string[]> {
  const rows = await sql<{ id: string }>(
    "SELECT id FROM public.event_participants ORDER BY running_order",
  );
  return rows.map((r) => r.id);
}

async function addCard(name: string): Promise<string> {
  const [row] = await sql<{ id: string }>(
    `INSERT INTO public.secret_cards (name, art_path) VALUES ($1, $2) RETURNING id`,
    [name, `secrets/${name}/art-1.webp`],
  );
  return row.id;
}

/** A claimed member. create_trade_offer refuses to send an offer to anyone else. */
async function claim(participantId: string) {
  await sql(
    `INSERT INTO public.member_codes (participant_id, code_salt, code_hash, claimed_at)
     VALUES ($1, 'salt', 'hash', now())
     ON CONFLICT (participant_id) DO UPDATE SET claimed_at = now()`,
    [participantId],
  );
}

/**
 * One copy per entry, in order, then derive the card_pulls row from them.
 *
 * `source = 'backfill'` so `acquired_on` stays null and these never meet
 * card_copies_one_pull_per_day — seeding several copies of one card for one person
 * is the normal case here and would otherwise collide.
 */
async function giveCopies(
  participantId: string,
  ep: string,
  editions: string[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const edition of editions) {
    const [row] = await sql<{ id: string }>(
      `INSERT INTO public.card_copies (participant_id, event_participant_id, edition, source)
       VALUES ($1, $2, $3, 'backfill') RETURNING id`,
      [participantId, ep, edition],
    );
    ids.push(row.id);
  }
  await sql("SELECT public.resync_card_pull($1, $2)", [participantId, ep]);
  return ids;
}

/** Two copies, the smallest holding that makes one of them a spare. */
const giveRoster = (pid: string, ep: string, count = 2, edition = "standard") =>
  giveCopies(pid, ep, [edition, ...Array(Math.max(0, count - 1)).fill("standard")]);

/**
 * One secret ledger row.
 *
 * `granted` defaults to true so seeding several rows for one person does not
 * collide on the one-per-day index — the same reason the real grant path sets it.
 * Tests that care about the day rule pass it explicitly.
 */
async function giveSecret(
  participantId: string,
  cardId: string,
  over: { duplicate?: boolean; granted?: boolean; day?: string; tier?: string } = {},
): Promise<string> {
  const [row] = await sql<{ id: string }>(
    `INSERT INTO public.secret_card_pulls
       (participant_id, secret_card_id, pulled_on, event_id, is_duplicate, granted, tier)
     VALUES ($1, $2, $3::date, $4, $5, $6, $7) RETURNING id`,
    [
      participantId,
      cardId,
      over.day ?? PAST_DAY,
      IDS.event,
      over.duplicate ?? false,
      over.granted ?? true,
      over.tier ?? "common",
    ],
  );
  return row.id;
}

async function createOffer(
  proposer: string,
  recipient: string,
  give: Item[],
  want: Item[],
  eventId: string | null = IDS.event,
): Promise<OfferResult> {
  const [row] = await sql<{ create_trade_offer: OfferResult }>(
    "SELECT public.create_trade_offer($1, $2, $3, $4::jsonb, $5::jsonb)",
    [proposer, recipient, eventId, JSON.stringify(give), JSON.stringify(want)],
  );
  return row.create_trade_offer;
}

async function accept(offerId: string, recipientId: string): Promise<AcceptResult> {
  const [row] = await sql<{ accept_trade_offer: AcceptResult }>(
    "SELECT public.accept_trade_offer($1, $2)",
    [offerId, recipientId],
  );
  return row.accept_trade_offer;
}

/**
 * Resolve an offer the way the handlers do — one guarded UPDATE, no RPC.
 *
 * Written out here rather than reached for through the server function, because
 * what these tests are about is the state those two writes leave behind for
 * `reopen_trade_offer` to find.
 */
async function settle(offerId: string, status: "declined" | "cancelled", agoSeconds = 0) {
  await sql(
    `UPDATE public.trade_offers
        SET status = $2, resolved_at = now() - make_interval(secs => $3::int)
      WHERE id = $1`,
    [offerId, status, agoSeconds],
  );
}

async function reopen(offerId: string, actorId: string, withinSeconds = 60): Promise<ReopenResult> {
  const [row] = await sql<{ reopen_trade_offer: ReopenResult }>(
    "SELECT public.reopen_trade_offer($1, $2, $3)",
    [offerId, actorId, withinSeconds],
  );
  return row.reopen_trade_offer;
}

async function pullCount(participantId: string, ep: string): Promise<number | null> {
  const rows = await sql<{ pull_count: number }>(
    "SELECT pull_count FROM public.card_pulls WHERE participant_id = $1 AND event_participant_id = $2",
    [participantId, ep],
  );
  return rows[0]?.pull_count ?? null;
}

/** The derived "best finish you hold" — what the vault renders. */
async function bestFinish(participantId: string, ep: string): Promise<string | null> {
  const rows = await sql<{ edition: string }>(
    "SELECT edition FROM public.card_pulls WHERE participant_id = $1 AND event_participant_id = $2",
    [participantId, ep],
  );
  return rows[0]?.edition ?? null;
}

async function copyRow(id: string) {
  const [row] = await sql<{
    participant_id: string;
    event_participant_id: string;
    edition: string;
    acquired_on: string | null;
    source: string;
  }>("SELECT * FROM public.card_copies WHERE id = $1", [id]);
  return row;
}

async function secretRow(id: string) {
  const [row] = await sql<{
    participant_id: string | null;
    guest_id: string | null;
    secret_card_id: string;
    is_duplicate: boolean;
    granted: boolean;
    pulled_on: string;
    tier: string;
  }>("SELECT * FROM public.secret_card_pulls WHERE id = $1", [id]);
  return row;
}

async function offerStatus(offerId: string): Promise<string> {
  const [row] = await sql<{ status: string }>(
    "SELECT status FROM public.trade_offers WHERE id = $1",
    [offerId],
  );
  return row.status;
}

/** Alice and Bob, both claimed, each holding two copies of a different roster card. */
async function twoSpares() {
  const [aliceCard, bobCard] = await cardIds();
  await claim(IDS.alice);
  await claim(IDS.bob);
  const aliceCopies = await giveRoster(IDS.alice, aliceCard, 2);
  const bobCopies = await giveRoster(IDS.bob, bobCard, 2);
  return { aliceCard, bobCard, aliceCopies, bobCopies };
}

describe("the league day, in two languages", () => {
  it("pins leagueDay() to the zone trade_item_is_spare decides today with", async () => {
    // `America/New_York` is written into the function body in SQL and into
    // LEAGUE_TIME_ZONE in TS, and the spares LISTING uses the TS one to hide a
    // copy the RPC would refuse. Drift between them shows up as a card you can
    // see, tap, and not trade. Same shape as the tests pinning card-edition.ts
    // and secret-rarity.ts to their SQL ladders.
    const [row] = await sql<{ zone: string; today: string }>(`
      SELECT (SELECT cfg FROM unnest(p.proconfig) AS cfg
               WHERE cfg LIKE 'TimeZone=%' OR cfg LIKE 'timezone=%') AS zone,
             (now() AT TIME ZONE 'America/New_York')::date::text AS today
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'trade_item_is_spare'
    `);
    expect(row.zone).toBe(`TimeZone=${LEAGUE_TIME_ZONE}`);
    expect(leagueDay()).toBe(row.today);
  });
});

describe("create_trade_offer", () => {
  it("writes the offer and both sides of the table in one call", async () => {
    const { aliceCopies, bobCopies } = await twoSpares();
    const res = await createOffer(IDS.alice, IDS.bob, [copy(aliceCopies[0])], [copy(bobCopies[0])]);

    expect(res.ok).toBe(true);
    expect(await offerStatus(res.offerId)).toBe("pending");

    const items = await sql<{ giver_side: string; kind: string; card_copy_id: string }>(
      "SELECT giver_side, kind, card_copy_id FROM public.trade_offer_items WHERE offer_id = $1 ORDER BY giver_side",
      [res.offerId],
    );
    expect(items).toEqual([
      { giver_side: "proposer", kind: "roster", card_copy_id: aliceCopies[0] },
      { giver_side: "recipient", kind: "roster", card_copy_id: bobCopies[0] },
    ]);
  });

  it("refuses a trade with yourself", async () => {
    const { aliceCopies } = await twoSpares();
    await expect(
      createOffer(IDS.alice, IDS.alice, [copy(aliceCopies[0])], [copy(aliceCopies[1])]),
    ).rejects.toThrow(/yourself/i);
  });

  it("refuses an offer to somebody who has not claimed their player", async () => {
    // Carol is on the roster but has no member_codes row, so no device holds a
    // token for her: an offer would sit pending forever with nobody able to
    // decline it.
    const [aliceCard, , carolCard] = await cardIds();
    await claim(IDS.alice);
    const aliceCopies = await giveRoster(IDS.alice, aliceCard, 2);
    const carolCopies = await giveRoster(IDS.carol, carolCard, 2);
    await expect(
      createOffer(IDS.alice, IDS.carol, [copy(aliceCopies[0])], [copy(carolCopies[0])]),
    ).rejects.toThrow(/claimed/i);
  });

  it("allows an offer to somebody who signed in but never redeemed a code", async () => {
    // An account follows a person between phones, so it is at least as good a
    // proof of reachability as a paper code — and this was the real-world bug:
    // a league member with an account and no claim could not be traded with.
    const [aliceCard, , carolCard] = await cardIds();
    await claim(IDS.alice);
    await sql(
      `INSERT INTO public.account_identities (user_id, participant_id)
       VALUES (gen_random_uuid(), $1)`,
      [IDS.carol],
    );
    const aliceCopies = await giveRoster(IDS.alice, aliceCard, 2);
    const carolCopies = await giveRoster(IDS.carol, carolCard, 2);
    const res = await createOffer(
      IDS.alice,
      IDS.carol,
      [copy(aliceCopies[0])],
      [copy(carolCopies[0])],
    );
    expect(res.ok).toBe(true);
  });

  it("refuses an empty side", async () => {
    const { aliceCopies } = await twoSpares();
    await expect(createOffer(IDS.alice, IDS.bob, [copy(aliceCopies[0])], [])).rejects.toThrow(
      /one to four/i,
    );
  });

  it("refuses more than four cards on a side", async () => {
    const ids = await cardIds();
    await claim(IDS.alice);
    await claim(IDS.bob);
    const mine: string[] = [];
    for (const id of ids) mine.push(...(await giveRoster(IDS.alice, id, 2)));
    const theirs = await giveRoster(IDS.bob, ids[0], 2);
    // Five items — the length check runs before anything looks at what they name.
    const five = [...mine.slice(0, 5)].map(copy);
    await expect(createOffer(IDS.alice, IDS.bob, five, [copy(theirs[0])])).rejects.toThrow(
      /one to four/i,
    );
  });

  it("refuses a copy of a card the giver holds only one of", async () => {
    const { bobCopies } = await twoSpares();
    const [aliceCard] = await cardIds();
    // The whole spares rule: one copy is the copy you keep. Wipe Alice back down
    // to a single copy and it stops being tradeable.
    await sql("DELETE FROM public.card_copies WHERE participant_id = $1", [IDS.alice]);
    const only = await giveCopies(IDS.alice, aliceCard, ["platinum"]);
    await expect(
      createOffer(IDS.alice, IDS.bob, [copy(only[0])], [copy(bobCopies[0])]),
    ).rejects.toThrow(/spare/i);
  });

  it("refuses to stake a copy out of somebody else's collection", async () => {
    const { aliceCopies, bobCopies } = await twoSpares();
    // Alice naming one of Bob's copies on HER side of the table. The giver of each
    // item is resolved from the side it sits on, so this is Alice claiming to hold
    // a copy that is in Bob's collection.
    await expect(
      createOffer(IDS.alice, IDS.bob, [copy(bobCopies[0])], [copy(aliceCopies[0])]),
    ).rejects.toThrow(/spare/i);
  });

  it("accepts a secret copy you only own one of", async () => {
    // THIS USED TO BE REFUSED. A secret you hold one of is yours to give: unlike a
    // roster card there is no public count riding on you keeping one.
    const { bobCopies } = await twoSpares();
    const card = await addCard("Gary the Grill");
    const only = await giveSecret(IDS.alice, card, { duplicate: false });
    const res = await createOffer(IDS.alice, IDS.bob, [secret(only)], [copy(bobCopies[0])]);
    expect(res.ok).toBe(true);
  });

  it("refuses a secret copy belonging to somebody else", async () => {
    const { bobCopies } = await twoSpares();
    const card = await addCard("Gary the Grill");
    await giveSecret(IDS.bob, card, { duplicate: false });
    const bobsDupe = await giveSecret(IDS.bob, card, { duplicate: true });
    await expect(
      createOffer(IDS.alice, IDS.bob, [secret(bobsDupe)], [copy(bobCopies[0])]),
    ).rejects.toThrow(/spare/i);
  });

  it("refuses today's own pull, which is the giver's spent daily slot", async () => {
    // Not tidiness — a daily-limit bypass. pull_secret_card decides whether you
    // have pulled today by looking for `pulled_on = today AND NOT granted`, and
    // the accept sets granted = true on the row it moves. Trading today's
    // duplicate away would delete the evidence and hand the giver a second pull.
    const { bobCopies } = await twoSpares();
    const card = await addCard("Gary the Grill");
    await giveSecret(IDS.alice, card, { duplicate: false });
    const [{ today }] = await sql<{ today: string }>(
      "SELECT (now() AT TIME ZONE 'America/New_York')::date::text AS today",
    );
    const todays = await giveSecret(IDS.alice, card, {
      duplicate: true,
      granted: false,
      day: today,
    });
    await expect(
      createOffer(IDS.alice, IDS.bob, [secret(todays)], [copy(bobCopies[0])]),
    ).rejects.toThrow(/spare/i);
  });

  it("lets the same secret copy trade once the day has passed", async () => {
    // The other half of the rule above: yesterday's duplicate is an ordinary
    // spare, so the restriction costs a day rather than the feature.
    const { bobCopies } = await twoSpares();
    const card = await addCard("Gary the Grill");
    await giveSecret(IDS.alice, card, { duplicate: false });
    const yesterdays = await giveSecret(IDS.alice, card, {
      duplicate: true,
      granted: false,
      day: OTHER_DAY,
    });
    const res = await createOffer(IDS.alice, IDS.bob, [secret(yesterdays)], [copy(bobCopies[0])]);
    expect(res.ok).toBe(true);
  });

  it("refuses to stake the same copy twice in one offer", async () => {
    const { aliceCopies, bobCopies } = await twoSpares();
    await expect(
      createOffer(
        IDS.alice,
        IDS.bob,
        [copy(aliceCopies[0]), copy(aliceCopies[0])],
        [copy(bobCopies[0])],
      ),
    ).rejects.toThrow();
  });

  it("allows two different copies of the same card in one offer", async () => {
    // The reciprocal, and the reason the index is on the copy rather than the
    // card: trading two of your three Alices is a real thing to want.
    const [aliceCard, bobCard] = await cardIds();
    await claim(IDS.alice);
    await claim(IDS.bob);
    const mine = await giveCopies(IDS.alice, aliceCard, ["gold", "bronze", "standard"]);
    const theirs = await giveRoster(IDS.bob, bobCard, 2);
    const res = await createOffer(
      IDS.alice,
      IDS.bob,
      [copy(mine[0]), copy(mine[1])],
      [copy(theirs[0])],
    );
    expect(res.ok).toBe(true);
  });

  it("refuses an offer that would empty a card out", async () => {
    // The per-item spare check cannot catch this: each copy passes on its own,
    // because both see the count as it stands before anything has moved. Staking
    // both copies of a two-copy holding would take the giver to zero, delete their
    // card_pulls row, and drop the public "Packed by N" count for that card.
    const { aliceCopies, bobCopies } = await twoSpares();
    await expect(
      createOffer(
        IDS.alice,
        IDS.bob,
        [copy(aliceCopies[0]), copy(aliceCopies[1])],
        [copy(bobCopies[0])],
      ),
    ).rejects.toThrow(/keep a copy/i);
  });

  it("allows two of three, which is the same rule one card up", async () => {
    const [aliceCard, bobCard] = await cardIds();
    await claim(IDS.alice);
    await claim(IDS.bob);
    const mine = await giveCopies(IDS.alice, aliceCard, ["gold", "bronze", "standard"]);
    const theirs = await giveRoster(IDS.bob, bobCard, 2);
    const res = await createOffer(
      IDS.alice,
      IDS.bob,
      [copy(mine[0]), copy(mine[1])],
      [copy(theirs[0])],
    );
    expect(res.ok).toBe(true);
    expect((await accept(res.offerId, IDS.bob)).ok).toBe(true);
    expect(await pullCount(IDS.alice, aliceCard)).toBe(1);
    expect(await pullCount(IDS.bob, aliceCard)).toBe(2);
  });

  it("voids at accept time when the giver's spare copies have gone", async () => {
    // Same rule, re-checked under the lock: the offer was legal when composed and
    // is not any more.
    const [aliceCard, bobCard] = await cardIds();
    await claim(IDS.alice);
    await claim(IDS.bob);
    const mine = await giveCopies(IDS.alice, aliceCard, ["gold", "bronze", "standard"]);
    const theirs = await giveRoster(IDS.bob, bobCard, 2);
    const { offerId } = await createOffer(
      IDS.alice,
      IDS.bob,
      [copy(mine[0]), copy(mine[1])],
      [copy(theirs[0])],
    );
    await sql("DELETE FROM public.card_copies WHERE id = $1", [mine[2]]);
    await sql("SELECT public.resync_card_pull($1, $2)", [IDS.alice, aliceCard]);

    expect(await accept(offerId, IDS.bob)).toEqual({ ok: false, reason: "voided" });
    expect(await pullCount(IDS.alice, aliceCard)).toBe(2);
  });

  it("refuses an item that names neither kind of card", async () => {
    const { bobCopies } = await twoSpares();
    const junk = [{ kind: "roster" }] as unknown as Item[];
    await expect(createOffer(IDS.alice, IDS.bob, junk, [copy(bobCopies[0])])).rejects.toThrow(
      /must name/i,
    );
  });

  it("leaves nothing behind when it refuses", async () => {
    const { bobCopies } = await twoSpares();
    const [aliceCard] = await cardIds();
    await sql("DELETE FROM public.card_copies WHERE participant_id = $1", [IDS.alice]);
    const only = await giveCopies(IDS.alice, aliceCard, ["standard"]);
    await expect(
      createOffer(IDS.alice, IDS.bob, [copy(only[0])], [copy(bobCopies[0])]),
    ).rejects.toThrow();
    // The offer row is inserted before the spare check raises, so this is really
    // asserting that the raise rolls the whole function back.
    expect(await sql("SELECT count(*)::int AS n FROM public.trade_offers")).toEqual([{ n: 0 }]);
    expect(await sql("SELECT count(*)::int AS n FROM public.trade_offer_items")).toEqual([
      { n: 0 },
    ]);
  });
});

describe("accept_trade_offer — roster cards", () => {
  it("moves a copy without ever deleting the giver's row", async () => {
    const { aliceCard, bobCard, aliceCopies, bobCopies } = await twoSpares();
    const { offerId } = await createOffer(
      IDS.alice,
      IDS.bob,
      [copy(aliceCopies[0])],
      [copy(bobCopies[0])],
    );

    const res = await accept(offerId, IDS.bob);
    expect(res.ok).toBe(true);

    // Both givers drop to one and KEEP their row. This is the whole reason the
    // spares rule exists: card_pulls_count_positive would refuse to take a row
    // to zero, and a deleted row would move the public "Packed by N" count.
    expect(await pullCount(IDS.alice, aliceCard)).toBe(1);
    expect(await pullCount(IDS.bob, bobCard)).toBe(1);
    expect(await pullCount(IDS.bob, aliceCard)).toBe(1);
    expect(await pullCount(IDS.alice, bobCard)).toBe(1);
  });

  it("leaves the public packed-by count exactly where it was", async () => {
    const { aliceCard, bobCard, aliceCopies, bobCopies } = await twoSpares();
    const packedBy = async (ep: string) => {
      const [row] = await sql<{ n: number }>(
        "SELECT count(*)::int AS n FROM public.card_pulls WHERE event_participant_id = $1",
        [ep],
      );
      return row.n;
    };
    // One person holds each card before the trade; two hold each after — which is
    // an honest change, because a second person really does now hold one.
    expect(await packedBy(aliceCard)).toBe(1);

    const { offerId } = await createOffer(
      IDS.alice,
      IDS.bob,
      [copy(aliceCopies[0])],
      [copy(bobCopies[0])],
    );
    await accept(offerId, IDS.bob);

    expect(await packedBy(aliceCard)).toBe(2);
    expect(await packedBy(bobCard)).toBe(2);
  });

  it("hands over the finish that was on the copy", async () => {
    // THE POINT OF THE WHOLE card_copies TABLE. Before it there was no per-copy
    // finish to move, so a traded platinum arrived standard.
    const [aliceCard, bobCard] = await cardIds();
    await claim(IDS.alice);
    await claim(IDS.bob);
    const mine = await giveCopies(IDS.alice, aliceCard, ["platinum", "standard"]);
    const theirs = await giveRoster(IDS.bob, bobCard, 2);

    const { offerId } = await createOffer(IDS.alice, IDS.bob, [copy(mine[0])], [copy(theirs[0])]);
    expect((await accept(offerId, IDS.bob)).ok).toBe(true);

    expect((await copyRow(mine[0])).edition).toBe("platinum");
    expect((await copyRow(mine[0])).participant_id).toBe(IDS.bob);
    expect(await bestFinish(IDS.bob, aliceCard)).toBe("platinum");
  });

  it("demotes the giver to the best finish they still hold", async () => {
    // The one place in the app where card_pulls.edition moves DOWNWARDS. You gave
    // the platinum away; standard is the honest answer.
    const [aliceCard, bobCard] = await cardIds();
    await claim(IDS.alice);
    await claim(IDS.bob);
    const mine = await giveCopies(IDS.alice, aliceCard, ["platinum", "standard"]);
    const theirs = await giveRoster(IDS.bob, bobCard, 2);
    expect(await bestFinish(IDS.alice, aliceCard)).toBe("platinum");

    const { offerId } = await createOffer(IDS.alice, IDS.bob, [copy(mine[0])], [copy(theirs[0])]);
    await accept(offerId, IDS.bob);

    expect(await bestFinish(IDS.alice, aliceCard)).toBe("standard");
  });

  it("lets you trade your best copy and keep a worse one", async () => {
    // Choosing WHICH copy to keep is the point of per-copy. The spare rule only
    // asks that you keep one, not that you keep the good one.
    const [aliceCard, bobCard] = await cardIds();
    await claim(IDS.alice);
    await claim(IDS.bob);
    const mine = await giveCopies(IDS.alice, aliceCard, ["gold", "bronze"]);
    const theirs = await giveRoster(IDS.bob, bobCard, 2);

    const { offerId } = await createOffer(IDS.alice, IDS.bob, [copy(mine[0])], [copy(theirs[0])]);
    expect((await accept(offerId, IDS.bob)).ok).toBe(true);
    expect(await bestFinish(IDS.alice, aliceCard)).toBe("bronze");
    expect(await bestFinish(IDS.bob, aliceCard)).toBe("gold");
  });

  it("does not lower a receiver who already holds something better", async () => {
    const [aliceCard, bobCard] = await cardIds();
    await claim(IDS.alice);
    await claim(IDS.bob);
    const mine = await giveCopies(IDS.alice, aliceCard, ["standard", "standard"]);
    await giveCopies(IDS.bob, aliceCard, ["gold"]);
    const theirs = await giveRoster(IDS.bob, bobCard, 2);

    const { offerId } = await createOffer(IDS.alice, IDS.bob, [copy(mine[0])], [copy(theirs[0])]);
    await accept(offerId, IDS.bob);

    // Best across the copies they now hold: gold beats the standard that arrived.
    expect(await bestFinish(IDS.bob, aliceCard)).toBe("gold");
    expect(await pullCount(IDS.bob, aliceCard)).toBe(2);
  });

  it("clears the copy's pull day, so it cannot collide with the receiver's own", async () => {
    // The roster twin of `granted = true` on a secret. Both people pulled this
    // card today; without clearing acquired_on the re-parent trips
    // card_copies_one_pull_per_day and the whole accept aborts.
    const [aliceCard, bobCard] = await cardIds();
    await claim(IDS.alice);
    await claim(IDS.bob);
    const theirs = await giveRoster(IDS.bob, bobCard, 2);

    // Two real pulls of the same card, on the same league day, one each.
    await sql("SELECT public.record_card_pulls($1, $2::uuid[], $3::text[])", [IDS.alice, [aliceCard], ["gold"]]); // prettier-ignore
    await sql("SELECT public.record_card_pulls($1, $2::uuid[], $3::text[])", [IDS.bob, [aliceCard], ["standard"]]); // prettier-ignore
    // A second copy for Alice so she has a spare at all.
    const spare = await giveCopies(IDS.alice, aliceCard, ["silver"]);

    const { offerId } = await createOffer(IDS.alice, IDS.bob, [copy(spare[0])], [copy(theirs[0])]);
    expect((await accept(offerId, IDS.bob)).ok).toBe(true);

    const moved = await copyRow(spare[0]);
    expect(moved.participant_id).toBe(IDS.bob);
    expect(moved.acquired_on).toBeNull();
    expect(moved.source).toBe("trade");
    expect(await pullCount(IDS.bob, aliceCard)).toBe(2);
  });

  it("moves several cards a side in one swap", async () => {
    const ids = await cardIds();
    await claim(IDS.alice);
    await claim(IDS.bob);
    const mine: string[] = [];
    for (const id of ids) mine.push((await giveRoster(IDS.alice, id, 2))[0]);
    const theirs = await giveRoster(IDS.bob, ids[0], 2);

    const { offerId } = await createOffer(IDS.alice, IDS.bob, mine.map(copy), [copy(theirs[0])]);
    expect((await accept(offerId, IDS.bob)).ok).toBe(true);

    for (const id of ids) expect(await pullCount(IDS.alice, id)).toBe(id === ids[0] ? 2 : 1);
    expect(await pullCount(IDS.bob, ids[0])).toBe(2);
    expect(await pullCount(IDS.bob, ids[1])).toBe(1);
  });
});

describe("accept_trade_offer — secret cards", () => {
  it("re-parents the copy and marks it granted", async () => {
    const { bobCopies } = await twoSpares();
    const card = await addCard("Gary the Grill");
    await giveSecret(IDS.alice, card, { duplicate: false });
    const spare = await giveSecret(IDS.alice, card, { duplicate: true, tier: "epic" });

    const { offerId } = await createOffer(
      IDS.alice,
      IDS.bob,
      [secret(spare)],
      [copy(bobCopies[0])],
    );
    expect((await accept(offerId, IDS.bob)).ok).toBe(true);

    const row = await secretRow(spare);
    expect(row.participant_id).toBe(IDS.bob);
    expect(row.granted).toBe(true);
    // Bob owned none of this card, so the copy he received IS his ownership row.
    expect(row.is_duplicate).toBe(false);
    // The tier travels: unlike an edition it is server-rolled, so it is a fact
    // about this copy rather than a claim.
    expect(row.tier).toBe("epic");

    // And Alice still owns hers — she gave away the duplicate, not the card.
    const [mine] = await sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.secret_card_pulls
        WHERE participant_id = $1 AND secret_card_id = $2 AND NOT is_duplicate`,
      [IDS.alice, card],
    );
    expect(mine.n).toBe(1);
  });

  it("arrives as a duplicate when the receiver already owns that card", async () => {
    const { bobCopies } = await twoSpares();
    const card = await addCard("Gary the Grill");
    await giveSecret(IDS.alice, card, { duplicate: false });
    const spare = await giveSecret(IDS.alice, card, { duplicate: true });
    await giveSecret(IDS.bob, card, { duplicate: false });

    const { offerId } = await createOffer(
      IDS.alice,
      IDS.bob,
      [secret(spare)],
      [copy(bobCopies[0])],
    );
    await accept(offerId, IDS.bob);

    expect((await secretRow(spare)).is_duplicate).toBe(true);
    // secret_card_pulls_owned_once would have refused a second ownership row, so
    // getting this wrong is an aborted accept rather than a quiet miscount.
    const [row] = await sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.secret_card_pulls
        WHERE participant_id = $1 AND secret_card_id = $2 AND NOT is_duplicate`,
      [IDS.bob, card],
    );
    expect(row.n).toBe(1);
  });

  it("turns two copies of one secret into one ownership row and one duplicate", async () => {
    const { bobCopies } = await twoSpares();
    const card = await addCard("Gary the Grill");
    await giveSecret(IDS.alice, card, { duplicate: false });
    const a = await giveSecret(IDS.alice, card, { duplicate: true });
    const b = await giveSecret(IDS.alice, card, { duplicate: true });

    const { offerId } = await createOffer(
      IDS.alice,
      IDS.bob,
      [secret(a), secret(b)],
      [copy(bobCopies[0])],
    );
    expect((await accept(offerId, IDS.bob)).ok).toBe(true);

    // The loop resolves items in a fixed order, so the first becomes Bob's
    // ownership row and the second sees it and files itself as a duplicate.
    const [row] = await sql<{ owned: number; dupes: number }>(
      `SELECT count(*) FILTER (WHERE NOT is_duplicate)::int AS owned,
              count(*) FILTER (WHERE is_duplicate)::int     AS dupes
         FROM public.secret_card_pulls
        WHERE participant_id = $1 AND secret_card_id = $2`,
      [IDS.bob, card],
    );
    expect(row).toEqual({ owned: 1, dupes: 1 });
  });

  it("still works when both people already pulled on the day the copy was pulled", async () => {
    // THE REGRESSION. secret_card_pulls_one_per_day is
    // UNIQUE (participant_id, pulled_on) WHERE NOT granted. Alice's spare and
    // Bob's own pull share a day, so re-parenting without setting granted = true
    // violates it and the whole accept aborts — on every day both of them pulled,
    // which in a league where everyone pulls daily is nearly every day.
    const { bobCopies } = await twoSpares();
    const card = await addCard("Gary the Grill");
    const other = await addCard("The Dog");

    await giveSecret(IDS.alice, card, { duplicate: false });
    const spare = await giveSecret(IDS.alice, card, {
      duplicate: true,
      granted: false,
      day: OTHER_DAY,
    });
    // Bob's own daily pull, same league day, also un-granted.
    await giveSecret(IDS.bob, other, { duplicate: false, granted: false, day: OTHER_DAY });

    const { offerId } = await createOffer(
      IDS.alice,
      IDS.bob,
      [secret(spare)],
      [copy(bobCopies[0])],
    );
    expect((await accept(offerId, IDS.bob)).ok).toBe(true);

    const moved = await secretRow(spare);
    expect(moved.participant_id).toBe(IDS.bob);
    expect(moved.granted).toBe(true);

    // Bob now holds two rows on the same day, which only granted = true permits.
    const [row] = await sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.secret_card_pulls
        WHERE participant_id = $1 AND pulled_on = $2::date`,
      [IDS.bob, OTHER_DAY],
    );
    expect(row.n).toBe(2);
  });

  it("leaves the giver holding none of a card they only had one of", async () => {
    const { bobCopies } = await twoSpares();
    const card = await addCard("Gary the Grill");
    const only = await giveSecret(IDS.alice, card, { duplicate: false, tier: "mythic" });

    const { offerId } = await createOffer(IDS.alice, IDS.bob, [secret(only)], [copy(bobCopies[0])]);
    expect((await accept(offerId, IDS.bob)).ok).toBe(true);

    const [mine] = await sql<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.secret_card_pulls WHERE participant_id = $1 AND secret_card_id = $2", // prettier-ignore
      [IDS.alice, card],
    );
    expect(mine.n).toBe(0);

    // And it is the receiver's outright, at the tier it was rolled at.
    const moved = await secretRow(only);
    expect(moved.participant_id).toBe(IDS.bob);
    expect(moved.is_duplicate).toBe(false);
    expect(moved.tier).toBe("mythic");
  });

  it("promotes a remaining duplicate when the owning row is the one traded", async () => {
    // The reason this needed more than a relaxed condition. `is_duplicate = false`
    // is the "you own this" marker that four different counts read; hand it over
    // while keeping duplicates and the giver becomes an owner of nothing who still
    // has rows — visible in the vault, absent from every count, and eligible to be
    // dealt the same card again as new.
    const { bobCopies } = await twoSpares();
    const card = await addCard("Gary the Grill");
    const owning = await giveSecret(IDS.alice, card, { duplicate: false, tier: "common" });
    await giveSecret(IDS.alice, card, { duplicate: true, tier: "rare" });
    await giveSecret(IDS.alice, card, { duplicate: true, tier: "legendary" });

    const { offerId } = await createOffer(
      IDS.alice,
      IDS.bob,
      [secret(owning)],
      [copy(bobCopies[0])],
    );
    expect((await accept(offerId, IDS.bob)).ok).toBe(true);

    const rows = await sql<{ tier: string; is_duplicate: boolean }>(
      `SELECT tier, is_duplicate FROM public.secret_card_pulls
        WHERE participant_id = $1 AND secret_card_id = $2 ORDER BY is_duplicate`,
      [IDS.alice, card],
    );
    // Exactly one owning row, and it is the best of what she kept — best-wins, the
    // same rule every other copy question in this app answers with.
    expect(rows.filter((r) => !r.is_duplicate)).toEqual([
      { tier: "legendary", is_duplicate: false },
    ]);
    expect(rows).toHaveLength(2);
  });

  it("does not promote anything when the giver kept their owning row", async () => {
    const { bobCopies } = await twoSpares();
    const card = await addCard("Gary the Grill");
    await giveSecret(IDS.alice, card, { duplicate: false, tier: "common" });
    const dupe = await giveSecret(IDS.alice, card, { duplicate: true, tier: "mythic" });

    const { offerId } = await createOffer(IDS.alice, IDS.bob, [secret(dupe)], [copy(bobCopies[0])]);
    await accept(offerId, IDS.bob);

    // Still exactly one owning row, and still the one she had — a promotion here
    // would breach secret_card_pulls_owned_once.
    const rows = await sql<{ tier: string; is_duplicate: boolean }>(
      "SELECT tier, is_duplicate FROM public.secret_card_pulls WHERE participant_id = $1 AND secret_card_id = $2", // prettier-ignore
      [IDS.alice, card],
    );
    expect(rows).toEqual([{ tier: "common", is_duplicate: false }]);
  });

  it("still refuses today's own pull, even as somebody's only copy", async () => {
    // The relaxation must not reopen the daily-pull bypass: trading away today's
    // row would clear the evidence that the slot was spent.
    const { bobCopies } = await twoSpares();
    const card = await addCard("Gary the Grill");
    const [{ today }] = await sql<{ today: string }>(
      "SELECT (now() AT TIME ZONE 'America/New_York')::date::text AS today",
    );
    const todays = await giveSecret(IDS.alice, card, {
      duplicate: false,
      granted: false,
      day: today,
    });
    await expect(
      createOffer(IDS.alice, IDS.bob, [secret(todays)], [copy(bobCopies[0])]),
    ).rejects.toThrow(/spare/i);
  });

  it("does not give the giver their daily pull back", async () => {
    // The other side of the granted = true decision. Because the moved row is now
    // granted, it no longer counts as Alice's spent slot for that day — which is
    // exactly why trade_item_is_spare refuses TODAY's copy. Yesterday's is fine:
    // she cannot retroactively pull again for a day that has passed.
    const { bobCopies } = await twoSpares();
    const card = await addCard("Gary the Grill");
    await giveSecret(IDS.alice, card, { duplicate: false });
    const spare = await giveSecret(IDS.alice, card, {
      duplicate: true,
      granted: false,
      day: OTHER_DAY,
    });

    const { offerId } = await createOffer(
      IDS.alice,
      IDS.bob,
      [secret(spare)],
      [copy(bobCopies[0])],
    );
    await accept(offerId, IDS.bob);

    const [row] = await sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.secret_card_pulls
        WHERE participant_id = $1 AND pulled_on = (now() AT TIME ZONE 'America/New_York')::date
          AND NOT granted`,
      [IDS.alice],
    );
    expect(row.n).toBe(0);
  });
});

describe("accept_trade_offer — lifecycle", () => {
  it("voids rather than raising when a staked card has already moved", async () => {
    const { aliceCard, bobCard, aliceCopies, bobCopies } = await twoSpares();
    const { offerId } = await createOffer(
      IDS.alice,
      IDS.bob,
      [copy(aliceCopies[0])],
      [copy(bobCopies[0])],
    );
    // Alice's spare evaporates between composing and accepting: her second copy
    // goes, so the one on the table is now the only copy she holds.
    await sql("DELETE FROM public.card_copies WHERE id = $1", [aliceCopies[1]]);
    await sql("SELECT public.resync_card_pull($1, $2)", [IDS.alice, aliceCard]);

    const res = await accept(offerId, IDS.bob);
    expect(res).toEqual({ ok: false, reason: "voided" });

    // Returned rather than raised precisely so this survives: a raise would roll
    // the void back and leave the offer pending, failing again on every retry.
    expect(await offerStatus(offerId)).toBe("voided");

    // And nothing moved.
    expect(await pullCount(IDS.alice, aliceCard)).toBe(1);
    expect(await pullCount(IDS.bob, aliceCard)).toBeNull();
    expect(await pullCount(IDS.bob, bobCard)).toBe(2);
    expect(await sql("SELECT count(*)::int AS n FROM public.trades")).toEqual([{ n: 0 }]);
  });

  it("voids rather than turning a swap into a gift when one side is deleted out", async () => {
    // An item can vanish from under a pending offer with nobody touching the
    // offer: trade_offer_items cascades from card_copies, which cascades from
    // event_participants — so removeParticipantFromEvent on a rostered player
    // empties that side. The per-item re-validation iterates what REMAINS and an
    // empty set passes it vacuously, so without trade_has_both_sides the
    // recipient could accept, hand over their card, and receive nothing.
    const { bobCard, aliceCopies, bobCopies } = await twoSpares();
    const [aliceCard] = await cardIds();
    const { offerId } = await createOffer(
      IDS.alice,
      IDS.bob,
      [copy(aliceCopies[0])],
      [copy(bobCopies[0])],
    );

    // The real chain, not a hand-deleted item: drop the roster entry.
    await sql("DELETE FROM public.event_participants WHERE id = $1", [aliceCard]);
    const [{ n }] = await sql<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.trade_offer_items WHERE offer_id = $1 AND giver_side = 'proposer'", // prettier-ignore
      [offerId],
    );
    expect(n).toBe(0);

    expect(await accept(offerId, IDS.bob)).toEqual({ ok: false, reason: "voided" });
    expect(await offerStatus(offerId)).toBe("voided");
    // Bob kept both of his: nothing moved, and no trade was announced.
    expect(await pullCount(IDS.bob, bobCard)).toBe(2);
    expect(await sql("SELECT count(*)::int AS n FROM public.trades")).toEqual([{ n: 0 }]);
  });

  it("refuses somebody accepting an offer that is not theirs", async () => {
    const { aliceCopies, bobCopies } = await twoSpares();
    const { offerId } = await createOffer(
      IDS.alice,
      IDS.bob,
      [copy(aliceCopies[0])],
      [copy(bobCopies[0])],
    );
    // Including the proposer: composing an offer is not accepting it.
    await expect(accept(offerId, IDS.alice)).rejects.toThrow(/not your offer/i);
    await expect(accept(offerId, IDS.carol)).rejects.toThrow(/not your offer/i);
    expect(await offerStatus(offerId)).toBe("pending");
  });

  it("answers a second accept softly rather than trading twice", async () => {
    const { aliceCard, aliceCopies, bobCopies } = await twoSpares();
    const { offerId } = await createOffer(
      IDS.alice,
      IDS.bob,
      [copy(aliceCopies[0])],
      [copy(bobCopies[0])],
    );
    expect((await accept(offerId, IDS.bob)).ok).toBe(true);

    const again = await accept(offerId, IDS.bob);
    expect(again).toEqual({ ok: false, reason: "resolved" });
    // A double-tap gets a toast, and the cards move once.
    expect(await pullCount(IDS.alice, aliceCard)).toBe(1);
    expect(await sql("SELECT count(*)::int AS n FROM public.trades")).toEqual([{ n: 1 }]);
  });

  it("names the secret that moved, and still publishes no finish", async () => {
    // THE ASSERTION WHOSE ABSENCE LET THE FEED REGRESS. 20260825000127 widened
    // this deliberately — the league asked to read which secret changed hands —
    // and 20260825120000 re-created accept_trade_offer from a copy that predated
    // it, silently putting "a secret" back. This test asserted the pre-widening
    // shape, so it went green against the revert and nobody noticed.
    //
    // What must still never appear: an edition. `trades` is anon-readable AND
    // realtime-published, and what finish somebody handed over is between the two
    // people in the trade. A name is the whole of the widening — no art path, no
    // tier, and nothing at all about a card nobody has traded.
    const { bobCard, bobCopies } = await twoSpares();
    const card = await addCard("Gary the Grill");
    await giveSecret(IDS.alice, card, { duplicate: false });
    const spare = await giveSecret(IDS.alice, card, { duplicate: true });
    // Make the recipient's staked copy a conspicuous finish, so a leak would show.
    await sql("UPDATE public.card_copies SET edition = 'platinum' WHERE id = $1", [bobCopies[0]]);

    const { offerId } = await createOffer(
      IDS.alice,
      IDS.bob,
      [secret(spare)],
      [copy(bobCopies[0])],
    );
    const res = await accept(offerId, IDS.bob);

    const [row] = await sql<{
      id: string;
      event_id: string;
      proposer_id: string;
      recipient_id: string;
      proposer_gave: unknown[];
      recipient_gave: unknown[];
    }>("SELECT * FROM public.trades WHERE id = $1", [res.tradeId!]);

    expect(row.proposer_id).toBe(IDS.alice);
    expect(row.recipient_id).toBe(IDS.bob);
    expect(row.event_id).toBe(IDS.event);
    expect(row.proposer_gave).toEqual([
      { kind: "secret", secretCardId: card, name: "Gary the Grill" },
    ]);
    // The CARD, resolved from the copy — and nothing about the copy itself.
    expect(row.recipient_gave).toEqual([{ kind: "roster", eventParticipantId: bobCard }]);

    const blob = JSON.stringify(row.proposer_gave) + JSON.stringify(row.recipient_gave);
    // The pull row's id is not the card's, and it is nobody else's business.
    expect(blob).not.toContain(spare);
    expect(blob).not.toContain("platinum");
    expect(blob).not.toContain("edition");
    expect(blob).not.toContain(bobCopies[0]);
  });

  it("marks the offer accepted and stamps when", async () => {
    const { aliceCopies, bobCopies } = await twoSpares();
    const { offerId } = await createOffer(
      IDS.alice,
      IDS.bob,
      [copy(aliceCopies[0])],
      [copy(bobCopies[0])],
    );
    await accept(offerId, IDS.bob);
    const [row] = await sql<{ status: string; resolved_at: string | null }>(
      "SELECT status, resolved_at FROM public.trade_offers WHERE id = $1",
      [offerId],
    );
    expect(row.status).toBe("accepted");
    expect(row.resolved_at).not.toBeNull();
  });

  it("raises on an offer that does not exist", async () => {
    await expect(accept("00000000-0000-4000-8000-00000000dead", IDS.bob)).rejects.toThrow(
      /not found/i,
    );
  });
});

describe("two accepts racing over one spare", () => {
  it("produces one winner and one voided offer, and no deadlock", async () => {
    // The mirror-image case the least()/greatest() lock order exists for: Alice
    // accepting Bob's offer at the same instant Bob accepts Alice's. Locking
    // "proposer then recipient" would take the same two participant rows in
    // opposite orders in the two transactions, which is a deadlock.
    //
    // Both offers stake the same two copies, so only one can win on the merits
    // too — the loser re-validates under the lock and voids itself.
    const { aliceCard, bobCard, aliceCopies, bobCopies } = await twoSpares();

    const first = await createOffer(
      IDS.alice,
      IDS.bob,
      [copy(aliceCopies[0])],
      [copy(bobCopies[0])],
    );
    const second = await createOffer(
      IDS.bob,
      IDS.alice,
      [copy(bobCopies[0])],
      [copy(aliceCopies[0])],
    );

    const c1 = await newClient();
    const c2 = await newClient();
    try {
      const [r1, r2] = await Promise.all([
        c1.query<{ r: AcceptResult }>("SELECT public.accept_trade_offer($1, $2) AS r", [
          first.offerId,
          IDS.bob,
        ]),
        c2.query<{ r: AcceptResult }>("SELECT public.accept_trade_offer($1, $2) AS r", [
          second.offerId,
          IDS.alice,
        ]),
      ]);

      const outcomes = [r1.rows[0].r, r2.rows[0].r];
      expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
      expect(outcomes.filter((o) => !o.ok && o.reason === "voided")).toHaveLength(1);
    } finally {
      await c1.end();
      await c2.end();
    }

    // Exactly one trade happened, and the copies were spent once.
    expect(await sql("SELECT count(*)::int AS n FROM public.trades")).toEqual([{ n: 1 }]);
    expect(await pullCount(IDS.alice, aliceCard)).toBe(1);
    expect(await pullCount(IDS.bob, bobCard)).toBe(1);

    const statuses = await sql<{ status: string }>(
      "SELECT status FROM public.trade_offers ORDER BY status",
    );
    expect(statuses.map((s) => s.status)).toEqual(["accepted", "voided"]);
  });
});

describe("reopen_trade_offer", () => {
  /** Alice offers Bob a spare, Bob says no. The state every case below starts from. */
  async function declined() {
    const { aliceCard, bobCard, aliceCopies, bobCopies } = await twoSpares();
    const { offerId } = await createOffer(
      IDS.alice,
      IDS.bob,
      [copy(aliceCopies[0])],
      [copy(bobCopies[0])],
    );
    await settle(offerId, "declined");
    return { offerId, aliceCard, bobCard, aliceCopies, bobCopies };
  }

  it("puts a declined offer back for the person who declined it", async () => {
    const { offerId } = await declined();

    expect(await reopen(offerId, IDS.bob)).toEqual({ ok: true, counterpartyId: IDS.alice });
    expect(await offerStatus(offerId)).toBe("pending");
    // A pending offer carries no resolution date, so the reopened one must not
    // either — getMyTradeOffers sorts the recent shelf on it, and a pending offer
    // with a resolved_at would file itself under settled.
    expect(
      await sql("SELECT resolved_at FROM public.trade_offers WHERE id = $1", [offerId]),
    ).toEqual([{ resolved_at: null }]);

    // And it is a real offer again, not just a row that says pending.
    expect(await accept(offerId, IDS.bob)).toMatchObject({ ok: true });
  });

  it("puts a cancelled offer back for the person who pulled it", async () => {
    const { aliceCopies, bobCopies } = await twoSpares();
    const { offerId } = await createOffer(
      IDS.alice,
      IDS.bob,
      [copy(aliceCopies[0])],
      [copy(bobCopies[0])],
    );
    await settle(offerId, "cancelled");

    expect(await reopen(offerId, IDS.alice)).toEqual({ ok: true, counterpartyId: IDS.bob });
    expect(await offerStatus(offerId)).toBe("pending");
  });

  it("refuses the other side of the same offer", async () => {
    // The direction is the point. Alice must not be able to un-decline an offer
    // Bob declined — that would put her own offer back in his inbox after he had
    // answered it, which is nagging with extra steps.
    const { offerId } = await declined();
    await expect(reopen(offerId, IDS.alice)).rejects.toThrow(/not your offer/i);
    expect(await offerStatus(offerId)).toBe("declined");
  });

  it("refuses somebody who is not in the trade at all", async () => {
    const { offerId } = await declined();
    await expect(reopen(offerId, IDS.carol)).rejects.toThrow(/not your offer/i);
    expect(await offerStatus(offerId)).toBe("declined");
  });

  it("says so rather than raising when the offer has moved on", async () => {
    // Pending, accepted and voided are all somebody else's answer, and none of
    // them is ours to overwrite. A person gets a sentence, not a stack trace.
    const { aliceCopies, bobCopies } = await twoSpares();
    const { offerId } = await createOffer(
      IDS.alice,
      IDS.bob,
      [copy(aliceCopies[0])],
      [copy(bobCopies[0])],
    );
    expect(await reopen(offerId, IDS.bob)).toEqual({ ok: false, reason: "resolved" });

    await accept(offerId, IDS.bob);
    expect(await reopen(offerId, IDS.bob)).toEqual({ ok: false, reason: "resolved" });
    expect(await offerStatus(offerId)).toBe("accepted");
  });

  it("closes the window", async () => {
    const { offerId } = await declined();
    await settle(offerId, "declined", 61);

    expect(await reopen(offerId, IDS.bob)).toEqual({ ok: false, reason: "expired" });
    expect(await offerStatus(offerId)).toBe("declined");
  });

  it("refuses once a staked card has been spent", async () => {
    // A minute is long enough to go and burn a spare. Putting the offer back
    // with a card that has gone would only queue up a void on the next tap, and
    // spend the other person's attention on a swap that cannot happen.
    const { offerId, aliceCard, aliceCopies } = await declined();
    await sql("DELETE FROM public.card_copies WHERE id = $1", [aliceCopies[1]]);
    await sql("SELECT public.resync_card_pull($1, $2)", [IDS.alice, aliceCard]);

    expect(await reopen(offerId, IDS.bob)).toEqual({ ok: false, reason: "stale" });
    // Left settled rather than voided, which is where this parts company with
    // accept: accept has to void because it is the last chance to stop a
    // half-finished swap. Nothing here is half-finished.
    expect(await offerStatus(offerId)).toBe("declined");
  });

  it("refuses once one side has been emptied out from under it", async () => {
    // The trade_has_both_sides case, which cascades rather than being anybody's
    // decision: trade_offer_items follows card_copies, which follows
    // event_participants. An offer put back with one side gone is a gift.
    const { offerId, bobCopies } = await declined();
    await sql("DELETE FROM public.card_copies WHERE id = ANY($1::uuid[])", [bobCopies]);

    expect(await reopen(offerId, IDS.bob)).toEqual({ ok: false, reason: "stale" });
    expect(await offerStatus(offerId)).toBe("declined");
  });

  it("raises on an offer that does not exist", async () => {
    await expect(reopen(IDS.outsider, IDS.bob)).rejects.toThrow(/offer not found/i);
  });
});
