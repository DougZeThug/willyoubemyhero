// The pack-open counter, against real Postgres.
//
// One property lives here: a person's row count IS the number of packs they have
// opened. That holds only because the composite primary key is (person, league
// day) and the app deals one pack a day — so the tests that matter are the ones
// that call repeatedly and prove the number does not move.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, isDenied, IDS, seedEvent, sql } from "./helpers";

afterAll(closeDb);
beforeEach(seedEvent);

async function open(participantId: string, eventId: string | null = IDS.event, cards = 3) {
  const [row] = await sql<{ record_pack_open: number }>(
    "SELECT public.record_pack_open($1, $2, $3)",
    [participantId, eventId, cards],
  );
  return row.record_pack_open;
}

const rowCount = async () =>
  (await sql<{ n: number }>("SELECT count(*)::int AS n FROM public.pack_opens"))[0].n;

describe("record_pack_open", () => {
  it("is unreachable with the publishable key", async () => {
    // Without the REVOKE, anyone holding the key that ships to every browser can
    // inflate anyone's pack count.
    for (const role of ["anon", "authenticated"] as const) {
      expect(
        await isDenied(role, "SELECT public.record_pack_open($1, $2, $3)", [IDS.alice, null, 1]),
      ).toBe(true);
    }
  });

  it("hides the table from the publishable key in both directions", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      expect(await isDenied(role, "SELECT * FROM public.pack_opens")).toBe(true);
      expect(
        await isDenied(
          role,
          "INSERT INTO public.pack_opens (participant_id, opened_on) VALUES ($1, current_date)",
          [IDS.alice],
        ),
      ).toBe(true);
    }
  });

  it("records one pack and returns the running total", async () => {
    expect(await open(IDS.alice)).toBe(1);
    expect(await rowCount()).toBe(1);
  });

  it("counts one pack a day however many times it is called", async () => {
    // The property the counter rests on. The tear effect can re-fire on a
    // remount, a retry, or a phone changing hands and back.
    for (let i = 0; i < 25; i++) expect(await open(IDS.alice)).toBe(1);
    expect(await rowCount()).toBe(1);
  });

  it("counts yesterday and today as two packs", async () => {
    await open(IDS.alice);
    await sql("UPDATE public.pack_opens SET opened_on = opened_on - 1 WHERE participant_id = $1", [
      IDS.alice,
    ]);
    expect(await open(IDS.alice)).toBe(2);
    expect(await rowCount()).toBe(2);
  });

  it("keeps two people's packs apart", async () => {
    await open(IDS.alice);
    expect(await open(IDS.bob)).toBe(1);
    expect(await rowCount()).toBe(2);
  });

  it("never shrinks a pack that was already recorded in full", async () => {
    // A reveal-by-reveal retry arriving with a smaller count must not rewrite the
    // pack down to it.
    await open(IDS.alice, IDS.event, 3);
    await open(IDS.alice, IDS.event, 1);
    const [row] = await sql<{ card_count: number }>(
      "SELECT card_count FROM public.pack_opens WHERE participant_id = $1",
      [IDS.alice],
    );
    expect(row.card_count).toBe(3);
  });

  it("records nothing, and does not raise, for a participant who no longer exists", async () => {
    // A member token stays valid for 90 days; the participant behind it might not.
    expect(await open("00000000-0000-4000-8000-0000000000ee")).toBe(0);
    expect(await rowCount()).toBe(0);
  });

  it("accepts a pack with no event behind it", async () => {
    expect(await open(IDS.alice, null)).toBe(1);
  });

  it("keeps the pack when the event it was dealt from is deleted", async () => {
    // A pack you opened is still a pack you opened. Unlike card_pulls, which is
    // about cards and goes with them.
    await open(IDS.alice);
    await sql("DELETE FROM public.events WHERE id = $1", [IDS.event]);
    expect(await rowCount()).toBe(1);
    const [row] = await sql<{ event_id: string | null }>("SELECT event_id FROM public.pack_opens");
    expect(row.event_id).toBeNull();
  });

  it("takes a person's packs with them when they leave the league", async () => {
    await open(IDS.bob);
    await sql("DELETE FROM public.participants WHERE id = $1", [IDS.bob]);
    expect(await rowCount()).toBe(0);
  });

  it("refuses a second row for the same person and day, inserted directly", async () => {
    // The rule is the schema's, not the RPC's.
    await open(IDS.alice);
    // The RPC writes the *league* day (America/New_York), while this session's
    // current_date is the UTC date — a different day for the first hours after
    // midnight UTC, which put the duplicate on its own row and let the insert
    // through. Read the day back rather than recomputing it.
    const [{ opened_on }] = await sql<{ opened_on: string }>(
      "SELECT opened_on FROM public.pack_opens WHERE participant_id = $1",
      [IDS.alice],
    );
    await expect(
      sql("INSERT INTO public.pack_opens (participant_id, opened_on) VALUES ($1, $2)", [
        IDS.alice,
        opened_on,
      ]),
    ).rejects.toThrow();
  });

  it("refuses a negative card count", async () => {
    await expect(
      sql(
        "INSERT INTO public.pack_opens (participant_id, opened_on, card_count) VALUES ($1, current_date, -1)",
        [IDS.alice],
      ),
    ).rejects.toThrow();
  });
});

describe("the backfill", () => {
  it("turns a day of card_pulls into a pack, replayably", async () => {
    // The migration's own statement, re-run. It is the only way an existing
    // member's counter reads anything but zero on the day this ships, and it has
    // to survive tests/db applying every migration from empty.
    const ids = (
      await sql<{ id: string }>("SELECT id FROM public.event_participants ORDER BY running_order")
    ).map((r) => r.id);
    await sql("SELECT public.record_card_pulls($1, $2)", [IDS.alice, ids]);

    const backfill = `
      INSERT INTO public.pack_opens (participant_id, opened_on, event_id, card_count)
      SELECT cp.participant_id,
             (cp.first_pulled_at AT TIME ZONE 'America/New_York')::date,
             (array_agg(ep.event_id))[1],
             count(*)::int
        FROM public.card_pulls cp
        JOIN public.event_participants ep ON ep.id = cp.event_participant_id
       GROUP BY cp.participant_id, (cp.first_pulled_at AT TIME ZONE 'America/New_York')::date
      ON CONFLICT (participant_id, opened_on) WHERE participant_id IS NOT NULL DO NOTHING`;

    await sql(backfill);
    expect(await rowCount()).toBe(1);
    await sql(backfill);
    expect(await rowCount()).toBe(1);

    const [row] = await sql<{ card_count: number }>("SELECT card_count FROM public.pack_opens");
    expect(row.card_count).toBe(3);
  });

  it("records a full pack for a day where only one card was new", async () => {
    // count(*) over card_pulls counts cards somebody did not already own, not
    // cards in the pack. A day with two duplicates in it is still a pack of three.
    const ids = (
      await sql<{ id: string }>("SELECT id FROM public.event_participants ORDER BY running_order")
    ).map((r) => r.id);
    await sql("SELECT public.record_card_pulls($1, $2)", [IDS.alice, [ids[0]]]);

    await sql(`
      INSERT INTO public.pack_opens (participant_id, opened_on, event_id, card_count)
      SELECT cp.participant_id,
             (cp.first_pulled_at AT TIME ZONE 'America/New_York')::date,
             (array_agg(ep.event_id))[1],
             GREATEST(count(*)::int, 3)
        FROM public.card_pulls cp
        JOIN public.event_participants ep ON ep.id = cp.event_participant_id
       GROUP BY cp.participant_id, (cp.first_pulled_at AT TIME ZONE 'America/New_York')::date
      ON CONFLICT (participant_id, opened_on) WHERE participant_id IS NOT NULL DO NOTHING`);

    const [row] = await sql<{ card_count: number }>("SELECT card_count FROM public.pack_opens");
    expect(row.card_count).toBe(3);
  });
});
