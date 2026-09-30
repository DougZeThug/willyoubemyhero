// The collector handoff, in one transaction.
//
// The signup flow retires the fresh participant when the merge fails. Done as
// three separate claim_guest_* calls, a failure between two of them left rows
// committed on that retired id with guest_id already nulled — unreachable on
// retry. These tests pin all-or-nothing.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, IDS, isDenied, seedEvent, sql } from "./helpers";

const GUEST = "00000000-0000-4000-8000-00000000de03";
const GUEST_B = "00000000-0000-4000-8000-00000000de04";
const CARD = "00000000-0000-4000-8000-00000000ca13";
const COLLECTOR = "00000000-0000-4000-8000-00000000aa11";

afterAll(closeDb);

beforeEach(async () => {
  await seedEvent();
  await sql(
    `INSERT INTO public.participants (id, name, active, is_collector)
     VALUES ($1, 'Collector', true, true)`,
    [COLLECTOR],
  );
  await sql(
    `INSERT INTO public.secret_cards (id, name, collection, active)
     VALUES ($1, 'Wisp', 'pets', true)`,
    [CARD],
  );
  await sql(
    `INSERT INTO public.secret_card_pulls (guest_id, secret_card_id, pulled_on, event_id, tier)
     VALUES ($1, $2, current_date, $3, 'common')`,
    [GUEST, CARD, IDS.event],
  );
  await sql(
    `INSERT INTO public.pack_opens (guest_id, opened_on, event_id, card_count)
     VALUES ($1, current_date, $2, 3)`,
    [GUEST, IDS.event],
  );
  await sql(
    `INSERT INTO public.streak_milestone_claims
       (guest_id, streak_started_on, milestone, claimed_on, reward_kind, event_id)
     VALUES ($1, current_date, 3, current_date, 'secret', $2)`,
    [GUEST, IDS.event],
  );
});

function owner(table: string) {
  return sql<{ participant_id: string | null; guest_id: string | null }>(
    `SELECT participant_id::text, guest_id::text FROM public.${table}`,
  );
}

describe("merge_guest_into_collector", () => {
  it("moves the device's secrets, packs and milestone claims together", async () => {
    await sql("SELECT public.merge_guest_into_collector($1, $2)", [COLLECTOR, GUEST]);

    for (const table of ["secret_card_pulls", "pack_opens", "streak_milestone_claims"]) {
      expect(await owner(table)).toEqual([{ participant_id: COLLECTOR, guest_id: null }]);
    }
  });

  it("moves nothing when the participant does not exist", async () => {
    await expect(
      sql("SELECT public.merge_guest_into_collector($1, $2)", [
        "00000000-0000-4000-8000-00000000dead",
        GUEST,
      ]),
    ).rejects.toThrow(/No such player/);

    for (const table of ["secret_card_pulls", "pack_opens", "streak_milestone_claims"]) {
      expect(await owner(table)).toEqual([{ participant_id: null, guest_id: GUEST }]);
    }
  });

  it("is out of reach of the browser roles", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      expect(
        await isDenied(role, "SELECT public.merge_guest_into_collector($1, $2)", [
          COLLECTOR,
          GUEST,
        ]),
      ).toBe(true);
    }
  });
});

describe("merge_guests_into_collector", () => {
  /** A second device's day, so a merge has two distinct guests to fold. */
  async function seedSecondGuest() {
    await sql(
      `INSERT INTO public.secret_card_pulls (guest_id, secret_card_id, pulled_on, event_id, tier)
       VALUES ($1, $2, current_date - 1, $3, 'common')`,
      [GUEST_B, CARD, IDS.event],
    );
    await sql(
      `INSERT INTO public.pack_opens (guest_id, opened_on, event_id, card_count)
       VALUES ($1, current_date - 1, $2, 3)`,
      [GUEST_B, IDS.event],
    );
    await sql(
      `INSERT INTO public.streak_milestone_claims
         (guest_id, streak_started_on, milestone, claimed_on, reward_kind, event_id)
       VALUES ($1, current_date - 1, 7, current_date - 1, 'secret', $2)`,
      [GUEST_B, IDS.event],
    );
  }

  it("moves every guest it is given", async () => {
    await seedSecondGuest();
    await sql("SELECT public.merge_guests_into_collector($1, $2)", [COLLECTOR, [GUEST, GUEST_B]]);

    for (const table of ["secret_card_pulls", "pack_opens", "streak_milestone_claims"]) {
      const rows = await owner(table);
      expect(rows).toHaveLength(2);
      expect(rows).toEqual([
        { participant_id: COLLECTOR, guest_id: null },
        { participant_id: COLLECTOR, guest_id: null },
      ]);
    }
  });

  it("moves NEITHER guest when the participant does not exist", async () => {
    // The whole point. Looped a guest at a time, each call was its own
    // transaction: the first committed with guest_id nulled, the second raised,
    // and createCollector's catch block retired the participant the first one's
    // rows had just landed on. Nothing could name them again.
    await seedSecondGuest();
    await expect(
      sql("SELECT public.merge_guests_into_collector($1, $2)", [
        "00000000-0000-4000-8000-00000000dead",
        [GUEST, GUEST_B],
      ]),
    ).rejects.toThrow(/No such player/);

    for (const table of ["secret_card_pulls", "pack_opens", "streak_milestone_claims"]) {
      const rows = await owner(table);
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row.participant_id).toBeNull();
      expect(rows.map((r) => r.guest_id).sort()).toEqual([GUEST, GUEST_B].sort());
    }
  });

  it("takes an empty array, a null and a duplicate without complaint", async () => {
    await sql("SELECT public.merge_guests_into_collector($1, $2::uuid[])", [COLLECTOR, []]);
    for (const table of ["secret_card_pulls", "pack_opens", "streak_milestone_claims"]) {
      expect(await owner(table)).toEqual([{ participant_id: null, guest_id: GUEST }]);
    }

    // A NULL slot is the shape `[priorGuestId ?? null, ...deviceGuestIds]` hands
    // over when the account had no guest of its own, and the same id can arrive
    // from both the account row and the handset.
    await sql("SELECT public.merge_guests_into_collector($1, $2)", [
      COLLECTOR,
      [null, GUEST, GUEST],
    ]);
    for (const table of ["secret_card_pulls", "pack_opens", "streak_milestone_claims"]) {
      expect(await owner(table)).toEqual([{ participant_id: COLLECTOR, guest_id: null }]);
    }
  });

  it("is out of reach of the browser roles", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      expect(
        await isDenied(role, "SELECT public.merge_guests_into_collector($1, $2)", [
          COLLECTOR,
          [GUEST],
        ]),
      ).toBe(true);
    }
  });
});
