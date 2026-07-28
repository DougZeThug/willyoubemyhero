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

async function record(participantId: string, ids: string[]): Promise<number> {
  const [row] = await sql<{ record_card_pulls: number }>(
    "SELECT public.record_card_pulls($1, $2)",
    [participantId, ids],
  );
  return row.record_card_pulls;
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
    // credit themselves the whole roster.
    for (const role of ["anon", "authenticated"] as const) {
      expect(await isDenied(role, "SELECT public.record_card_pulls($1, $2)", [IDS.alice, []])).toBe(
        true,
      );
    }
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

  it("bumps the invisible pull_count while leaving the visible number alone", async () => {
    const ids = await cardIds();
    await record(IDS.alice, [ids[0]]);
    await record(IDS.alice, [ids[0]]);
    const [row] = await sql<{ pull_count: number }>(
      "SELECT pull_count FROM public.card_pulls WHERE event_participant_id = $1",
      [ids[0]],
    );
    expect(row.pull_count).toBe(2);
    expect((await counts())[ids[0]]).toBe(1);
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
