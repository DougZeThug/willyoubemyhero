// The collector handoff, in one transaction.
//
// The signup flow retires the fresh participant when the merge fails. Done as
// three separate claim_guest_* calls, a failure between two of them left rows
// committed on that retired id with guest_id already nulled — unreachable on
// retry. These tests pin all-or-nothing.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, IDS, isDenied, seedEvent, sql } from "./helpers";

const GUEST = "00000000-0000-4000-8000-00000000de03";
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
