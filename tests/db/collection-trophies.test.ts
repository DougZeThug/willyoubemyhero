// Completion trophies, against real Postgres.
//
// This suite is the feature. Everything else in R3a — the ceremony, the shelf,
// the badge — renders a decision that is made here, in SQL, inside the same
// transaction as the write that caused it. Three properties are invisible to a
// mocked test because all three are facts about Postgres:
//
//  1. Detection is ATOMIC with the acquisition. The trophy is minted under the
//     participant row lock that pull_secret_card and accept_trade_offer already
//     take, so two cards of one set arriving at once cannot both read
//     "not complete" and leave nobody told.
//  2. It is IDEMPOTENT by primary key, not by a check. Every acquiring path calls
//     the helper on every acquisition; the ON CONFLICT is what makes the second
//     one silent, and silence is what stops the ceremony firing twice.
//  3. The SIZE crossing the wire is the whole point, and it is the ONE number
//     this feature is otherwise built to withhold. A test that asserts it comes
//     back is asserting a product decision, not an implementation detail.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, IDS, isDenied, seedEvent, sql } from "./helpers";
// Imported rather than redeclared, so these tests pin the TypeScript shapes the
// client renders against what Postgres actually returns. A drift here is a
// ceremony that fires on a field the RPC stopped sending.
import type { CompletedCollection, CompletedCollectionFor } from "@/lib/collection-trophies";

afterAll(closeDb);
beforeEach(seedEvent);

/** Seeded by 20260819222006 and never truncated, so it is here in every suite. */
const SET = "pets";
const OTHER_SET = "wags";

/** A past league day. Anything on `current_date` is somebody's spent daily slot. */
const PAST_DAY = "2026-01-01";
const GUEST = "00000000-0000-4000-8000-0000000019a1";

type Trophy = CompletedCollection | null;
type Pull = { cardId: string; duplicate: boolean; fresh: boolean; completedCollection: Trophy };
type Grant = { cardId: string; duplicate: boolean; completedCollection: Trophy };
type Accept = { ok: boolean; reason?: string; completedCollections?: CompletedCollectionFor[] };

async function addCard(
  name: string,
  over: {
    collection?: string | null;
    active?: boolean;
    artPath?: string | null;
    weight?: number;
  } = {},
): Promise<string> {
  const [row] = await sql<{ id: string }>(
    `INSERT INTO public.secret_cards (name, art_path, active, collection, weight)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      name,
      over.artPath === undefined ? `secrets/${name}/art-1.webp` : over.artPath,
      over.active ?? true,
      over.collection === undefined ? SET : over.collection,
      over.weight ?? 100,
    ],
  );
  return row.id;
}

/**
 * One secret ledger row.
 *
 * `granted` defaults to true so seeding several cards for one person does not
 * collide on secret_card_pulls_one_per_day — the same reason giveSecret in
 * trades.test.ts does it, and the same reason the real grant path sets it.
 */
async function own(
  participantId: string,
  cardId: string,
  over: { duplicate?: boolean; day?: string } = {},
) {
  const [row] = await sql<{ id: string }>(
    `INSERT INTO public.secret_card_pulls
       (participant_id, secret_card_id, pulled_on, event_id, is_duplicate, granted, tier)
     VALUES ($1, $2, $3::date, $4, $5, true, 'common') RETURNING id`,
    [participantId, cardId, over.day ?? PAST_DAY, IDS.event, over.duplicate ?? false],
  );
  return row.id;
}

async function award(
  participantId: string | null,
  collection: string | null,
  via = "pull",
): Promise<Trophy> {
  const [row] = await sql<{ award_collection_trophy: Trophy }>(
    "SELECT public.award_collection_trophy($1, $2, $3, $4)",
    [participantId, collection, via, IDS.event],
  );
  return row.award_collection_trophy;
}

async function trophies() {
  return sql<{
    participant_id: string;
    collection_id: string;
    size_at_completion: number;
    via: string;
    completed_on: string;
  }>(
    `SELECT participant_id, collection_id, size_at_completion, via, completed_on
       FROM public.collection_trophies ORDER BY collection_id`,
  );
}

async function pull(participantId: string | null, guestId: string | null = null): Promise<Pull> {
  const [row] = await sql<{ pull_secret_card: Pull }>(
    "SELECT public.pull_secret_card($1, $2, $3)",
    [participantId, guestId, IDS.event],
  );
  return row.pull_secret_card;
}

async function grant(participantId: string, cardId: string): Promise<Grant> {
  const [row] = await sql<{ grant_secret_card: Grant }>(
    "SELECT public.grant_secret_card($1, $2, $3)",
    [participantId, cardId, IDS.event],
  );
  return row.grant_secret_card;
}

describe("award_collection_trophy", () => {
  it("mints a trophy once every active card in the set is owned, and says how big it was", async () => {
    const a = await addCard("Gary the Grill");
    const b = await addCard("The Gazebo");
    await own(IDS.alice, a);
    expect(await award(IDS.alice, SET)).toBeNull();

    await own(IDS.alice, b);
    expect(await award(IDS.alice, SET)).toMatchObject({ collection: SET, label: "Pets", size: 2 });
    expect(await trophies()).toEqual([
      {
        participant_id: IDS.alice,
        collection_id: SET,
        size_at_completion: 2,
        via: "pull",
        completed_on: expect.anything(),
      },
    ]);
  });

  it("returns null the second time, and does not restamp the day it was won", async () => {
    // The idempotence the three acquiring RPCs lean on: each one calls this on
    // EVERY acquisition, so without the ON CONFLICT a finished set would re-fire
    // its ceremony on every pull for the rest of the season.
    await own(IDS.alice, await addCard("Gary the Grill"));
    expect(await award(IDS.alice, SET)).not.toBeNull();

    await sql(
      "UPDATE public.collection_trophies SET completed_on = $1::date WHERE participant_id = $2",
      [PAST_DAY, IDS.alice],
    );
    expect(await award(IDS.alice, SET)).toBeNull();

    const [row] = await trophies();
    expect(row.completed_on).toEqual(new Date(`${PAST_DAY}T00:00:00`));
  });

  it("does not count a duplicate as owning the card", async () => {
    // `NOT is_duplicate` is the ownership marker across this whole schema, and a
    // dupe of card A is not card B. Reading it wrong would hand out a trophy for
    // a set somebody holds two of one card from.
    const a = await addCard("Gary the Grill");
    await addCard("The Gazebo");
    await own(IDS.alice, a);
    await own(IDS.alice, a, { duplicate: true });
    expect(await award(IDS.alice, SET)).toBeNull();
  });

  it("never completes an empty set", async () => {
    // Zero of zero is arithmetically complete, which without the guard hands
    // every person in the league a trophy for a set with nothing in it — on
    // whatever they happen to pull next.
    expect(await award(IDS.alice, SET)).toBeNull();
    expect(await trophies()).toEqual([]);
  });

  it("ignores inactive and artless cards when sizing the set", async () => {
    // Both are cards pull_secret_card would never hand out, so counting them
    // makes a set nobody can finish through the front door.
    const a = await addCard("Gary the Grill");
    await addCard("Retired", { active: false });
    await addCard("No art yet", { artPath: null });
    await own(IDS.alice, a);
    expect(await award(IDS.alice, SET)).toMatchObject({ size: 1 });
  });

  it("still counts a card retired from the daily draw", async () => {
    // weight = 0 removes a card from the pool without retiring it — it is still
    // real, still tradeable, still grantable. Excluding it would mean an admin
    // nudging a weight silently finished somebody's set for them.
    const a = await addCard("Gary the Grill");
    const retired = await addCard("Pulled from the pool", { weight: 0 });
    await own(IDS.alice, a);
    expect(await award(IDS.alice, SET)).toBeNull();

    await own(IDS.alice, retired);
    expect(await award(IDS.alice, SET)).toMatchObject({ size: 2 });
  });

  it("refuses unsorted, in both spellings the column allows", async () => {
    // The column is unconstrained text and holds "" as well as NULL —
    // groupBySecretCollection uses `||` rather than `??` for exactly this. A
    // trophy for "" is a trophy for a shelf with no name.
    await own(IDS.alice, await addCard("Loose card", { collection: null }));
    expect(await award(IDS.alice, null)).toBeNull();
    expect(await award(IDS.alice, "")).toBeNull();
    expect(await trophies()).toEqual([]);
  });

  it("refuses a set id nobody authored, rather than aborting the caller", async () => {
    // secret_cards.collection has no foreign key, so a typo'd id genuinely
    // reaches here. collection_trophies DOES have one — an unchecked insert would
    // raise, and the raise would roll back the PULL that called this. Somebody
    // loses their card because an admin misspelled a set name.
    await own(IDS.alice, await addCard("Filed wrong", { collection: "nosuchset" }));
    expect(await award(IDS.alice, "nosuchset")).toBeNull();
    expect(await trophies()).toEqual([]);
  });

  it("refuses a hidden set", async () => {
    // getSecretCollections filters on `active`, so a hidden set has no name on
    // any member surface. A public trophy pointing at one would be a row nothing
    // can render.
    await sql("UPDATE public.secret_collections SET active = false WHERE id = $1", [SET]);
    await own(IDS.alice, await addCard("Gary the Grill"));
    expect(await award(IDS.alice, SET)).toBeNull();
    await sql("UPDATE public.secret_collections SET active = true WHERE id = $1", [SET]);
  });

  it("keeps a trophy when the set grows afterwards", async () => {
    // size_at_completion is why this column exists: a fourteenth card added to a
    // set somebody finished at thirteen does not un-finish it, and the shelf can
    // still say what they actually did.
    await own(IDS.alice, await addCard("Gary the Grill"));
    expect(await award(IDS.alice, SET)).toMatchObject({ size: 1 });

    await addCard("The Gazebo");
    expect(await trophies()).toMatchObject([{ size_at_completion: 1 }]);
  });

  it("keeps one person's sets apart from another's", async () => {
    const a = await addCard("Gary the Grill");
    const b = await addCard("WAG one", { collection: OTHER_SET });
    await own(IDS.alice, a);
    await own(IDS.bob, b);

    expect(await award(IDS.alice, SET)).toMatchObject({ collection: SET });
    expect(await award(IDS.alice, OTHER_SET)).toBeNull();
    expect(await award(IDS.bob, OTHER_SET)).toMatchObject({ collection: OTHER_SET });
  });
});

describe("pull_secret_card", () => {
  it("hands the size back on the pull that finishes the set", async () => {
    // The designed exception to the silence rule, and the only place in the app
    // a total is allowed out. It rides the pull response so the ceremony has it
    // without a second round trip.
    const a = await addCard("Gary the Grill");
    await addCard("The Gazebo");
    await own(IDS.alice, a);

    const res = await pull(IDS.alice);
    expect(res.completedCollection).toMatchObject({ collection: SET, label: "Pets", size: 2 });
    expect(await trophies()).toMatchObject([{ via: "pull", size_at_completion: 2 }]);
  });

  it("says nothing on a pull that leaves cards outstanding", async () => {
    await addCard("Gary the Grill");
    await addCard("The Gazebo");
    expect((await pull(IDS.alice)).completedCollection).toBeNull();
    expect(await trophies()).toEqual([]);
  });

  it("says nothing on the second pull of the day", async () => {
    // The already-pulled short circuit re-reads today's row and returns early.
    // It carries the key so the client type is one shape, but it cannot have
    // completed anything — it acquired nothing.
    const a = await addCard("Gary the Grill");
    await addCard("The Gazebo");
    await own(IDS.alice, a);

    const first = await pull(IDS.alice);
    expect(first.completedCollection).not.toBeNull();
    const second = await pull(IDS.alice);
    expect(second.fresh).toBe(false);
    expect(second.completedCollection).toBeNull();
    expect(await trophies()).toHaveLength(1);
  });

  it("awards nothing to a guest", async () => {
    // A guest CAN finish a set — this is a real pull off a real ledger row — but
    // collection_trophies is public and a nameless row is not a trophy anybody
    // can render. claim_guest_secrets banks it below.
    await addCard("Gary the Grill");
    const res = await pull(null, GUEST);
    expect(res.completedCollection).toBeNull();
    expect(await trophies()).toEqual([]);
  });
});

describe("grant_secret_card", () => {
  it("finishes a set from the commissioner's phone", async () => {
    const a = await addCard("Gary the Grill");
    const b = await addCard("The Gazebo");
    await own(IDS.alice, a);

    const res = await grant(IDS.alice, b);
    expect(res.duplicate).toBe(false);
    expect(res.completedCollection).toMatchObject({ collection: SET, label: "Pets", size: 2 });
    expect(await trophies()).toMatchObject([{ via: "grant" }]);
  });

  it("says nothing when the grant is a card they already hold", async () => {
    const a = await addCard("Gary the Grill");
    await addCard("The Gazebo");
    await own(IDS.alice, a);

    const res = await grant(IDS.alice, a);
    expect(res.duplicate).toBe(true);
    expect(res.completedCollection).toBeNull();
  });
});

describe("accept_trade_offer", () => {
  async function claim(participantId: string) {
    await sql(
      `INSERT INTO public.member_codes (participant_id, code_salt, code_hash, claimed_at)
       VALUES ($1, 'salt', 'hash', now())
       ON CONFLICT (participant_id) DO UPDATE SET claimed_at = now()`,
      [participantId],
    );
  }

  async function offer(give: string[], want: string[]) {
    const [row] = await sql<{ create_trade_offer: { ok: boolean; offerId: string } }>(
      "SELECT public.create_trade_offer($1, $2, $3, $4::jsonb, $5::jsonb)",
      [
        IDS.alice,
        IDS.bob,
        IDS.event,
        JSON.stringify(give.map((id) => ({ kind: "secret", secretPullId: id }))),
        JSON.stringify(want.map((id) => ({ kind: "secret", secretPullId: id }))),
      ],
    );
    return row.create_trade_offer.offerId;
  }

  async function accept(offerId: string): Promise<Accept> {
    const [row] = await sql<{ accept_trade_offer: Accept }>(
      "SELECT public.accept_trade_offer($1, $2)",
      [offerId, IDS.bob],
    );
    return row.accept_trade_offer;
  }

  beforeEach(async () => {
    await claim(IDS.alice);
    await claim(IDS.bob);
  });

  it("finishes the receiver's set and names them in the result", async () => {
    const a = await addCard("Gary the Grill");
    const b = await addCard("The Gazebo");
    const wag = await addCard("WAG one", { collection: OTHER_SET });
    // A second WAG nobody holds, so what Alice receives cannot finish anything —
    // this test is about ONE side completing.
    await addCard("WAG two", { collection: OTHER_SET });

    // Alice holds a spare of B and is missing A, so pets stays 1 of 2 for her.
    await own(IDS.alice, b);
    const spare = await own(IDS.alice, b, { duplicate: true });
    // Bob holds A and is one card off; he pays with a spare WAG.
    await own(IDS.bob, a);
    await own(IDS.bob, wag);
    const bobSpare = await own(IDS.bob, wag, { duplicate: true });

    const res = await accept(await offer([spare], [bobSpare]));
    expect(res.ok).toBe(true);
    expect(res.completedCollections).toMatchObject([
      { collection: SET, label: "Pets", size: 2, participantId: IDS.bob },
    ]);
    expect(await trophies()).toMatchObject([{ participant_id: IDS.bob, via: "trade" }]);
  });

  it("finishes both sides of a two-way trade", async () => {
    // PLURAL is not decoration. Collapsing this to one silently drops somebody's
    // ceremony on the one trade in the season that earned two.
    const a = await addCard("Gary the Grill");
    const b = await addCard("The Gazebo");
    await own(IDS.alice, a);
    const aliceSpare = await own(IDS.alice, a, { duplicate: true });
    await own(IDS.bob, b);
    const bobSpare = await own(IDS.bob, b, { duplicate: true });

    const res = await accept(await offer([aliceSpare], [bobSpare]));
    expect(res.ok).toBe(true);
    // Both people finished `pets` on the same accept, in the same transaction.
    expect(res.completedCollections).toHaveLength(2);
    expect(res.completedCollections!.map((t) => t.participantId).sort()).toEqual(
      [IDS.alice, IDS.bob].sort(),
    );
    expect(await trophies()).toHaveLength(2);
  });

  it("returns an empty list when the trade finished nothing", async () => {
    const a = await addCard("Gary the Grill");
    await addCard("The Gazebo");
    await own(IDS.alice, a);
    const spare = await own(IDS.alice, a, { duplicate: true });
    await own(IDS.bob, a);
    const bobSpare = await own(IDS.bob, a, { duplicate: true });

    const res = await accept(await offer([spare], [bobSpare]));
    expect(res.ok).toBe(true);
    expect(res.completedCollections).toEqual([]);
  });
});

describe("backfill_collection_trophies", () => {
  async function backfill(): Promise<number> {
    const [row] = await sql<{ backfill_collection_trophies: number }>(
      "SELECT public.backfill_collection_trophies()",
    );
    return row.backfill_collection_trophies;
  }

  it("catches a set somebody finished before this table existed", async () => {
    // The reason this function has to exist. Every call site above only looks at
    // the set a card just ARRIVED in, so a league that was already collecting has
    // members who own a whole set and can never trigger a check on it: every
    // remaining pull from it is a duplicate, and so is every grant and every
    // traded copy.
    const a = await addCard("Gary the Grill");
    const b = await addCard("The Gazebo");
    await own(IDS.alice, a);
    await own(IDS.alice, b);
    expect(await trophies()).toEqual([]);

    expect(await backfill()).toBe(1);
    expect(await trophies()).toMatchObject([
      { participant_id: IDS.alice, collection_id: SET, size_at_completion: 2, via: "backfill" },
    ]);
  });

  it("does nothing the second time", async () => {
    await own(IDS.alice, await addCard("Gary the Grill"));
    expect(await backfill()).toBe(1);
    expect(await backfill()).toBe(0);
    expect(await trophies()).toHaveLength(1);
  });

  it("leaves a set somebody is still collecting alone", async () => {
    const a = await addCard("Gary the Grill");
    await addCard("The Gazebo");
    await own(IDS.alice, a);
    expect(await backfill()).toBe(0);
    expect(await trophies()).toEqual([]);
  });

  it("does the whole league in one pass, set by set", async () => {
    const a = await addCard("Gary the Grill");
    const wag = await addCard("WAG one", { collection: OTHER_SET });
    await own(IDS.alice, a);
    await own(IDS.alice, wag);
    await own(IDS.bob, a);

    expect(await backfill()).toBe(3);
    expect((await trophies()).map((t) => [t.participant_id, t.collection_id]).sort()).toEqual(
      [
        [IDS.alice, SET],
        [IDS.alice, OTHER_SET],
        [IDS.bob, SET],
      ].sort(),
    );
  });

  it("respects every guard the live paths respect", async () => {
    // It goes through award_collection_trophy rather than reimplementing the
    // completeness test, which is what keeps these from needing to be re-argued:
    // unsorted is not a set, a hidden set mints nothing, and a duplicate is not
    // ownership.
    await own(IDS.alice, await addCard("Loose card", { collection: null }));
    const hidden = await addCard("Hidden set card", { collection: OTHER_SET });
    await own(IDS.alice, hidden);
    await sql("UPDATE public.secret_collections SET active = false WHERE id = $1", [OTHER_SET]);

    const c = await addCard("Gary the Grill");
    await addCard("The Gazebo");
    await own(IDS.bob, c);
    await own(IDS.bob, c, { duplicate: true });

    expect(await backfill()).toBe(0);
    expect(await trophies()).toEqual([]);
    await sql("UPDATE public.secret_collections SET active = true WHERE id = $1", [OTHER_SET]);
  });

  it("repairs a set that grew back under its owner", async () => {
    // The lockout nobody would think to look for. award_collection_trophy sizes
    // the set on `active AND art_path IS NOT NULL` but checks ownership without
    // either, so re-activating a card the holder already has a row for grows the
    // size and their share of it together — they stay complete, and no acquiring
    // path ever fires again. Being re-runnable is what makes this the answer.
    const a = await addCard("Gary the Grill");
    const retired = await addCard("Was retired", { active: false });
    await own(IDS.alice, a);
    await own(IDS.alice, retired);

    expect(await backfill()).toBe(1);
    expect(await trophies()).toMatchObject([{ size_at_completion: 1 }]);

    await sql("UPDATE public.secret_cards SET active = true WHERE id = $1", [retired]);
    // Still complete, and still theirs — but the trophy is stale, and the primary
    // key means a re-run cannot restate it.
    expect(await backfill()).toBe(0);
    expect(await trophies()).toMatchObject([{ size_at_completion: 1 }]);
  });

  it("is unreachable by anon and authenticated", async () => {
    // Blanket-tested in secret-cards.test.ts, said out loud here because this one
    // writes public rows about other people from nothing but a table scan.
    expect(await isDenied("anon", "SELECT public.backfill_collection_trophies()")).toBe(true);
    expect(await isDenied("authenticated", "SELECT public.backfill_collection_trophies()")).toBe(
      true,
    );
  });
});

describe("claim_guest_secrets", () => {
  it("banks a set the guest finished before they had a name", async () => {
    // The whole reason collection_trophies has no guest half. A guest builds a
    // real collection on a server-minted token; this is the moment it becomes
    // somebody's, and the trophy with it.
    const a = await addCard("Gary the Grill");
    const b = await addCard("The Gazebo");
    for (const card of [a, b]) {
      await sql(
        `INSERT INTO public.secret_card_pulls
           (guest_id, secret_card_id, pulled_on, event_id, is_duplicate, granted, tier)
         VALUES ($1, $2, $3::date, $4, false, true, 'common')`,
        [GUEST, card, PAST_DAY, IDS.event],
      );
    }
    expect(await trophies()).toEqual([]);

    await sql("SELECT public.claim_guest_secrets($1, $2)", [IDS.alice, GUEST]);
    expect(await trophies()).toMatchObject([
      { participant_id: IDS.alice, collection_id: SET, size_at_completion: 2, via: "claim" },
    ]);
  });

  it("banks nothing for a guest who was still collecting", async () => {
    await addCard("Gary the Grill");
    await addCard("The Gazebo");
    await sql(
      `INSERT INTO public.secret_card_pulls
         (guest_id, secret_card_id, pulled_on, event_id, is_duplicate, granted, tier)
       SELECT $1, id, $2::date, $3, false, true, 'common'
         FROM public.secret_cards ORDER BY name LIMIT 1`,
      [GUEST, PAST_DAY, IDS.event],
    );
    await sql("SELECT public.claim_guest_secrets($1, $2)", [IDS.alice, GUEST]);
    expect(await trophies()).toEqual([]);
  });

  it("finishes a set the guest and the member each had half of", async () => {
    // The case a sweep catches and a per-row check would not: neither identity
    // held the whole set, and no acquisition happens here at all — the merge
    // itself is what completes it.
    const a = await addCard("Gary the Grill");
    const b = await addCard("The Gazebo");
    await own(IDS.alice, a);
    await sql(
      `INSERT INTO public.secret_card_pulls
         (guest_id, secret_card_id, pulled_on, event_id, is_duplicate, granted, tier)
       VALUES ($1, $2, $3::date, $4, false, true, 'common')`,
      [GUEST, b, PAST_DAY, IDS.event],
    );

    await sql("SELECT public.claim_guest_secrets($1, $2)", [IDS.alice, GUEST]);
    expect(await trophies()).toMatchObject([{ participant_id: IDS.alice, via: "claim" }]);
  });
});
