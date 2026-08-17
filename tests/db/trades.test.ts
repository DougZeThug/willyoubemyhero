// The trading RPCs, against real Postgres.
//
// Three properties live here and nowhere else, and each one is invisible to a
// mocked test because each one is a fact about Postgres rather than about our
// code:
//
//  1. Re-parenting a secret pull does not trip `secret_card_pulls_one_per_day`.
//     That index is UNIQUE (participant_id, pulled_on) WHERE NOT granted, so the
//     accept only survives because it sets granted = true — and it only fails on
//     days both people pulled, which is most of them.
//  2. The giver's card_pulls row survives every roster transfer, so the row count
//     per card — the public "Packed by N" number — cannot move because of a trade.
//  3. Two accepts racing over one spare produce one winner and one voided offer,
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
type Item =
  | { kind: "roster"; eventParticipantId: string }
  | { kind: "secret"; secretPullId: string };

const roster = (eventParticipantId: string): Item => ({ kind: "roster", eventParticipantId });
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

/** `count` copies of one roster card. 2 is the smallest number that makes a spare. */
async function giveRoster(participantId: string, ep: string, count = 2, edition = "standard") {
  await sql(
    `INSERT INTO public.card_pulls (participant_id, event_participant_id, pull_count, edition)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (participant_id, event_participant_id)
       DO UPDATE SET pull_count = EXCLUDED.pull_count, edition = EXCLUDED.edition`,
    [participantId, ep, count, edition],
  );
}

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

async function pullCount(participantId: string, ep: string): Promise<number | null> {
  const rows = await sql<{ pull_count: number }>(
    "SELECT pull_count FROM public.card_pulls WHERE participant_id = $1 AND event_participant_id = $2",
    [participantId, ep],
  );
  return rows[0]?.pull_count ?? null;
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

/** Alice and Bob, both claimed, each holding a spare of a different roster card. */
async function twoSpares() {
  const [aliceCard, bobCard] = await cardIds();
  await claim(IDS.alice);
  await claim(IDS.bob);
  await giveRoster(IDS.alice, aliceCard, 2);
  await giveRoster(IDS.bob, bobCard, 2);
  return { aliceCard, bobCard };
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
    const { aliceCard, bobCard } = await twoSpares();
    const res = await createOffer(IDS.alice, IDS.bob, [roster(aliceCard)], [roster(bobCard)]);

    expect(res.ok).toBe(true);
    expect(await offerStatus(res.offerId)).toBe("pending");

    const items = await sql<{ giver_side: string; kind: string; event_participant_id: string }>(
      "SELECT giver_side, kind, event_participant_id FROM public.trade_offer_items WHERE offer_id = $1 ORDER BY giver_side",
      [res.offerId],
    );
    expect(items).toEqual([
      { giver_side: "proposer", kind: "roster", event_participant_id: aliceCard },
      { giver_side: "recipient", kind: "roster", event_participant_id: bobCard },
    ]);
  });

  it("refuses a trade with yourself", async () => {
    const { aliceCard } = await twoSpares();
    await expect(
      createOffer(IDS.alice, IDS.alice, [roster(aliceCard)], [roster(aliceCard)]),
    ).rejects.toThrow(/yourself/i);
  });

  it("refuses an offer to somebody who has not claimed their player", async () => {
    // Carol is on the roster but has no member_codes row, so no device holds a
    // token for her: an offer would sit pending forever with nobody able to
    // decline it.
    const [aliceCard, , carolCard] = await cardIds();
    await claim(IDS.alice);
    await giveRoster(IDS.alice, aliceCard, 2);
    await giveRoster(IDS.carol, carolCard, 2);
    await expect(
      createOffer(IDS.alice, IDS.carol, [roster(aliceCard)], [roster(carolCard)]),
    ).rejects.toThrow(/claimed/i);
  });

  it("refuses an empty side", async () => {
    const { aliceCard } = await twoSpares();
    await expect(createOffer(IDS.alice, IDS.bob, [roster(aliceCard)], [])).rejects.toThrow(
      /one to four/i,
    );
  });

  it("refuses more than four cards on a side", async () => {
    const ids = await cardIds();
    await claim(IDS.alice);
    await claim(IDS.bob);
    for (const id of ids) await giveRoster(IDS.alice, id, 2);
    await giveRoster(IDS.bob, ids[0], 2);
    // Five items, built from three real cards plus repeats — the length check
    // runs before anything looks at what the items name.
    const five = [...ids, ...ids.slice(0, 2)].map(roster);
    await expect(createOffer(IDS.alice, IDS.bob, five, [roster(ids[0])])).rejects.toThrow(
      /one to four/i,
    );
  });

  it("refuses a roster card the giver holds only one copy of", async () => {
    const { bobCard } = await twoSpares();
    const [aliceCard] = await cardIds();
    // The whole spares rule: one copy is the copy you keep.
    await giveRoster(IDS.alice, aliceCard, 1);
    await expect(
      createOffer(IDS.alice, IDS.bob, [roster(aliceCard)], [roster(bobCard)]),
    ).rejects.toThrow(/spare/i);
  });

  it("refuses a roster card the giver has never packed at all", async () => {
    const { bobCard } = await twoSpares();
    const [, , carolCard] = await cardIds();
    await expect(
      createOffer(IDS.alice, IDS.bob, [roster(carolCard)], [roster(bobCard)]),
    ).rejects.toThrow(/spare/i);
  });

  it("refuses to stake a card out of somebody else's collection", async () => {
    const { aliceCard, bobCard } = await twoSpares();
    // Alice naming Bob's spare on HER side of the table. The giver of each item
    // is resolved from the side it sits on, so this is Alice claiming to hold a
    // card that is in Bob's collection.
    await expect(
      createOffer(IDS.alice, IDS.bob, [roster(bobCard)], [roster(aliceCard)]),
    ).rejects.toThrow(/spare/i);
  });

  it("refuses a secret copy that is not a duplicate", async () => {
    const { bobCard } = await twoSpares();
    const card = await addCard("Gary the Grill");
    const owned = await giveSecret(IDS.alice, card, { duplicate: false });
    await expect(
      createOffer(IDS.alice, IDS.bob, [secret(owned)], [roster(bobCard)]),
    ).rejects.toThrow(/spare/i);
  });

  it("refuses a secret copy belonging to somebody else", async () => {
    const { bobCard } = await twoSpares();
    const card = await addCard("Gary the Grill");
    await giveSecret(IDS.bob, card, { duplicate: false });
    const bobsDupe = await giveSecret(IDS.bob, card, { duplicate: true });
    await expect(
      createOffer(IDS.alice, IDS.bob, [secret(bobsDupe)], [roster(bobCard)]),
    ).rejects.toThrow(/spare/i);
  });

  it("refuses today's own pull, which is the giver's spent daily slot", async () => {
    // Not tidiness — a daily-limit bypass. pull_secret_card decides whether you
    // have pulled today by looking for `pulled_on = today AND NOT granted`, and
    // the accept sets granted = true on the row it moves. Trading today's
    // duplicate away would delete the evidence and hand the giver a second pull.
    const { bobCard } = await twoSpares();
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
      createOffer(IDS.alice, IDS.bob, [secret(todays)], [roster(bobCard)]),
    ).rejects.toThrow(/spare/i);
  });

  it("lets the same copy trade once the day has passed", async () => {
    // The other half of the rule above: yesterday's duplicate is an ordinary
    // spare, so the restriction costs a day rather than the feature.
    const { bobCard } = await twoSpares();
    const card = await addCard("Gary the Grill");
    await giveSecret(IDS.alice, card, { duplicate: false });
    const yesterdays = await giveSecret(IDS.alice, card, {
      duplicate: true,
      granted: false,
      day: OTHER_DAY,
    });
    const res = await createOffer(IDS.alice, IDS.bob, [secret(yesterdays)], [roster(bobCard)]);
    expect(res.ok).toBe(true);
  });

  it("refuses to stake the same roster card twice in one offer", async () => {
    // The unique index rather than a check: the accept decrements once per item,
    // so two items naming one card would spend two copies against a single spare.
    const { aliceCard, bobCard } = await twoSpares();
    await expect(
      createOffer(IDS.alice, IDS.bob, [roster(aliceCard), roster(aliceCard)], [roster(bobCard)]),
    ).rejects.toThrow();
  });

  it("refuses an item that names neither kind of card", async () => {
    const { bobCard } = await twoSpares();
    const junk = [{ kind: "roster" }] as unknown as Item[];
    await expect(createOffer(IDS.alice, IDS.bob, junk, [roster(bobCard)])).rejects.toThrow(
      /must name/i,
    );
  });

  it("leaves nothing behind when it refuses", async () => {
    const { bobCard } = await twoSpares();
    const [aliceCard] = await cardIds();
    await giveRoster(IDS.alice, aliceCard, 1);
    await expect(
      createOffer(IDS.alice, IDS.bob, [roster(aliceCard)], [roster(bobCard)]),
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
    const { aliceCard, bobCard } = await twoSpares();
    const { offerId } = await createOffer(
      IDS.alice,
      IDS.bob,
      [roster(aliceCard)],
      [roster(bobCard)],
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
    const { aliceCard, bobCard } = await twoSpares();
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
      [roster(aliceCard)],
      [roster(bobCard)],
    );
    await accept(offerId, IDS.bob);

    expect(await packedBy(aliceCard)).toBe(2);
    expect(await packedBy(bobCard)).toBe(2);
  });

  it("hands the receiver a standard finish rather than the giver's", async () => {
    // EDITIONS DO NOT TRANSFER. There is no per-copy edition to move, and the
    // column is client-asserted — transferring it would launder an unverified
    // value into a second member's row.
    const { aliceCard, bobCard } = await twoSpares();
    await giveRoster(IDS.alice, aliceCard, 2, "platinum");

    const { offerId } = await createOffer(
      IDS.alice,
      IDS.bob,
      [roster(aliceCard)],
      [roster(bobCard)],
    );
    await accept(offerId, IDS.bob);

    const [row] = await sql<{ edition: string }>(
      "SELECT edition FROM public.card_pulls WHERE participant_id = $1 AND event_participant_id = $2",
      [IDS.bob, aliceCard],
    );
    expect(row.edition).toBe("standard");
    // And the giver keeps theirs — a trade is not a downgrade either.
    const [mine] = await sql<{ edition: string }>(
      "SELECT edition FROM public.card_pulls WHERE participant_id = $1 AND event_participant_id = $2",
      [IDS.alice, aliceCard],
    );
    expect(mine.edition).toBe("platinum");
  });

  it("bumps a receiver who already holds the card and leaves their finish alone", async () => {
    const { aliceCard, bobCard } = await twoSpares();
    // Bob already holds one of Alice's card, in a better finish than a traded
    // copy would ever arrive in.
    await giveRoster(IDS.bob, aliceCard, 1, "gold");

    const { offerId } = await createOffer(
      IDS.alice,
      IDS.bob,
      [roster(aliceCard)],
      [roster(bobCard)],
    );
    await accept(offerId, IDS.bob);

    const [row] = await sql<{ pull_count: number; edition: string }>(
      "SELECT pull_count, edition FROM public.card_pulls WHERE participant_id = $1 AND event_participant_id = $2",
      [IDS.bob, aliceCard],
    );
    expect(row).toEqual({ pull_count: 2, edition: "gold" });
  });

  it("moves up to four cards a side in one swap", async () => {
    const ids = await cardIds();
    await claim(IDS.alice);
    await claim(IDS.bob);
    for (const id of ids) {
      await giveRoster(IDS.alice, id, 2);
      await giveRoster(IDS.bob, id, 2);
    }
    const { offerId } = await createOffer(IDS.alice, IDS.bob, ids.map(roster), [roster(ids[0])]);
    expect((await accept(offerId, IDS.bob)).ok).toBe(true);

    for (const id of ids) expect(await pullCount(IDS.alice, id)).toBe(id === ids[0] ? 2 : 1);
    expect(await pullCount(IDS.bob, ids[0])).toBe(2);
    expect(await pullCount(IDS.bob, ids[1])).toBe(3);
  });
});

describe("accept_trade_offer — secret cards", () => {
  it("re-parents the copy and marks it granted", async () => {
    const { bobCard } = await twoSpares();
    const card = await addCard("Gary the Grill");
    await giveSecret(IDS.alice, card, { duplicate: false });
    const spare = await giveSecret(IDS.alice, card, { duplicate: true, tier: "epic" });

    const { offerId } = await createOffer(IDS.alice, IDS.bob, [secret(spare)], [roster(bobCard)]);
    expect((await accept(offerId, IDS.bob)).ok).toBe(true);

    const row = await secretRow(spare);
    expect(row.participant_id).toBe(IDS.bob);
    expect(row.granted).toBe(true);
    // Bob owned none of this card, so the copy he received IS his ownership row.
    expect(row.is_duplicate).toBe(false);
    // The tier travels: unlike an edition it is server-rolled, so it is a fact
    // about this copy rather than a claim about it.
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
    const { bobCard } = await twoSpares();
    const card = await addCard("Gary the Grill");
    await giveSecret(IDS.alice, card, { duplicate: false });
    const spare = await giveSecret(IDS.alice, card, { duplicate: true });
    await giveSecret(IDS.bob, card, { duplicate: false });

    const { offerId } = await createOffer(IDS.alice, IDS.bob, [secret(spare)], [roster(bobCard)]);
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
    const { bobCard } = await twoSpares();
    const card = await addCard("Gary the Grill");
    await giveSecret(IDS.alice, card, { duplicate: false });
    const a = await giveSecret(IDS.alice, card, { duplicate: true });
    const b = await giveSecret(IDS.alice, card, { duplicate: true });

    const { offerId } = await createOffer(
      IDS.alice,
      IDS.bob,
      [secret(a), secret(b)],
      [roster(bobCard)],
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
    const { bobCard } = await twoSpares();
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

    const { offerId } = await createOffer(IDS.alice, IDS.bob, [secret(spare)], [roster(bobCard)]);
    expect((await accept(offerId, IDS.bob)).ok).toBe(true);

    const moved = await secretRow(spare);
    expect(moved.participant_id).toBe(IDS.bob);
    expect(moved.granted).toBe(true);
    expect(moved.pulled_on.toString()).toContain("2026");

    // Bob now holds two rows on the same day, which only granted = true permits.
    const [row] = await sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.secret_card_pulls
        WHERE participant_id = $1 AND pulled_on = $2::date`,
      [IDS.bob, OTHER_DAY],
    );
    expect(row.n).toBe(2);
  });

  it("does not give the giver their daily pull back", async () => {
    // The other side of the granted = true decision. Because the moved row is now
    // granted, it no longer counts as Alice's spent slot for that day — which is
    // exactly why trade_item_is_spare refuses TODAY's copy. Yesterday's is fine:
    // she cannot retroactively pull again for a day that has passed.
    const { bobCard } = await twoSpares();
    const card = await addCard("Gary the Grill");
    await giveSecret(IDS.alice, card, { duplicate: false });
    const spare = await giveSecret(IDS.alice, card, {
      duplicate: true,
      granted: false,
      day: OTHER_DAY,
    });

    const { offerId } = await createOffer(IDS.alice, IDS.bob, [secret(spare)], [roster(bobCard)]);
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
    const { aliceCard, bobCard } = await twoSpares();
    const { offerId } = await createOffer(
      IDS.alice,
      IDS.bob,
      [roster(aliceCard)],
      [roster(bobCard)],
    );
    // Alice's spare evaporates between composing and accepting.
    await sql(
      "UPDATE public.card_pulls SET pull_count = 1 WHERE participant_id = $1 AND event_participant_id = $2",
      [IDS.alice, aliceCard],
    );

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

  it("refuses somebody accepting an offer that is not theirs", async () => {
    const { aliceCard, bobCard } = await twoSpares();
    const { offerId } = await createOffer(
      IDS.alice,
      IDS.bob,
      [roster(aliceCard)],
      [roster(bobCard)],
    );
    // Including the proposer: composing an offer is not accepting it.
    await expect(accept(offerId, IDS.alice)).rejects.toThrow(/not your offer/i);
    await expect(accept(offerId, IDS.carol)).rejects.toThrow(/not your offer/i);
    expect(await offerStatus(offerId)).toBe("pending");
  });

  it("answers a second accept softly rather than trading twice", async () => {
    const { aliceCard, bobCard } = await twoSpares();
    const { offerId } = await createOffer(
      IDS.alice,
      IDS.bob,
      [roster(aliceCard)],
      [roster(bobCard)],
    );
    expect((await accept(offerId, IDS.bob)).ok).toBe(true);

    const again = await accept(offerId, IDS.bob);
    expect(again).toEqual({ ok: false, reason: "resolved" });
    // A double-tap gets a toast, and the cards move once.
    expect(await pullCount(IDS.alice, aliceCard)).toBe(1);
    expect(await sql("SELECT count(*)::int AS n FROM public.trades")).toEqual([{ n: 1 }]);
  });

  it("records the trade publicly, naming no secret card", async () => {
    // The leak this table would otherwise be: `trades` is anon-readable AND
    // published to realtime, so a secret_card_id in these summaries hands the
    // catalogue to every phone in the garden.
    const { bobCard } = await twoSpares();
    const card = await addCard("Gary the Grill");
    await giveSecret(IDS.alice, card, { duplicate: false });
    const spare = await giveSecret(IDS.alice, card, { duplicate: true });

    const { offerId } = await createOffer(IDS.alice, IDS.bob, [secret(spare)], [roster(bobCard)]);
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
    expect(row.proposer_gave).toEqual([{ kind: "secret" }]);
    expect(row.recipient_gave).toEqual([{ kind: "roster", eventParticipantId: bobCard }]);

    // Belt and braces against the summary growing a field later: neither the
    // card's id nor the ledger row's may appear anywhere in the jsonb.
    const blob = JSON.stringify(row.proposer_gave) + JSON.stringify(row.recipient_gave);
    expect(blob).not.toContain(card);
    expect(blob).not.toContain(spare);
    expect(blob).not.toContain("secret_card_id");
  });

  it("marks the offer accepted and stamps when", async () => {
    const { aliceCard, bobCard } = await twoSpares();
    const { offerId } = await createOffer(
      IDS.alice,
      IDS.bob,
      [roster(aliceCard)],
      [roster(bobCard)],
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
    // Both offers stake the same two spares, so only one can win on the merits
    // too — the loser re-validates under the lock and voids itself.
    const { aliceCard, bobCard } = await twoSpares();

    const first = await createOffer(IDS.alice, IDS.bob, [roster(aliceCard)], [roster(bobCard)]);
    const second = await createOffer(IDS.bob, IDS.alice, [roster(bobCard)], [roster(aliceCard)]);

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

    // Exactly one trade happened, and the spares were spent once.
    expect(await sql("SELECT count(*)::int AS n FROM public.trades")).toEqual([{ n: 1 }]);
    expect(await pullCount(IDS.alice, aliceCard)).toBe(1);
    expect(await pullCount(IDS.bob, bobCard)).toBe(1);

    const statuses = await sql<{ status: string }>(
      "SELECT status FROM public.trade_offers ORDER BY status",
    );
    expect(statuses.map((s) => s.status)).toEqual(["accepted", "voided"]);
  });
});
