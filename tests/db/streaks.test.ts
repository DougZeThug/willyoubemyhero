// Streaks and their milestones, against real Postgres.
//
// Two properties live here and nowhere else. A streak is recomputed from
// pack_opens inside the RPC, so nothing a phone sends can lengthen it; and a
// milestone pays exactly once per run, so a double tap, a lost response or a
// merged guest history cannot mint a second card.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, isDenied, IDS, newClient, seedEvent, sql } from "./helpers";
import { STREAK_MILESTONES } from "../../src/lib/streaks";
import { secretTierRank } from "../../src/lib/secret-rarity";
import { leagueDay, LEAGUE_TIME_ZONE } from "../../src/lib/trades";

afterAll(closeDb);
beforeEach(seedEvent);

const CARD_A = "00000000-0000-4000-8000-00000000ce01";
const CARD_B = "00000000-0000-4000-8000-00000000ce02";
const GUEST = "00000000-0000-4000-8000-00000000ce03";

type ClaimResult = {
  ok: boolean;
  reason?: string;
  milestone?: number;
  streak?: number;
  startedOn?: string;
  floor?: string | null;
  reward?: { kind: string; pullId: string; cardId: string; tier: string; duplicate: boolean };
};

async function seedSecrets(n = 2) {
  const ids = [CARD_A, CARD_B].slice(0, n);
  for (const [i, id] of ids.entries()) {
    await sql(
      `INSERT INTO public.secret_cards (id, name, art_path, active, weight)
       VALUES ($1, $2, $3, true, 100)`,
      [id, `Secret ${i}`, `secrets/${id}/art.png`],
    );
  }
}

/** An account for this identity, which is what the claim gate looks for. */
async function seedAccount(opts: { participantId?: string; guestId?: string }) {
  await sql(
    `INSERT INTO public.account_identities (user_id, participant_id, guest_id)
     VALUES (gen_random_uuid(), $1, $2)`,
    [opts.participantId ?? null, opts.guestId ?? null],
  );
}

/**
 * A run of `n` league days ending today.
 *
 * Built by recording one open and rewinding the row, never by faking a clock:
 * the test session's current_date is UTC while the RPC writes the New York day,
 * so the only safe source of "today" is what the RPC itself already wrote.
 */
async function openDays(n: number, opts: { participantId?: string; guestId?: string } = {}) {
  const pid = opts.participantId ?? IDS.alice;
  const gid = opts.guestId ?? null;
  // Past a handful of days the per-day rewind below is hundreds of round trips,
  // which the hundred-day rung would pay on every case that walks the ladder. One
  // recorded open still supplies "today" — the rule this helper exists for — and
  // generate_series lays the rest of the run out behind it in a single statement.
  if (n > 5) {
    await sql("SELECT public.record_pack_open($1, $2, $3, $4)", [
      gid ? null : pid,
      IDS.event,
      3,
      gid,
    ]);
    await sql(
      `INSERT INTO public.pack_opens (participant_id, guest_id, opened_on, event_id, card_count)
       SELECT $1, $2, (SELECT max(opened_on) FROM public.pack_opens
                        WHERE ($1::uuid IS NOT NULL AND participant_id = $1)
                           OR ($2::uuid IS NOT NULL AND guest_id = $2)) - g, $3, 3
         FROM generate_series(1, $4::int) g`,
      [gid ? null : pid, gid, IDS.event, n - 1],
    );
    return;
  }
  for (let back = 0; back < n; back++) {
    await sql("SELECT public.record_pack_open($1, $2, $3, $4)", [
      opts.guestId ? null : pid,
      IDS.event,
      3,
      gid,
    ]);
    if (back < n - 1) {
      await sql(
        `UPDATE public.pack_opens SET opened_on = opened_on - make_interval(days => $1)
          WHERE opened_on = (SELECT max(opened_on) FROM public.pack_opens
                              WHERE ($2::uuid IS NOT NULL AND participant_id = $2)
                                 OR ($3::uuid IS NOT NULL AND guest_id = $3))
            AND (($2::uuid IS NOT NULL AND participant_id = $2)
              OR ($3::uuid IS NOT NULL AND guest_id = $3))`,
        [back + 1, opts.guestId ? null : pid, gid],
      );
    }
  }
}

async function claim(milestone: number, opts: { participantId?: string; guestId?: string } = {}) {
  const [row] = await sql<{ claim_streak_milestone: ClaimResult }>(
    "SELECT public.claim_streak_milestone($1, $2, $3, $4)",
    [
      opts.participantId ?? (opts.guestId ? null : IDS.alice),
      opts.guestId ?? null,
      milestone,
      IDS.event,
    ],
  );
  return row.claim_streak_milestone;
}

/**
 * Move every one of somebody's pack days back by `days`.
 *
 * In two hops, and via somewhere nothing else is sitting: pack_opens_one_per_day
 * is not deferrable, so shifting a contiguous block down by one is checked row by
 * row and collides with the day it is about to vacate.
 */
async function shiftDays(days: number, participantId = IDS.alice) {
  await sql("UPDATE public.pack_opens SET opened_on = opened_on - 1000 WHERE participant_id = $1", [
    participantId,
  ]);
  await sql(
    "UPDATE public.pack_opens SET opened_on = opened_on + $1::int WHERE participant_id = $2",
    [1000 - days, participantId],
  );
}

const claimRows = async () =>
  (await sql<{ n: number }>("SELECT count(*)::int AS n FROM public.streak_milestone_claims"))[0].n;

const pullRows = async () =>
  (await sql<{ n: number }>("SELECT count(*)::int AS n FROM public.secret_card_pulls"))[0].n;

describe("grants", () => {
  it("hides the claims table from the publishable key in both directions", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      expect(await isDenied(role, "SELECT * FROM public.streak_milestone_claims")).toBe(true);
      expect(
        await isDenied(
          role,
          `INSERT INTO public.streak_milestone_claims
             (participant_id, streak_started_on, milestone, claimed_on)
           VALUES ($1, current_date, 3, current_date)`,
          [IDS.alice],
        ),
      ).toBe(true);
    }
  });

  it("keeps every new function out of the publishable key's reach", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      expect(
        await isDenied(role, "SELECT public.claim_streak_milestone($1, NULL, 3, NULL)", [
          IDS.alice,
        ]),
      ).toBe(true);
      expect(
        await isDenied(role, "SELECT public.pull_bonus_secret_card($1, NULL, NULL, NULL)", [
          IDS.alice,
        ]),
      ).toBe(true);
      expect(await isDenied(role, "SELECT public.roll_secret_tier_at_least('rare')", [])).toBe(
        true,
      );
      expect(await isDenied(role, "SELECT * FROM public.streak_runs($1, NULL)", [IDS.alice])).toBe(
        true,
      );
      expect(
        await isDenied(role, "SELECT public.claim_guest_streak_milestones($1, $2)", [
          IDS.alice,
          GUEST,
        ]),
      ).toBe(true);
      expect(
        await isDenied(role, "SELECT public.merge_guest_streak_milestones($1, $2)", [GUEST, GUEST]),
      ).toBe(true);
    }
  });
});

describe("streak_runs", () => {
  it("collapses consecutive days into one run and splits on a gap", async () => {
    await openDays(3);
    await sql(
      `INSERT INTO public.pack_opens (participant_id, opened_on, event_id, card_count)
       SELECT $1, min(opened_on) - 5, $2, 3 FROM public.pack_opens WHERE participant_id = $1`,
      [IDS.alice, IDS.event],
    );
    const runs = await sql<{ started_on: string; ended_on: string; len: number }>(
      "SELECT * FROM public.streak_runs($1, NULL) ORDER BY started_on",
      [IDS.alice],
    );
    expect(runs.map((r) => r.len)).toEqual([1, 3]);
  });

  it("agrees with walkStreak on the same days", async () => {
    // The TypeScript walk decides whether the button is drawn and this one decides
    // whether the claim is authorised. Two implementations that disagree show a
    // button that does nothing.
    const { walkStreak } = await import("../../src/lib/streaks");
    await openDays(4);
    const days = await sql<{ opened_on: string }>(
      "SELECT opened_on::text FROM public.pack_opens WHERE participant_id = $1",
      [IDS.alice],
    );
    const [today] = await sql<{ today: string }>(
      "SELECT (now() AT TIME ZONE 'America/New_York')::date::text AS today",
    );
    const walked = walkStreak(
      days.map((d) => d.opened_on),
      today.today,
    );
    const runs = await sql<{ len: number }>(
      "SELECT len FROM public.streak_runs($1, NULL) WHERE ended_on IN ($2::date, $2::date - 1)",
      [IDS.alice, today.today],
    );
    expect(runs[0]?.len).toBe(walked.current);
    expect(walked.current).toBe(4);
  });
});

describe("claim_streak_milestone", () => {
  it("pays a bonus secret and files exactly one claim", async () => {
    await seedSecrets();
    await seedAccount({ participantId: IDS.alice });
    await openDays(3);

    const res = await claim(3);
    expect(res.ok).toBe(true);
    expect(res.milestone).toBe(3);
    expect(res.streak).toBe(3);
    expect(res.reward?.kind).toBe("secret");
    expect(await claimRows()).toBe(1);

    const [pull] = await sql<{ granted: boolean; participant_id: string }>(
      "SELECT granted, participant_id FROM public.secret_card_pulls WHERE id = $1",
      [res.reward!.pullId],
    );
    expect(pull.granted).toBe(true);
    expect(pull.participant_id).toBe(IDS.alice);
  });

  it("records the payout on the claim row", async () => {
    await seedSecrets();
    await seedAccount({ participantId: IDS.alice });
    await openDays(3);
    const res = await claim(3);
    const [row] = await sql<{ reward_ref: string; reward_kind: string }>(
      "SELECT reward_ref::text, reward_kind FROM public.streak_milestone_claims",
    );
    expect(row.reward_ref).toBe(res.reward!.pullId);
    expect(row.reward_kind).toBe("secret");
  });

  it("refuses an identity with no account behind it, and writes nothing", async () => {
    await seedSecrets();
    await openDays(3);
    expect((await claim(3)).reason).toBe("account_required");
    expect(await claimRows()).toBe(0);
    expect(await pullRows()).toBe(0);
  });

  it("refuses a streak that is not there yet", async () => {
    await seedSecrets();
    await seedAccount({ participantId: IDS.alice });
    await openDays(2);
    expect((await claim(3)).reason).toBe("not_earned");
    expect(await claimRows()).toBe(0);
  });

  it("refuses a milestone that is not on the ladder", async () => {
    await seedSecrets();
    await seedAccount({ participantId: IDS.alice });
    await openDays(30);
    expect((await claim(5)).reason).toBe("unknown_milestone");
    expect((await claim(1)).reason).toBe("unknown_milestone");
    expect(await claimRows()).toBe(0);
  });

  it("refuses an unknown participant", async () => {
    const res = await claim(3, { participantId: "00000000-0000-4000-8000-0000000000de" });
    expect(res.reason).toBe("not_found");
  });

  it("says so softly when the catalogue is empty, and writes nothing", async () => {
    await seedAccount({ participantId: IDS.alice });
    await openDays(3);
    expect((await claim(3)).reason).toBe("unavailable");
    expect(await claimRows()).toBe(0);
  });

  it("is idempotent however many times it is tapped", async () => {
    await seedSecrets();
    await seedAccount({ participantId: IDS.alice });
    await openDays(3);
    expect((await claim(3)).ok).toBe(true);
    for (let i = 0; i < 25; i++) {
      expect((await claim(3)).reason).toBe("claimed");
    }
    expect(await claimRows()).toBe(1);
    expect(await pullRows()).toBe(1);
  });

  it("pays once when two connections race the same milestone", async () => {
    await seedSecrets();
    await seedAccount({ participantId: IDS.alice });
    await openDays(3);

    const a = await newClient();
    const b = await newClient();
    try {
      const results = await Promise.all([
        a.query("SELECT public.claim_streak_milestone($1, NULL, 3, $2)", [IDS.alice, IDS.event]),
        b.query("SELECT public.claim_streak_milestone($1, NULL, 3, $2)", [IDS.alice, IDS.event]),
      ]);
      const ok = results.filter((r) => r.rows[0].claim_streak_milestone.ok);
      expect(ok).toHaveLength(1);
    } finally {
      await a.end();
      await b.end();
    }
    expect(await claimRows()).toBe(1);
    expect(await pullRows()).toBe(1);
  });

  it("still counts a run that ended yesterday", async () => {
    await seedSecrets();
    await seedAccount({ participantId: IDS.alice });
    await openDays(3);
    // Push the whole run back one day: alive, but at risk.
    await shiftDays(1);
    expect((await claim(3)).ok).toBe(true);
  });

  it("forgets a run that ended two days ago", async () => {
    await seedSecrets();
    await seedAccount({ participantId: IDS.alice });
    await openDays(3);
    await shiftDays(2);
    expect((await claim(3)).reason).toBe("not_earned");
  });

  it("lets a rebuilt streak earn the same milestone again", async () => {
    await seedSecrets();
    await seedAccount({ participantId: IDS.alice });
    await openDays(3);
    expect((await claim(3)).ok).toBe(true);

    // Two months ago they had a three-day run and cashed it. Move the days AND
    // the claim they earned, or the "new" run just reoccupies the same dates and
    // the test proves nothing.
    await shiftDays(60);
    await sql(
      `UPDATE public.streak_milestone_claims
          SET streak_started_on = streak_started_on - 60, claimed_on = claimed_on - 60`,
    );
    await openDays(3);
    expect((await claim(3)).ok).toBe(true);
    expect(await claimRows()).toBe(2);
  });

  it("does not re-arm a paid milestone when older days are merged in behind it", async () => {
    // claim_guest_packs moves a guest's history onto the member, which can push
    // the run's first day backwards — a new key on the same streak. Matching on
    // the whole run's window rather than its start date is what closes that.
    await seedSecrets();
    await seedAccount({ participantId: IDS.alice });
    await openDays(3);
    expect((await claim(3)).ok).toBe(true);

    await sql(
      `INSERT INTO public.pack_opens (participant_id, opened_on, event_id, card_count)
       SELECT $1, min(opened_on) - g, $2, 3
         FROM public.pack_opens, generate_series(1, 2) g
        WHERE participant_id = $1
        GROUP BY g`,
      [IDS.alice, IDS.event],
    );
    expect((await claim(3)).reason).toBe("claimed");
    expect(await claimRows()).toBe(1);
    expect(await pullRows()).toBe(1);
  });

  it("keeps two people's streaks apart", async () => {
    await seedSecrets();
    await seedAccount({ participantId: IDS.alice });
    await seedAccount({ participantId: IDS.bob });
    await openDays(3);
    await openDays(1, { participantId: IDS.bob });

    expect((await claim(3)).ok).toBe(true);
    expect((await claim(3, { participantId: IDS.bob })).reason).toBe("not_earned");
  });

  it("pays a guest with an account, against their guest id", async () => {
    await seedSecrets();
    await seedAccount({ guestId: GUEST });
    await openDays(3, { guestId: GUEST });

    const res = await claim(3, { guestId: GUEST });
    expect(res.ok).toBe(true);
    const [pull] = await sql<{ guest_id: string; granted: boolean }>(
      "SELECT guest_id::text, granted FROM public.secret_card_pulls WHERE id = $1",
      [res.reward!.pullId],
    );
    expect(pull.guest_id).toBe(GUEST);
    expect(pull.granted).toBe(true);
  });

  it("collects two rungs of one long streak without colliding", async () => {
    await seedSecrets();
    await seedAccount({ participantId: IDS.alice });
    await openDays(7);
    expect((await claim(3)).ok).toBe(true);
    expect((await claim(7)).ok).toBe(true);
    expect(await claimRows()).toBe(2);
    expect(await pullRows()).toBe(2);
  });
});

describe("pull_bonus_secret_card", () => {
  it("leaves the free daily pull untouched", async () => {
    // The whole reason the bonus inserts granted = true: the daily unique index
    // is WHERE NOT granted, so a milestone must not cost somebody their pull.
    await seedSecrets();
    await seedAccount({ participantId: IDS.alice });
    await openDays(3);
    expect((await claim(3)).ok).toBe(true);

    const [daily] = await sql<{ pull_secret_card: { fresh: boolean } | null }>(
      "SELECT public.pull_secret_card($1, NULL, $2)",
      [IDS.alice, IDS.event],
    );
    expect(daily.pull_secret_card?.fresh).toBe(true);
  });

  it("marks a card they already own as a duplicate rather than failing", async () => {
    await seedSecrets(1);
    await seedAccount({ participantId: IDS.alice });
    await openDays(7);
    expect((await claim(3)).ok).toBe(true);
    // Only one card exists, so the second bonus has to come back as a duplicate.
    const second = await claim(7);
    expect(second.ok).toBe(true);
    expect(second.reward?.duplicate).toBe(true);
  });
});

describe("carrying a guest's claims", () => {
  it("moves them onto the participant so nothing pays twice", async () => {
    await seedSecrets();
    await seedAccount({ guestId: GUEST });
    await openDays(3, { guestId: GUEST });
    expect((await claim(3, { guestId: GUEST })).ok).toBe(true);

    await sql("SELECT public.claim_guest_packs($1, $2)", [IDS.alice, GUEST]);
    await sql("SELECT public.claim_guest_streak_milestones($1, $2)", [IDS.alice, GUEST]);

    const [row] = await sql<{ participant_id: string; guest_id: string | null }>(
      "SELECT participant_id::text, guest_id::text FROM public.streak_milestone_claims",
    );
    expect(row.participant_id).toBe(IDS.alice);
    expect(row.guest_id).toBeNull();

    await seedAccount({ participantId: IDS.alice });
    expect((await claim(3)).reason).toBe("claimed");
    expect(await pullRows()).toBe(1);
  });

  it("drops a guest claim the member already holds for that run", async () => {
    await seedSecrets();
    await seedAccount({ participantId: IDS.alice });
    await openDays(3);
    expect((await claim(3)).ok).toBe(true);

    const [{ streak_started_on }] = await sql<{ streak_started_on: string }>(
      "SELECT streak_started_on::text FROM public.streak_milestone_claims",
    );
    await sql(
      `INSERT INTO public.streak_milestone_claims
         (guest_id, streak_started_on, milestone, claimed_on, reward_kind)
       VALUES ($1, $2, 3, current_date, 'secret')`,
      [GUEST, streak_started_on],
    );

    await sql("SELECT public.claim_guest_streak_milestones($1, $2)", [IDS.alice, GUEST]);
    expect(await claimRows()).toBe(1);
  });

  it("merges guest to guest", async () => {
    const other = "00000000-0000-4000-8000-00000000ce09";
    await sql(
      `INSERT INTO public.streak_milestone_claims
         (guest_id, streak_started_on, milestone, claimed_on, reward_kind)
       VALUES ($1, current_date, 3, current_date, 'secret')`,
      [other],
    );
    await sql("SELECT public.merge_guest_streak_milestones($1, $2)", [GUEST, other]);
    const [row] = await sql<{ guest_id: string }>(
      "SELECT guest_id::text FROM public.streak_milestone_claims",
    );
    expect(row.guest_id).toBe(GUEST);
  });
});

describe("roll_secret_tier_at_least", () => {
  /** `n` rolls at one floor, in a single statement. */
  const roll = async (floor: string | null, n = 300) =>
    (
      await sql<{ tier: string }>(
        `SELECT public.roll_secret_tier_at_least($1) AS tier FROM generate_series(1, $2::int)`,
        [floor, n],
      )
    ).map((r) => r.tier);

  it("never rolls below the floor it was given", async () => {
    const tiers = await roll("legendary");
    expect(tiers.every((t) => secretTierRank(t) <= secretTierRank("legendary"))).toBe(true);
    expect((await roll("mythic")).every((t) => t === "mythic")).toBe(true);
  });

  it("is a floor and not a pin — a good roll still stands", async () => {
    // The assertion that tells the two apart. A body that just returned its
    // argument passes every other test here and fails only this one. At a rare
    // floor, 12% of rolls beat it, so a false failure is 0.88^300 ~ 1e-17.
    const tiers = await roll("rare");
    expect(tiers.some((t) => secretTierRank(t) < secretTierRank("rare"))).toBe(true);
  });

  it("degrades a floor it cannot read to the plain roll, rather than raising", async () => {
    // secret_card_pulls.tier carries no CHECK constraint, so a floor written
    // straight through would persist forever and render as "Common". And
    // claim_streak_milestone files its claim row BEFORE the payout, so raising
    // here would take somebody's claim down with it. Both say: degrade quietly.
    for (const floor of [null, "gold", "__proto__"]) {
      const tiers = await roll(floor);
      expect(tiers.every((t) => secretTierRank(t) < 5)).toBe(true);
      expect(tiers.includes(floor as string)).toBe(false);
      // Not silently floored either: at the base rate 96% of rolls are worse
      // than legendary, so seeing none of them in 300 would be 4e-8.
      expect(tiers.some((t) => secretTierRank(t) > secretTierRank("legendary"))).toBe(true);
    }
  });
});

describe("the TypeScript ladder and the SQL one", () => {
  it("agree on every rung, and on what each one pays", async () => {
    await seedSecrets();
    await seedAccount({ participantId: IDS.alice });
    await openDays(100);
    for (const m of STREAK_MILESTONES) {
      const res = await claim(m.days);
      expect(res.ok).toBe(true);
      // The floor map, pinned the same way the rung list is: this is the reason
      // claim_streak_milestone puts `floor` on the wire at all.
      expect(res.floor ?? null).toBe(m.tierFloor);
      // And it reached the row, rather than only the response.
      if (m.tierFloor) {
        expect(secretTierRank(res.reward!.tier)).toBeLessThanOrEqual(secretTierRank(m.tierFloor));
      }
      const [row] = await sql<{ tier: string }>(
        "SELECT tier FROM public.secret_card_pulls WHERE id = $1",
        [res.reward!.pullId],
      );
      expect(row.tier).toBe(res.reward!.tier);
    }
  });

  it("agree that nothing between the rungs is claimable", async () => {
    await seedSecrets();
    await seedAccount({ participantId: IDS.alice });
    await openDays(100);
    // Rejected even on a run long enough to have earned them, because the ladder
    // gate is the first check after the identity guard.
    for (const notARung of [1, 2, 4, 6, 8, 15, 29, 31, 99, 101]) {
      expect((await claim(notARung)).reason).toBe("unknown_milestone");
    }
  });

  it("pays the capstone a mythic, even when the card is one they already hold", async () => {
    // One card in the catalogue, so the second claim can only be a duplicate —
    // and a duplicate that rolled better still upgrades the copy in the vault.
    // That is what stops a hundred days being spent on a card they own.
    await seedSecrets(1);
    await seedAccount({ participantId: IDS.alice });
    await openDays(100);

    const first = await claim(3);
    expect(first.ok).toBe(true);
    const capstone = await claim(100);
    expect(capstone.reward!.tier).toBe("mythic");
    expect(capstone.reward!.duplicate).toBe(true);

    const [owned] = await sql<{ tier: string }>(
      `SELECT tier FROM public.secret_card_pulls
        WHERE participant_id = $1 AND NOT is_duplicate`,
      [IDS.alice],
    );
    expect(owned.tier).toBe("mythic");
  });

  it("agree on where a day ends", async () => {
    const [row] = await sql<{ zone: string; today: string }>(`
      SELECT (SELECT cfg FROM unnest(p.proconfig) AS cfg
               WHERE cfg LIKE 'TimeZone=%' OR cfg LIKE 'timezone=%') AS zone,
             (now() AT TIME ZONE 'America/New_York')::date::text AS today
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'claim_streak_milestone'
    `);
    expect(row.zone).toBe(`TimeZone=${LEAGUE_TIME_ZONE}`);
    expect(leagueDay()).toBe(row.today);
  });
});
