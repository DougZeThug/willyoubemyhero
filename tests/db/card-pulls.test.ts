// The player-card pull ledger, against real Postgres.
//
// One property lives here and nowhere else: a row count per card IS the number of
// distinct people who have packed it. That only holds because the composite
// primary key makes a second row for the same (person, card) impossible — so the
// tests that matter most are the ones that hammer the same pair and prove the
// count does not move.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, isDenied, IDS, seedEvent, sql } from "./helpers";

afterAll(closeDb);
beforeEach(seedEvent);

async function cardIds(): Promise<string[]> {
  const rows = await sql<{ id: string }>(
    "SELECT id FROM public.event_participants ORDER BY running_order",
  );
  return rows.map((r) => r.id);
}

async function record(
  participantId: string,
  ids: string[],
  editions: (string | null)[] | null = null,
): Promise<number> {
  const [row] = await sql<{ record_card_pulls: number }>(
    "SELECT public.record_card_pulls($1, $2, $3)",
    [participantId, ids, editions],
  );
  return row.record_card_pulls;
}

/**
 * The two-argument call, which the DEFAULT NULL on `_editions` is there to keep
 * resolving. A phone holding a cached bundle from before editions still posts
 * this shape mid-rollout.
 */
async function recordLegacy(participantId: string, ids: string[]): Promise<number> {
  const [row] = await sql<{ record_card_pulls: number }>(
    "SELECT public.record_card_pulls($1, $2)",
    [participantId, ids],
  );
  return row.record_card_pulls;
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
    expect(await record(IDS.alice, [])).toBe(0);
  });

  it("still resolves the two-argument call, for a client that predates editions", async () => {
    const ids = await cardIds();
    expect(await recordLegacy(IDS.alice, [ids[0]])).toBe(1);
    expect(await editionOf(ids[0])).toBe("standard");
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
    await sql("UPDATE public.card_pulls SET last_pulled_at = last_pulled_at - interval '1 day'");
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
    await sql("UPDATE public.card_pulls SET last_pulled_at = last_pulled_at - interval '2 days'");
    await record(IDS.alice, [ids[0]]);
    const [row] = await sql<{ today: boolean }>(
      `SELECT (last_pulled_at AT TIME ZONE 'America/New_York')::date = current_date AS today
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
    expect(await record(IDS.alice, [])).toBe(0);
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

describe("record_card_pulls editions", () => {
  it("defaults to standard when no finishes are sent", async () => {
    const ids = await cardIds();
    await record(IDS.alice, [ids[0]]);
    expect(await editionOf(ids[0])).toBe("standard");
  });

  it("stores the finish it was handed, positionally", async () => {
    const ids = await cardIds();
    await record(IDS.alice, ids, ["gold", "standard", "platinum"]);
    expect(await editionOf(ids[0])).toBe("gold");
    expect(await editionOf(ids[1])).toBe("standard");
    expect(await editionOf(ids[2])).toBe("platinum");
  });

  it("upgrades a card you already hold, without adding a row", async () => {
    // The whole point of keeping the primary key: the count a card shows is
    // unmoved by an upgrade, because an upgrade is not a new owner.
    const ids = await cardIds();
    await record(IDS.alice, [ids[0]], ["bronze"]);
    await record(IDS.alice, [ids[0]], ["platinum"]);
    expect(await editionOf(ids[0])).toBe("platinum");
    expect(await rowCount()).toBe(1);
    expect((await counts())[ids[0]]).toBe(1);
  });

  it("does not demote a card you already hold", async () => {
    // A worse finish of a card you own is a duplicate, not a downgrade.
    const ids = await cardIds();
    await record(IDS.alice, [ids[0]], ["platinum"]);
    await record(IDS.alice, [ids[0]], ["standard"]);
    expect(await editionOf(ids[0])).toBe("platinum");
  });

  it("leaves an equal finish alone", async () => {
    const ids = await cardIds();
    await record(IDS.alice, [ids[0]], ["silver"]);
    await record(IDS.alice, [ids[0]], ["silver"]);
    expect(await editionOf(ids[0])).toBe("silver");
    expect(await rowCount()).toBe(1);
  });

  it("does not bump pull_count when an upgrade lands the same day", async () => {
    // An upgrade is still a replay as far as the day rule is concerned.
    const ids = await cardIds();
    await record(IDS.alice, [ids[0]], ["bronze"]);
    await record(IDS.alice, [ids[0]], ["gold"]);
    const [row] = await sql<{ pull_count: number }>(
      "SELECT pull_count FROM public.card_pulls WHERE event_participant_id = $1",
      [ids[0]],
    );
    expect(row.pull_count).toBe(1);
    expect(await editionOf(ids[0])).toBe("gold");
  });

  it("keeps the better finish when one call carries the same card twice", async () => {
    // DISTINCT ON, not DISTINCT: two rows for one card differ now, so the plain
    // DISTINCT this used to carry would no longer collapse them — and ON CONFLICT
    // cannot touch the same row twice in one INSERT, so it would raise.
    const ids = await cardIds();
    expect(await record(IDS.alice, [ids[0], ids[0]], ["bronze", "platinum"])).toBe(1);
    expect(await editionOf(ids[0])).toBe("platinum");
    expect(await rowCount()).toBe(1);
  });

  it("pads a short array with standard rather than dropping the cards", async () => {
    const ids = await cardIds();
    expect(await record(IDS.alice, ids, ["gold"])).toBe(3);
    expect(await editionOf(ids[0])).toBe("gold");
    expect(await editionOf(ids[1])).toBe("standard");
    expect(await editionOf(ids[2])).toBe("standard");
  });

  it("treats a NULL inside the array as standard", async () => {
    const ids = await cardIds();
    await record(IDS.alice, [ids[0], ids[1]], [null, "silver"]);
    expect(await editionOf(ids[0])).toBe("standard");
    expect(await editionOf(ids[1])).toBe("silver");
  });

  it("stores an unrecognised finish without raising, and lets a real one beat it", async () => {
    // No CHECK on the column, so a value the TS vocabulary does not know can land.
    // card-edition.ts renders it as standard, and rank 99 means it never blocks an
    // upgrade.
    const ids = await cardIds();
    await record(IDS.alice, [ids[0]], ["legendary"]);
    expect(await editionOf(ids[0])).toBe("legendary");
    await record(IDS.alice, [ids[0]], ["bronze"]);
    expect(await editionOf(ids[0])).toBe("bronze");
  });

  it("keeps two people's finishes of one card apart", async () => {
    const ids = await cardIds();
    await record(IDS.alice, [ids[0]], ["platinum"]);
    await record(IDS.bob, [ids[0]], ["standard"]);
    const rows = await sql<{ participant_id: string; edition: string }>(
      "SELECT participant_id, edition FROM public.card_pulls WHERE event_participant_id = $1",
      [ids[0]],
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.participant_id === IDS.alice)?.edition).toBe("platinum");
    expect(rows.find((r) => r.participant_id === IDS.bob)?.edition).toBe("standard");
    // Two owners, and the public count still says two.
    expect((await counts())[ids[0]]).toBe(2);
  });
});
