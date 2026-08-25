// The per-copy card ledger, against real Postgres.
//
// `tests/db/card-pulls.test.ts` watches the derived row — the one the vault and
// the public count read. This file watches the thing it is derived FROM, because
// that is where the two properties that make a finish tradeable actually live:
// one copy per person per card per league day, and a `card_pulls` row that always
// says exactly what the copies say.
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

async function record(participantId: string, ids: string[], editions: string[] | null = null) {
  const [row] = await sql<{
    record_card_pulls: { recorded: number; editions: Record<string, string> };
  }>("SELECT public.record_card_pulls($1, $2, $3)", [participantId, ids, editions]);
  return row.record_card_pulls.recorded;
}

/**
 * The finish Postgres will derive for this copy.
 *
 * Cast to the league's own day explicitly: record_card_pulls runs under
 * SET timezone = 'America/New_York' while this session is UTC, and for five hours
 * either side of midnight the two disagree about what day it is.
 */
async function derivedEdition(participantId: string, ep: string) {
  const [row] = await sql<{ e: string }>(
    `SELECT public.roll_card_edition($1, $2, (now() AT TIME ZONE 'America/New_York')::date) AS e`,
    [participantId, ep],
  );
  return row.e;
}

async function copies(participantId: string, ep: string) {
  return sql<{ edition: string; acquired_on: string | null; source: string }>(
    `SELECT edition, acquired_on, source FROM public.card_copies
      WHERE participant_id = $1 AND event_participant_id = $2
      ORDER BY created_at, edition`,
    [participantId, ep],
  );
}

async function derived(participantId: string, ep: string) {
  const [row] = await sql<{ pull_count: number; edition: string }>(
    "SELECT pull_count, edition FROM public.card_pulls WHERE participant_id = $1 AND event_participant_id = $2",
    [participantId, ep],
  );
  return row ?? null;
}

/** Move a pull copy back in time, which is the only way to fake a later day. */
async function rewindCopies(days: number) {
  await sql("UPDATE public.card_copies SET acquired_on = acquired_on - $1::int WHERE source = 'pull'", [days]); // prettier-ignore
}

describe("card_copies", () => {
  it("mints one copy per card in a pack, on the server's own finish", async () => {
    const ids = await cardIds();
    await record(IDS.alice, ids, ["gold", "standard", "platinum"]);
    expect(await copies(IDS.alice, ids[0])).toEqual([
      {
        edition: await derivedEdition(IDS.alice, ids[0]),
        acquired_on: expect.anything(),
        source: "pull",
      },
    ]);
    expect((await copies(IDS.alice, ids[2]))[0].edition).toBe(
      await derivedEdition(IDS.alice, ids[2]),
    );
  });

  it("mints no second copy for a replay of the same day", async () => {
    // The rule is the partial unique index, not a timestamp comparison — a
    // replayed pack cannot mint a copy however many times it fires.
    const ids = await cardIds();
    for (let i = 0; i < 5; i++) await record(IDS.alice, [ids[0]], ["standard"]);
    expect(await copies(IDS.alice, ids[0])).toHaveLength(1);
    expect((await derived(IDS.alice, ids[0])).pull_count).toBe(1);
  });

  it("mints a second copy on a later day", async () => {
    const ids = await cardIds();
    await record(IDS.alice, [ids[0]], ["bronze"]);
    await rewindCopies(1);
    await record(IDS.alice, [ids[0]], ["silver"]);
    expect(await copies(IDS.alice, ids[0])).toHaveLength(2);
    expect((await derived(IDS.alice, ids[0])).pull_count).toBe(2);
  });

  it("leaves the day's own copy alone on a replay, whatever it claims", async () => {
    // A replay carrying a better finish used to upgrade the copy, which was right
    // while the finish was a claim about a roll that had happened on the phone.
    // With the server deciding, an upgrade-on-replay is a ratchet: the client
    // records a pack up to three times a cycle and re-arms on 'online'.
    const ids = await cardIds();
    await record(IDS.alice, [ids[0]], ["bronze"]);
    await record(IDS.alice, [ids[0]], ["platinum"]);
    const rows = await copies(IDS.alice, ids[0]);
    expect(rows).toHaveLength(1);
    expect(rows[0].edition).toBe(await derivedEdition(IDS.alice, ids[0]));
    expect((await derived(IDS.alice, ids[0])).edition).toBe(rows[0].edition);
  });

  it("keeps two people's copies of one card apart", async () => {
    // Same card, same day, different people — and the derivation is keyed on the
    // participant, so the two finishes are independent.
    const ids = await cardIds();
    await record(IDS.alice, [ids[0]]);
    await record(IDS.bob, [ids[0]]);
    expect((await copies(IDS.alice, ids[0]))[0].edition).toBe(
      await derivedEdition(IDS.alice, ids[0]),
    );
    expect((await copies(IDS.bob, ids[0]))[0].edition).toBe(await derivedEdition(IDS.bob, ids[0]));
  });

  it("refuses a second same-day pull copy inserted directly", async () => {
    // The index is the rule, so it holds against a hand-written INSERT too.
    const ids = await cardIds();
    await record(IDS.alice, [ids[0]]);
    await expect(
      sql(
        `INSERT INTO public.card_copies (participant_id, event_participant_id, acquired_on, source)
         SELECT participant_id, event_participant_id, acquired_on, 'pull'
           FROM public.card_copies WHERE participant_id = $1`,
        [IDS.alice],
      ),
    ).rejects.toThrow();
  });

  it("lets a traded or backfilled copy sit alongside a pull on the same card", async () => {
    // Both carry a null acquired_on, so neither meets the partial index — which is
    // exactly what lets a trade land on a card the receiver already packed today.
    const ids = await cardIds();
    await record(IDS.alice, [ids[0]], ["standard"]);
    await sql(
      `INSERT INTO public.card_copies (participant_id, event_participant_id, edition, source)
       VALUES ($1, $2, 'gold', 'trade'), ($1, $2, 'silver', 'backfill')`,
      [IDS.alice, ids[0]],
    );
    expect(await copies(IDS.alice, ids[0])).toHaveLength(3);
  });
});

describe("resync_card_pull", () => {
  it("makes the derived row say exactly what the copies say", async () => {
    const ids = await cardIds();
    await sql(
      `INSERT INTO public.card_copies (participant_id, event_participant_id, edition, source)
       VALUES ($1, $2, 'bronze', 'backfill'), ($1, $2, 'gold', 'backfill'),
              ($1, $2, 'standard', 'backfill')`,
      [IDS.alice, ids[0]],
    );
    await sql("SELECT public.resync_card_pull($1, $2)", [IDS.alice, ids[0]]);
    expect(await derived(IDS.alice, ids[0])).toEqual({ pull_count: 3, edition: "gold" });
  });

  it("demotes when the best copy has gone", async () => {
    // The property trading depends on, and the one that stopped card_pulls.edition
    // being monotonically increasing.
    const ids = await cardIds();
    const rows = await sql<{ id: string }>(
      `INSERT INTO public.card_copies (participant_id, event_participant_id, edition, source)
       VALUES ($1, $2, 'platinum', 'backfill'), ($1, $2, 'bronze', 'backfill') RETURNING id`,
      [IDS.alice, ids[0]],
    );
    await sql("SELECT public.resync_card_pull($1, $2)", [IDS.alice, ids[0]]);
    expect((await derived(IDS.alice, ids[0])).edition).toBe("platinum");

    await sql("DELETE FROM public.card_copies WHERE id = $1", [rows[0].id]);
    await sql("SELECT public.resync_card_pull($1, $2)", [IDS.alice, ids[0]]);
    expect(await derived(IDS.alice, ids[0])).toEqual({ pull_count: 1, edition: "bronze" });
  });

  it("lets a real finish beat an unrecognised one", async () => {
    // rank 99 for anything the TS vocabulary does not know, so a corrupt string is
    // displaced rather than preserved forever.
    const ids = await cardIds();
    await sql(
      `INSERT INTO public.card_copies (participant_id, event_participant_id, edition, source)
       VALUES ($1, $2, 'legendary', 'backfill'), ($1, $2, 'standard', 'backfill')`,
      [IDS.alice, ids[0]],
    );
    await sql("SELECT public.resync_card_pull($1, $2)", [IDS.alice, ids[0]]);
    expect((await derived(IDS.alice, ids[0])).edition).toBe("standard");
  });

  it("removes the derived row when the last copy goes", async () => {
    // Unreachable through trading, which always leaves the giver a copy — which is
    // precisely what stops a trade ever moving the public "Packed by N" count.
    const ids = await cardIds();
    await record(IDS.alice, [ids[0]]);
    expect(await derived(IDS.alice, ids[0])).not.toBeNull();

    await sql("DELETE FROM public.card_copies WHERE participant_id = $1", [IDS.alice]);
    await sql("SELECT public.resync_card_pull($1, $2)", [IDS.alice, ids[0]]);
    expect(await derived(IDS.alice, ids[0])).toBeNull();
  });

  it("is unreachable with the publishable key", async () => {
    const ids = await cardIds();
    for (const role of ["anon", "authenticated"] as const) {
      expect(
        await isDenied(role, "SELECT public.resync_card_pull($1, $2)", [IDS.alice, ids[0]]),
      ).toBe(true);
    }
  });
});

describe("the copies and the public count", () => {
  it("leaves the row count per card a count of PEOPLE, however many copies they hold", async () => {
    // The invariant the whole schema is arranged around. Alice holding four copies
    // of a card is still one person who has packed it.
    const ids = await cardIds();
    await record(IDS.alice, [ids[0]]);
    for (let d = 1; d <= 3; d++) {
      await rewindCopies(1);
      await record(IDS.alice, [ids[0]]);
    }
    await record(IDS.bob, [ids[0]]);

    expect(await copies(IDS.alice, ids[0])).toHaveLength(4);
    const [row] = await sql<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.card_pulls WHERE event_participant_id = $1",
      [ids[0]],
    );
    expect(row.n).toBe(2);
  });
});
