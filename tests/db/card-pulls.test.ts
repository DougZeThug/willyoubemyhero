// The player-card pull ledger, against real Postgres.
//
// One property lives here and nowhere else: a row count per card IS the number of
// distinct people who have packed it. That only holds because the composite
// primary key makes a second row for the same (person, card) impossible — so the
// tests that matter most are the ones that hammer the same pair and prove the
// count does not move.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, isDenied, IDS, newClient, seedEvent, sql } from "./helpers";

afterAll(closeDb);
beforeEach(seedEvent);

async function cardIds(): Promise<string[]> {
  const rows = await sql<{ id: string }>(
    "SELECT id FROM public.event_participants ORDER BY running_order",
  );
  return rows.map((r) => r.id);
}

/** What record_card_pulls answers with since editions moved server-side. */
type RecordResult = { recorded: number; editions: Record<string, string> };

async function recordFull(
  participantId: string,
  ids: string[],
  editions: (string | null)[] | null = null,
): Promise<RecordResult> {
  const [row] = await sql<{ record_card_pulls: RecordResult }>(
    "SELECT public.record_card_pulls($1, $2, $3)",
    [participantId, ids, editions],
  );
  return row.record_card_pulls;
}

/** The card count, for the tests that only care how many landed. */
async function record(
  participantId: string,
  ids: string[],
  editions: (string | null)[] | null = null,
): Promise<number> {
  return (await recordFull(participantId, ids, editions)).recorded;
}

/**
 * The two-argument call, which the DEFAULT NULL on `_editions` is there to keep
 * resolving. A phone holding a cached bundle from before editions still posts
 * this shape mid-rollout.
 */
async function recordLegacy(participantId: string, ids: string[]): Promise<number> {
  const [row] = await sql<{ record_card_pulls: RecordResult }>(
    "SELECT public.record_card_pulls($1, $2)",
    [participantId, ids],
  );
  return row.record_card_pulls.recorded;
}

/**
 * Pretend the last pack was `days` ago.
 *
 * TWO columns, because the once-a-day rule moved. `card_pulls.last_pulled_at` is
 * the "when did we last hear about this" stamp and nothing more; the rule itself
 * is now the partial unique index on `card_copies.acquired_on`
 * (20260817115000_card_copies.sql), the same shape secret_card_pulls has always
 * used. Rewinding only the stamp — which is all this needed before copies
 * existed — leaves the copy dated today and mints nothing.
 */
async function rewindDay(days = 1) {
  await sql("UPDATE public.card_pulls SET last_pulled_at = last_pulled_at - make_interval(days => $1)", [days]); // prettier-ignore
  await sql(
    "UPDATE public.card_copies SET acquired_on = acquired_on - $1::int WHERE source = 'pull'",
    [days],
  ); // prettier-ignore  // card_mints as well, or "a later day" never arrives: record_card_pulls asks
  // that table whether this card was already minted today, so a rewind that left
  // it alone would report every seeded copy as still being today's.
  await sql("UPDATE public.card_mints SET minted_on = minted_on - $1::int", [days]);
}

async function editionOf(eventParticipantId: string): Promise<string> {
  const [row] = await sql<{ edition: string }>(
    "SELECT edition FROM public.card_pulls WHERE event_participant_id = $1",
    [eventParticipantId],
  );
  return row.edition;
}

/** How many distinct people have packed each card — a plain row count, by design. */
async function counts(): Promise<Record<string, number>> {
  const rows = await sql<{ event_participant_id: string; n: number }>(
    `SELECT event_participant_id, count(*)::int AS n
       FROM public.card_pulls GROUP BY event_participant_id`,
  );
  return Object.fromEntries(rows.map((r) => [r.event_participant_id, r.n]));
}

const rowCount = async () =>
  (await sql<{ n: number }>("SELECT count(*)::int AS n FROM public.card_pulls"))[0].n;

describe("record_card_pulls", () => {
  it("is unreachable with the publishable key", async () => {
    // Without the REVOKE, anyone holding the key that ships to every browser can
    // credit themselves the whole roster, now in any finish they like.
    //
    // The three-arg signature, deliberately. isDenied swallows every error alike,
    // so pointing this at a signature that no longer exists would keep passing
    // while guarding nothing — which is exactly what happened to the two-arg call
    // when 20260813120000 dropped it. The positive control below is the other
    // half: it separates "denied because revoked" from "denied because gone".
    for (const role of ["anon", "authenticated"] as const) {
      expect(
        await isDenied(role, "SELECT public.record_card_pulls($1, $2, $3)", [IDS.alice, [], null]),
      ).toBe(true);
    }
  });

  it("is reachable by service_role, which is what makes the revoke meaningful", async () => {
    // The positive control. `record` runs as the owning superuser, so a signature
    // that vanished would surface here as a thrown error rather than as a test
    // that quietly stopped testing anything.
    expect(await recordFull(IDS.alice, [])).toEqual({ recorded: 0, editions: {} });
  });

  it("still resolves the two-argument call, for a client that predates editions", async () => {
    const ids = await cardIds();
    expect(await recordLegacy(IDS.alice, [ids[0]])).toBe(1);
    // And it still gets a real finish: the two-arg call omits the editions
    // parameter, which the RPC ignores anyway now that it derives its own.
    expect(await editionOf(ids[0])).toBe(await derive(IDS.alice, ids[0]));
  });

  it("records one row per card in the pack", async () => {
    const ids = await cardIds();
    expect(await record(IDS.alice, ids)).toBe(3);
    expect(await counts()).toEqual({ [ids[0]]: 1, [ids[1]]: 1, [ids[2]]: 1 });
  });

  it("counts a person once per card no matter how many times they call", async () => {
    // The property the entire UI rests on. Fifty calls, one row.
    const ids = await cardIds();
    for (let i = 0; i < 50; i++) await record(IDS.alice, [ids[0]]);
    expect(await rowCount()).toBe(1);
    expect((await counts())[ids[0]]).toBe(1);
  });

  it("bumps the invisible pull_count on a later day, leaving the visible number alone", async () => {
    const ids = await cardIds();
    await record(IDS.alice, [ids[0]]);
    await rewindDay(1);
    await record(IDS.alice, [ids[0]]);
    const [row] = await sql<{ pull_count: number }>(
      "SELECT pull_count FROM public.card_pulls WHERE event_participant_id = $1",
      [ids[0]],
    );
    expect(row.pull_count).toBe(2);
    expect((await counts())[ids[0]]).toBe(1);
  });

  it("does not count the same card twice in one league day", async () => {
    // A pack is once a day, so a second call today is a replay — the pack screen
    // fires this once per mount for whatever pack is stored, so reopening an
    // already-torn pack used to add a duplicate to the stats every time.
    const ids = await cardIds();
    for (let i = 0; i < 5; i++) await record(IDS.alice, [ids[0]]);
    const [row] = await sql<{ pull_count: number }>(
      "SELECT pull_count FROM public.card_pulls WHERE event_participant_id = $1",
      [ids[0]],
    );
    expect(row.pull_count).toBe(1);
  });

  it("still moves last_pulled_at on a replay, which is what makes the day check work", async () => {
    const ids = await cardIds();
    await record(IDS.alice, [ids[0]]);
    await rewindDay(2);
    await record(IDS.alice, [ids[0]]);
    // Both sides of the comparison in the league's timezone. The RPCs run with
    // SET timezone = 'America/New_York', so *their* current_date is the league
    // day — but this session is on the cluster default (UTC in CI), where a
    // bare current_date is tomorrow's date every night between midnight UTC
    // and midnight New York. That mismatch failed this test nightly in that
    // window, invisibly for as long as the db job was advisory.
    const [row] = await sql<{ today: boolean }>(
      `SELECT (last_pulled_at AT TIME ZONE 'America/New_York')::date
            = (now() AT TIME ZONE 'America/New_York')::date AS today
         FROM public.card_pulls WHERE event_participant_id = $1`,
      [ids[0]],
    );
    expect(row.today).toBe(true);
  });

  it("counts two people on the same card as two", async () => {
    const ids = await cardIds();
    await record(IDS.alice, [ids[0]]);
    await record(IDS.bob, [ids[0]]);
    expect((await counts())[ids[0]]).toBe(2);
  });

  it("drops an unknown card rather than failing the whole pack", async () => {
    // A pack dealt from a bundle that has since changed must still record the
    // cards that are still real.
    const ids = await cardIds();
    const bogus = "00000000-0000-4000-8000-0000000000ee";
    expect(await record(IDS.alice, [ids[0], bogus, ids[1]])).toBe(2);
    expect(await rowCount()).toBe(2);
  });

  it("survives a duplicated id inside one call", async () => {
    // ON CONFLICT cannot affect the same row twice in one INSERT — the DISTINCT
    // in the RPC is what stops that raising.
    const ids = await cardIds();
    expect(await record(IDS.alice, [ids[0], ids[0], ids[0]])).toBe(1);
    expect(await rowCount()).toBe(1);
  });

  it("records nothing, and does not raise, for a participant who no longer exists", async () => {
    // A member token stays valid for 90 days; the participant behind it might not.
    const ids = await cardIds();
    expect(await record("00000000-0000-4000-8000-0000000000ee", ids)).toBe(0);
    expect(await rowCount()).toBe(0);
  });

  it("records nothing for an empty pack", async () => {
    expect(await recordFull(IDS.alice, [])).toEqual({ recorded: 0, editions: {} });
    expect(await rowCount()).toBe(0);
  });

  it("lets a card be deleted, and takes its pull rows with it", async () => {
    // Unlike the secret ledger, there is nothing to preserve here — this is a
    // decorative count, not a record of what somebody found.
    const ids = await cardIds();
    await record(IDS.alice, ids);
    await sql("DELETE FROM public.event_participants WHERE id = $1", [ids[0]]);
    expect(await rowCount()).toBe(2);
  });

  it("takes a person's pulls with them when they leave the league", async () => {
    const ids = await cardIds();
    await record(IDS.bob, ids);
    await sql("DELETE FROM public.participants WHERE id = $1", [IDS.bob]);
    expect(await rowCount()).toBe(0);
  });

  it("refuses a second row for the same person and card, inserted directly", async () => {
    // The rule is the schema's, not the RPC's.
    const ids = await cardIds();
    await record(IDS.alice, [ids[0]]);
    await expect(
      sql("INSERT INTO public.card_pulls (participant_id, event_participant_id) VALUES ($1, $2)", [
        IDS.alice,
        ids[0],
      ]),
    ).rejects.toThrow();
  });
});

describe("card_edition_rank", () => {
  it("orders the ladder rarest first", async () => {
    const [row] = await sql<Record<string, number>>(
      `SELECT public.card_edition_rank('platinum') AS platinum,
              public.card_edition_rank('gold')     AS gold,
              public.card_edition_rank('silver')   AS silver,
              public.card_edition_rank('bronze')   AS bronze,
              public.card_edition_rank('standard') AS standard,
              public.card_edition_rank('legendary') AS unknown,
              public.card_edition_rank(NULL)        AS missing`,
    );
    expect(row.platinum).toBeLessThan(row.gold);
    expect(row.gold).toBeLessThan(row.silver);
    expect(row.silver).toBeLessThan(row.bronze);
    expect(row.bronze).toBeLessThan(row.standard);
    // Last, so a real finish can still displace a corrupt stored value.
    expect(row.unknown).toBeGreaterThan(row.standard);
    expect(row.missing).toBeGreaterThan(row.standard);
  });
});

/**
 * The league day, as the RPC sees it.
 *
 * record_card_pulls runs under SET timezone = 'America/New_York' while this
 * session is UTC, so anything that re-derives a finish has to ask for the same
 * day the function used or it will disagree for the five hours either side of
 * midnight — the window that used to fail card-pulls nightly and invisibly.
 */
async function leagueDay(): Promise<string> {
  const [row] = await sql<{ d: string }>(
    "SELECT (now() AT TIME ZONE 'America/New_York')::date::text AS d",
  );
  return row.d;
}

const derive = async (participantId: string, eventParticipantId: string) =>
  (
    await sql<{ e: string }>("SELECT public.roll_card_edition($1, $2, $3::date) AS e", [
      participantId,
      eventParticipantId,
      await leagueDay(),
    ])
  )[0].e;

describe("roll_card_edition", () => {
  it("gives the same triple the same finish every time", async () => {
    const ids = await cardIds();
    const day = await leagueDay();
    const once = await sql<{ e: string }>(
      "SELECT public.roll_card_edition($1, $2, $3::date) AS e",
      [IDS.alice, ids[0], day],
    );
    const again = await sql<{ e: string }>(
      "SELECT public.roll_card_edition($1, $2, $3::date) AS e",
      [IDS.alice, ids[0], day],
    );
    expect(again[0].e).toBe(once[0].e);
  });

  it("walks the same ladder card-edition.ts does", async () => {
    // The TS side of the mirror. WEIGHT_BP is the source of the rung widths and
    // this asserts Postgres lands on them, so the two cannot drift apart without
    // one of these numbers moving.
    const rows = await sql<{ edition: string; n: number }>(`
      SELECT public.roll_card_edition(gen_random_uuid(), gen_random_uuid(), current_date) AS edition,
             count(*)::int AS n
        FROM generate_series(1, 40000)
       GROUP BY 1
    `);
    const share = Object.fromEntries(rows.map((r) => [r.edition, r.n / 40000])) as Record<
      string,
      number
    >;

    // Generous bands: this is a distribution test on 40k draws, and a tight one
    // would flake nightly for no signal. It still fails loudly if a rung moves.
    expect(share.standard).toBeGreaterThan(0.66);
    expect(share.standard).toBeLessThan(0.74);
    expect(share.bronze).toBeGreaterThan(0.15);
    expect(share.bronze).toBeLessThan(0.21);
    expect(share.silver).toBeGreaterThan(0.06);
    expect(share.silver).toBeLessThan(0.1);
    expect(share.gold ?? 0).toBeLessThan(0.05);
    expect(share.platinum ?? 0).toBeLessThan(0.015);
  });

  it("is unreachable with the publishable key", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      expect(
        await isDenied(role, "SELECT public.roll_card_edition($1, $2, current_date)", [
          IDS.alice,
          IDS.bob,
        ]),
      ).toBe(true);
    }
  });
});

describe("record_card_pulls editions", () => {
  it("derives the finish rather than storing what it was handed", async () => {
    // The premise of the whole migration: a phone can claim what it likes and the
    // stored finish is still the one Postgres derived.
    const ids = await cardIds();
    const res = await recordFull(IDS.alice, [ids[0]], ["platinum"]);
    const derived = await derive(IDS.alice, ids[0]);
    expect(res.editions[ids[0]]).toBe(derived);
    expect(await editionOf(ids[0])).toBe(derived);
  });

  it("answers with a map keyed by card, not a positional list", async () => {
    const ids = await cardIds();
    const res = await recordFull(IDS.alice, ids);
    expect(Object.keys(res.editions).sort()).toEqual([...ids].sort());
    expect(res.recorded).toBe(3);
  });

  it("hands a retry back the finish it already stored", async () => {
    // THE ANTI-RATCHET TEST. The client records a pack up to three times per
    // cycle and re-arms on 'online' and 'visibilitychange', so a replay is normal
    // traffic. If a replay could re-draw and keep the better result, a member in
    // a dead spot would ratchet themselves to platinum for free.
    const ids = await cardIds();
    const first = await recordFull(IDS.alice, ids);
    for (let i = 0; i < 5; i++) {
      expect((await recordFull(IDS.alice, ids)).editions).toEqual(first.editions);
    }
    expect(await rowCount()).toBe(3);
  });

  it("mints nothing more once the day's mint is on file, even if the copy goes", async () => {
    // This used to assert the opposite — that deleting the copy and recording
    // again re-minted the SAME finish, which the derivation guaranteed. Deriving
    // rather than rolling is still what makes the finish stable (pinned in the
    // roll_card_edition describe above), but 20260827120000 stopped the re-mint
    // happening at all: the mint is recorded in card_mints, which nothing that
    // moves or destroys a copy can edit. That is what closes the trade-and-remint
    // loop; tests/db/dust.test.ts drives it end to end.
    const ids = await cardIds();
    await recordFull(IDS.alice, [ids[0]]);
    await sql("DELETE FROM public.card_copies WHERE participant_id = $1", [IDS.alice]);

    const after = await recordFull(IDS.alice, [ids[0]]);
    expect(after.recorded).toBe(0);
    expect(after.editions[ids[0]]).toBeUndefined();
    const [mints] = await sql<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.card_mints WHERE participant_id = $1",
      [IDS.alice],
    );
    expect(mints.n).toBe(1);
  });

  it("marks what it derived as server-asserted", async () => {
    const ids = await cardIds();
    await recordFull(IDS.alice, ids);
    const rows = await sql<{ edition_asserted_by: string }>(
      "SELECT edition_asserted_by FROM public.card_copies WHERE participant_id = $1",
      [IDS.alice],
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.edition_asserted_by === "server")).toBe(true);
  });

  it("leaves a hand-filed copy labelled client", async () => {
    // The default is what keeps history honest: those editions did come off a
    // phone, and mill_card_copy pays the flat floor for exactly this reason.
    const ids = await cardIds();
    await sql(
      `INSERT INTO public.card_copies (participant_id, event_participant_id, edition, source)
       VALUES ($1, $2, 'platinum', 'grant')`,
      [IDS.alice, ids[0]],
    );
    const [row] = await sql<{ edition_asserted_by: string }>(
      "SELECT edition_asserted_by FROM public.card_copies WHERE participant_id = $1",
      [IDS.alice],
    );
    expect(row.edition_asserted_by).toBe("client");
  });

  it("refuses a provenance the payout rules do not know", async () => {
    // Unlike `edition`, this column IS money, so an unrecognised value has to be
    // a write that fails rather than a payout that guesses.
    const ids = await cardIds();
    await expect(
      sql(
        `INSERT INTO public.card_copies (participant_id, event_participant_id, edition_asserted_by)
         VALUES ($1, $2, 'trustme')`,
        [IDS.alice, ids[0]],
      ),
    ).rejects.toThrow();
  });

  it("survives a duplicated id inside one call", async () => {
    const ids = await cardIds();
    const res = await recordFull(IDS.alice, [ids[0], ids[0]]);
    expect(res.recorded).toBe(1);
    expect(await rowCount()).toBe(1);
  });

  it("rations the day's minting rather than trusting the payload", async () => {
    // The endpoint has always tolerated hand-posted roster ids on the argument
    // that the worst anyone could manufacture was a phantom pack on a private
    // stat. card_copies made that false — the once-a-day index is per CARD — and
    // the dust migration turns every extra copy into currency.
    await sql(
      `INSERT INTO public.participants (id, name, active)
       SELECT gen_random_uuid(), 'Extra ' || g, true FROM generate_series(1, 8) g`,
    );
    await sql(
      `INSERT INTO public.event_participants (event_id, participant_id, running_order)
       SELECT $1, p.id, 10 + row_number() OVER (ORDER BY p.id)
         FROM public.participants p WHERE p.name LIKE 'Extra %'`,
      [IDS.event],
    );
    const ids = await cardIds();
    expect(ids.length).toBeGreaterThan(6);

    const res = await recordFull(IDS.alice, ids);
    expect(res.recorded).toBe(6);
    expect(Object.keys(res.editions)).toHaveLength(6);
  });

  it("still lets a card already filed today through the cap", async () => {
    // Otherwise a retry past the cap would answer with no finish for a card the
    // member is looking at, and the reveal would fall back to standard forever.
    const ids = await cardIds();
    const first = await recordFull(IDS.alice, ids);
    const again = await recordFull(IDS.alice, ids);
    expect(again.editions).toEqual(first.editions);
  });

  it("keeps two people's finishes of one card apart", async () => {
    const ids = await cardIds();
    await record(IDS.alice, [ids[0]]);
    await record(IDS.bob, [ids[0]]);
    const rows = await sql<{ participant_id: string; edition: string }>(
      "SELECT participant_id, edition FROM public.card_pulls WHERE event_participant_id = $1",
      [ids[0]],
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.participant_id === IDS.alice)?.edition).toBe(
      await derive(IDS.alice, ids[0]),
    );
    expect(rows.find((r) => r.participant_id === IDS.bob)?.edition).toBe(
      await derive(IDS.bob, ids[0]),
    );
    // Two owners, and the public count still says two.
    expect((await counts())[ids[0]]).toBe(2);
  });

  it("keeps card_pulls.edition the best across the copies", async () => {
    // resync_card_pull still owns that column, and a second day's copy of the
    // same card is where a better finish can arrive.
    const ids = await cardIds();
    await record(IDS.alice, [ids[0]]);
    await rewindDay(1);
    await record(IDS.alice, [ids[0]]);
    const [row] = await sql<{ pull_count: number; edition: string }>(
      "SELECT pull_count, edition FROM public.card_pulls WHERE event_participant_id = $1",
      [ids[0]],
    );
    expect(row.pull_count).toBe(2);
    const held = await sql<{ edition: string }>(
      `SELECT edition FROM public.card_copies
        WHERE participant_id = $1 AND event_participant_id = $2
        ORDER BY public.card_edition_rank(edition) ASC LIMIT 1`,
      [IDS.alice, ids[0]],
    );
    expect(row.edition).toBe(held[0].edition);
  });
});

describe("adopt_card_copies", () => {
  // The guest-to-member handover. It was the one unrationed mint left once
  // copies became currency: it took the finish from the phone, held no lock, and
  // joined any event's roster. 20260902120000 closed all three.
  async function adopt(
    participantId: string,
    ids: string[],
    editions: string[] | null = null,
  ): Promise<number> {
    const [row] = await sql<{ adopt_card_copies: number }>(
      "SELECT public.adopt_card_copies($1, $2, $3)",
      [participantId, ids, editions],
    );
    return row.adopt_card_copies;
  }

  async function copies(participantId: string) {
    return sql<{
      event_participant_id: string;
      edition: string;
      source: string;
      edition_asserted_by: string;
    }>(
      `SELECT event_participant_id, edition, source, edition_asserted_by
         FROM public.card_copies WHERE participant_id = $1 ORDER BY event_participant_id`,
      [participantId],
    );
  }

  it("files one standard copy of each card not already held", async () => {
    const ids = await cardIds();
    expect(await adopt(IDS.alice, [ids[0], ids[1]])).toBe(2);
    const rows = await copies(IDS.alice);
    expect(rows.map((r) => [r.edition, r.source, r.edition_asserted_by])).toEqual([
      ["standard", "adopt", "client"],
      ["standard", "adopt", "client"],
    ]);
    const pulls = await sql<{ pull_count: number; edition: string }>(
      "SELECT pull_count, edition FROM public.card_pulls WHERE participant_id = $1",
      [IDS.alice],
    );
    expect(pulls).toEqual([
      { pull_count: 1, edition: "standard" },
      { pull_count: 1, edition: "standard" },
    ]);
  });

  it("ignores the finish the phone claims", async () => {
    // The finish on a guest's card is the phone's word alone, and card_pulls
    // derives its edition from the copies — so a trusted 'platinum' here dressed
    // the card as platinum on every screen and priced it that way on the shelf.
    const ids = await cardIds();
    expect(await adopt(IDS.alice, [ids[0], ids[1]], ["platinum", "gold"])).toBe(2);
    expect((await copies(IDS.alice)).map((r) => r.edition)).toEqual(["standard", "standard"]);
    expect(await editionOf(ids[0])).toBe("standard");
  });

  it("skips a card from another event", async () => {
    // A guest's pack is dealt from the live roster and nothing else, so an id
    // from another event is not a card the phone could honestly hold.
    const OLD_EVENT = "00000000-0000-4000-8000-0000000000fd";
    await sql(
      `INSERT INTO public.events (id, name, year, active) VALUES ($1, 'Last year', 2025, false)`,
      [OLD_EVENT],
    );
    const [old] = await sql<{ id: string }>(
      `INSERT INTO public.event_participants (event_id, participant_id, running_order)
       VALUES ($1, $2, 1) RETURNING id`,
      [OLD_EVENT, IDS.bob],
    );
    const ids = await cardIds();
    expect(await adopt(IDS.alice, [old.id, ids[0]])).toBe(1);
    expect((await copies(IDS.alice)).map((r) => r.event_participant_id)).toEqual([ids[0]]);
  });

  it("considers each card once, ever", async () => {
    // The old guard was NOT EXISTS over card_copies, which is true again the
    // moment the copy is milled or traded away — so every sign-in after that
    // filed a fresh one, and the mill paid 5 dust for it each time round.
    const ids = await cardIds();
    expect(await adopt(IDS.alice, [ids[0]])).toBe(1);
    await sql("DELETE FROM public.card_copies WHERE participant_id = $1", [IDS.alice]);
    expect(await adopt(IDS.alice, [ids[0]])).toBe(0);
    expect(await copies(IDS.alice)).toEqual([]);
    expect(
      await sql("SELECT count(*)::int AS n FROM public.card_adoptions WHERE participant_id = $1", [
        IDS.alice,
      ]),
    ).toEqual([{ n: 1 }]);
  });

  it("never files a second copy of a card already pulled, and never will", async () => {
    const ids = await cardIds();
    await record(IDS.alice, [ids[0]]);
    expect(await adopt(IDS.alice, [ids[0]])).toBe(0);
    expect(await copies(IDS.alice)).toHaveLength(1);
    // Noted anyway: the pair has been through adoption, whatever was held.
    await sql("DELETE FROM public.card_copies WHERE participant_id = $1", [IDS.alice]);
    expect(await adopt(IDS.alice, [ids[0]])).toBe(0);
  });

  it("mints a SECOND copy when a pack is recorded after the same cards were adopted", async () => {
    // B-07's load-bearing finding, and the reason the pack screen refuses to
    // re-record a carried pack. The day's ration is card_mints, and an adopted
    // copy writes no mint row — it is not a pull. So a guest's pack that the
    // claim has just adopted, recorded again a moment later under the member,
    // files a whole second copy of every card in it: three become six for one
    // league day, in a game whose economy is scarcity.
    //
    // This is documenting the behaviour rather than asking for it to change. The
    // RPC is right: adoption and pulling are different events and the once-a-day
    // index is deliberately scoped to pulls. The client is what must not ask.
    const ids = await cardIds();
    expect(await adopt(IDS.alice, [ids[0], ids[1]])).toBe(2);
    expect(await copies(IDS.alice)).toHaveLength(2);

    expect(await record(IDS.alice, [ids[0], ids[1]])).toBe(2);
    const after = await copies(IDS.alice);
    expect(after).toHaveLength(4);
    expect(after.filter((c) => c.source === "adopt")).toHaveLength(2);
    expect(after.filter((c) => c.source === "pull")).toHaveLength(2);
  });

  it("re-rolls the finish on the copy that record then mints", async () => {
    // The second half of the same finding, and why the client's skip stays even
    // if the count above ever became one. An adopted copy is standard and
    // client-asserted on purpose; the minted one is server-rolled, and
    // card_pulls.edition is best-of-copies — so recording a carried pack does not
    // merely duplicate it, it re-decides what the card is wearing.
    const ids = await cardIds();
    await adopt(IDS.alice, [ids[0]]);
    expect((await copies(IDS.alice)).map((c) => c.edition_asserted_by)).toEqual(["client"]);
    await record(IDS.alice, [ids[0]]);
    expect((await copies(IDS.alice)).map((c) => c.edition_asserted_by).sort()).toEqual([
      "client",
      "server",
    ]);
  });

  it("adopts nothing after the pack was recorded, which is the safe order", async () => {
    // The mirror image, and the reason the skip belongs on the record rather than
    // on the adoption: adoption already refuses a card the person holds a copy of,
    // so the two calls are only dangerous in one direction.
    const ids = await cardIds();
    expect(await record(IDS.alice, [ids[0], ids[1]])).toBe(2);
    expect(await adopt(IDS.alice, [ids[0], ids[1]])).toBe(0);
    expect(await copies(IDS.alice)).toHaveLength(2);
  });

  it("serialises two adoptions racing on one account", async () => {
    // What this proves is the ledger's primary key: the second insert into
    // card_adoptions waits on the first and lands on ON CONFLICT DO NOTHING, so
    // it files no copies whether or not the row lock is held. The lock is for a
    // different race — record_card_pulls and mill_card_copy hold the same
    // participant row, and adoption's "no copy held yet" read has to queue
    // behind them rather than interleave.
    const ids = await cardIds();
    const one = await newClient();
    const two = await newClient();
    try {
      const results = await Promise.all([
        one.query("SELECT public.adopt_card_copies($1, $2, NULL) AS n", [IDS.alice, ids]),
        two.query("SELECT public.adopt_card_copies($1, $2, NULL) AS n", [IDS.alice, ids]),
      ]);
      const filed = results.map((r) => r.rows[0].n as number);
      expect(filed.reduce((a, b) => a + b, 0)).toBe(ids.length);
      expect(await copies(IDS.alice)).toHaveLength(ids.length);
    } finally {
      await one.end();
      await two.end();
    }
  });

  it("cannot be called by anon", async () => {
    const ids = await cardIds();
    expect(
      await isDenied("anon", "SELECT public.adopt_card_copies($1, $2, NULL)", [IDS.alice, ids]),
    ).toBe(true);
  });
});
