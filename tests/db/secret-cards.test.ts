// The secret-card RPCs, against real Postgres.
//
// Two properties live here and nowhere else. The first is that `anon` cannot
// execute either function: the publishable key ships to every browser, so a
// missing REVOKE turns `POST /rest/v1/rpc/pull_secret_card` into a free read of
// the whole set. The second is that one member gets exactly one card per league
// day even when two requests race — which is why the rule is an index and a row
// lock rather than a check in the UI.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, isDenied, IDS, newClient, seedEvent, sql } from "./helpers";

afterAll(closeDb);
beforeEach(seedEvent);

type Pull = {
  pullId: string;
  cardId: string;
  day: string;
  duplicate: boolean;
  fresh: boolean;
} | null;

async function addCard(name: string, over: { active?: boolean; artPath?: string | null } = {}) {
  const [row] = await sql<{ id: string }>(
    `INSERT INTO public.secret_cards (name, art_path, active)
     VALUES ($1, $2, $3) RETURNING id`,
    [name, over.artPath === undefined ? `secrets/${name}/art-1.webp` : over.artPath, over.active ?? true], // prettier-ignore
  );
  return row.id;
}

async function pull(participantId = IDS.alice, eventId: string | null = IDS.event): Promise<Pull> {
  const [row] = await sql<{ pull_secret_card: Pull }>(
    "SELECT public.pull_secret_card($1, $2, $3)",
    [participantId, null, eventId],
  );
  return row.pull_secret_card;
}

/** The same pull, as a guest. Guests carry a server-minted id, not a participant. */
async function pullAsGuest(guestId = GUEST_A, eventId: string | null = IDS.event): Promise<Pull> {
  const [row] = await sql<{ pull_secret_card: Pull }>(
    "SELECT public.pull_secret_card($1, $2, $3)",
    [null, guestId, eventId],
  );
  return row.pull_secret_card;
}

const GUEST_A = "00000000-0000-4000-8000-0000000000e1";
const GUEST_B = "00000000-0000-4000-8000-0000000000e2";

async function status(participantId: string | null = IDS.alice, guestId: string | null = null) {
  const [row] = await sql<{
    secret_pull_status: {
      day: string;
      pulledToday: boolean;
      pulled: number;
      available: boolean;
      resetsAt: string;
    };
  }>("SELECT public.secret_pull_status($1, $2)", [participantId, guestId]);
  return row.secret_pull_status;
}

const ledger = () =>
  sql<{ secret_card_id: string; pulled_on: string; is_duplicate: boolean }>(
    "SELECT secret_card_id, pulled_on, is_duplicate FROM public.secret_card_pulls ORDER BY pulled_on",
  );

describe("the RPCs are unreachable with the publishable key", () => {
  // The single most important assertion in the feature. Everything else is a
  // nicety if a stranger can call the pull function.
  it.each(["anon", "authenticated"] as const)(
    "%s cannot execute pull_secret_card",
    async (role) => {
      expect(
        await isDenied(role, "SELECT public.pull_secret_card($1, null, null)", [IDS.alice]),
      ).toBe(true);
    },
  );

  it.each(["anon", "authenticated"] as const)(
    "%s cannot execute secret_pull_status",
    async (role) => {
      expect(await isDenied(role, "SELECT public.secret_pull_status($1, null)", [IDS.alice])).toBe(
        true,
      );
    },
  );

  it.each(["anon", "authenticated"] as const)(
    "%s cannot execute claim_guest_secrets",
    async (role) => {
      // Reachable, it would let anyone graft a guest's cards onto any player.
      expect(
        await isDenied(role, "SELECT public.claim_guest_secrets($1, $2)", [IDS.alice, GUEST_A]),
      ).toBe(true);
    },
  );

  it("grants anon EXECUTE on none of the functions this app wrote", async () => {
    // A general guard rather than an allowlist: this catches the next RPC too,
    // and every overload created by a signature change that the old REVOKE no
    // longer covers. Extension functions (pgcrypto lives in public here) and
    // trigger functions are excluded — neither is reachable over PostgREST.
    const rows = await sql<{ sig: string }>(`
      SELECT p.oid::regprocedure::text AS sig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.prorettype <> 'pg_catalog.trigger'::regtype
         AND NOT EXISTS (
           SELECT 1 FROM pg_depend d
            WHERE d.objid = p.oid AND d.classid = 'pg_proc'::regclass AND d.deptype = 'e')
         AND (has_function_privilege('anon', p.oid, 'EXECUTE')
           OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
       ORDER BY sig
    `);
    expect(rows.map((r) => r.sig)).toEqual([]);
  });
});

describe("the look columns", () => {
  it("defaults a bare insert to the rosette spinner", async () => {
    const id = await addCard("Gary the Grill");
    const [row] = await sql<{ foil: string; border_fx: string }>(
      "SELECT foil, border_fx FROM public.secret_cards WHERE id = $1",
      [id],
    );
    expect(row).toEqual({ foil: "rosette", border_fx: "spin" });
  });

  it("rejects NULL, which no fallback in TS would catch", async () => {
    const id = await addCard("Gary the Grill");
    await expect(
      sql("UPDATE public.secret_cards SET border_fx = NULL WHERE id = $1", [id]),
    ).rejects.toThrow(/not-null/);
  });

  it("accepts an arbitrary string — the vocabulary lives in TS, not a CHECK", async () => {
    // Deliberate, and worth pinning: an unknown value falls back in secretFoil
    // the way an unrecognised card_rarity falls back to base, so a vocabulary
    // change never needs a data migration.
    const id = await addCard("Gary the Grill");
    await sql("UPDATE public.secret_cards SET foil = 'from-the-future', border_fx = 'wobble' WHERE id = $1", [id]); // prettier-ignore
    const [row] = await sql<{ foil: string; border_fx: string }>(
      "SELECT foil, border_fx FROM public.secret_cards WHERE id = $1",
      [id],
    );
    expect(row).toEqual({ foil: "from-the-future", border_fx: "wobble" });
  });
});

describe("pull_secret_card", () => {
  it("hands out a card and records the league day", async () => {
    const id = await addCard("Gary the Grill");
    const res = await pull();
    expect(res).toMatchObject({ cardId: id, duplicate: false, fresh: true });
    expect(await ledger()).toEqual([
      { secret_card_id: id, pulled_on: expect.anything(), is_duplicate: false },
    ]);
  });

  it("returns the same card on a second call the same day, and writes no second row", async () => {
    await addCard("Gary the Grill");
    await addCard("The Gazebo");
    const first = await pull();
    const second = await pull();
    expect(second!.cardId).toBe(first!.cardId);
    expect(second!.fresh).toBe(false);
    expect(await ledger()).toHaveLength(1);
  });

  it("refuses a second pull inserted directly, so the rule is the schema's not the RPC's", async () => {
    const id = await addCard("Gary the Grill");
    await pull();
    await expect(
      sql(
        `INSERT INTO public.secret_card_pulls (participant_id, secret_card_id, pulled_on)
         VALUES ($1, $2, current_date)`,
        [IDS.alice, id],
      ),
    ).rejects.toThrow();
  });

  it("lets yesterday's pull stand and still deals today", async () => {
    await addCard("Gary the Grill");
    await addCard("The Gazebo");
    await pull();
    await sql("UPDATE public.secret_card_pulls SET pulled_on = pulled_on - 1");
    const today = await pull();
    expect(today!.fresh).toBe(true);
    expect(await ledger()).toHaveLength(2);
  });

  it("never deals the same card twice while the member still has one to find", async () => {
    const a = await addCard("Gary the Grill");
    const b = await addCard("The Gazebo");
    const first = await pull();
    await sql("UPDATE public.secret_card_pulls SET pulled_on = pulled_on - 1");
    const second = await pull();
    expect(second!.duplicate).toBe(false);
    expect([first!.cardId, second!.cardId].sort()).toEqual([a, b].sort());
  });

  it("gives everyone their own pull on the same day", async () => {
    await addCard("Gary the Grill");
    await pull(IDS.alice);
    await pull(IDS.bob);
    expect(await ledger()).toHaveLength(2);
  });

  it("leaves exactly one row when two connections race for one member", async () => {
    await addCard("Gary the Grill");
    await addCard("The Gazebo");
    const [a, b] = [await newClient(), await newClient()];
    try {
      const results = await Promise.all([
        a.query("SELECT public.pull_secret_card($1, null, $2)", [IDS.alice, IDS.event]),
        b.query("SELECT public.pull_secret_card($1, null, $2)", [IDS.alice, IDS.event]),
      ]);
      // The loser of the race gets a card, not an error — and the same card.
      const cards = results.map((r) => r.rows[0].pull_secret_card.cardId);
      expect(cards[0]).toBe(cards[1]);
      expect(await ledger()).toHaveLength(1);
    } finally {
      await Promise.all([a.end(), b.end()]);
    }
  });

  it("hands out a duplicate once the whole set is owned, without a new ownership row", async () => {
    const id = await addCard("Gary the Grill");
    await pull();
    await sql("UPDATE public.secret_card_pulls SET pulled_on = pulled_on - 1");
    const dupe = await pull();
    expect(dupe).toMatchObject({ cardId: id, duplicate: true, fresh: true });
    // Two ledger rows, one of them a duplicate — and secret_card_pulls_owned_once
    // is what stops the second from counting as ownership.
    const rows = await ledger();
    expect(rows.map((r) => r.is_duplicate)).toEqual([false, true]);
    expect(await status()).toMatchObject({ pulled: 1 });
  });

  it("skips a deactivated card", async () => {
    await addCard("Retired", { active: false });
    const live = await addCard("Gary the Grill");
    expect((await pull())!.cardId).toBe(live);
  });

  it("skips a card whose art never uploaded, so a failed upload cannot burn a pull", async () => {
    await addCard("Half-made", { artPath: null });
    const live = await addCard("Gary the Grill");
    expect((await pull())!.cardId).toBe(live);
  });

  it("returns nothing and burns nothing when the catalogue is empty", async () => {
    expect(await pull()).toBeNull();
    expect(await ledger()).toHaveLength(0);
    // …and the member can still pull the moment a card lands.
    await addCard("Gary the Grill");
    expect((await pull())!.fresh).toBe(true);
  });

  it("refuses a participant who does not exist", async () => {
    await addCard("Gary the Grill");
    await expect(pull("00000000-0000-4000-8000-0000000000ee")).rejects.toThrow();
  });

  it("keeps the ledger when a pulled card is deleted", async () => {
    const id = await addCard("Gary the Grill");
    await pull();
    await expect(sql("DELETE FROM public.secret_cards WHERE id = $1", [id])).rejects.toThrow();
  });

  it("survives the event being deleted, because a collection outlives a combine", async () => {
    await addCard("Gary the Grill");
    await pull();
    await sql("DELETE FROM public.events WHERE id = $1", [IDS.event]);
    const rows = await sql<{ event_id: string | null }>(
      "SELECT event_id FROM public.secret_card_pulls",
    );
    expect(rows).toEqual([{ event_id: null }]);
  });

  it("refuses a call with neither a participant nor a guest", async () => {
    await addCard("Gary the Grill");
    await expect(sql("SELECT public.pull_secret_card(null, null, null)")).rejects.toThrow();
  });

  it("refuses a call claiming to be both at once", async () => {
    // The CHECK on the table says exactly one owner; the RPC refuses before it
    // gets there, so the failure names the problem instead of citing a constraint.
    await addCard("Gary the Grill");
    await expect(
      sql("SELECT public.pull_secret_card($1, $2, null)", [IDS.alice, GUEST_A]),
    ).rejects.toThrow();
  });
});

describe("pull_secret_card, as a guest", () => {
  // Everything the member rules guarantee has to hold for a guest too, keyed on
  // a server-minted guest id instead of a participant row.
  it("hands a guest a card without any participant behind it", async () => {
    const id = await addCard("Gary the Grill");
    const res = await pullAsGuest();
    expect(res).toMatchObject({ cardId: id, duplicate: false, fresh: true });
    const rows = await sql<{ participant_id: string | null; guest_id: string }>(
      "SELECT participant_id, guest_id FROM public.secret_card_pulls",
    );
    expect(rows).toEqual([{ participant_id: null, guest_id: GUEST_A }]);
  });

  it("gives a guest the same card twice in a day, and only one row", async () => {
    await addCard("Gary the Grill");
    const first = await pullAsGuest();
    const second = await pullAsGuest();
    expect(second!.cardId).toBe(first!.cardId);
    expect(second!.fresh).toBe(false);
    expect(await ledger()).toHaveLength(1);
  });

  it("refuses a second guest pull inserted directly, so the rule is the schema's", async () => {
    const id = await addCard("Gary the Grill");
    await pullAsGuest();
    await expect(
      sql(
        `INSERT INTO public.secret_card_pulls (guest_id, secret_card_id, pulled_on)
         VALUES ($1, $2, current_date)`,
        [GUEST_A, id],
      ),
    ).rejects.toThrow();
  });

  it("keeps two guests apart on the same day", async () => {
    await addCard("Gary the Grill");
    await pullAsGuest(GUEST_A);
    await pullAsGuest(GUEST_B);
    expect(await ledger()).toHaveLength(2);
  });

  it("keeps a guest and a member apart on the same day", async () => {
    await addCard("Gary the Grill");
    await pull(IDS.alice);
    await pullAsGuest(GUEST_A);
    expect(await ledger()).toHaveLength(2);
  });

  it("leaves exactly one row when two connections race for one guest", async () => {
    // A guest has no participant row to lock, so this is carried by an advisory
    // lock instead. Without it the unique index is all that is left and the loser
    // of the race gets an error rather than a card.
    await addCard("Gary the Grill");
    await addCard("The Gazebo");
    const [a, b] = [await newClient(), await newClient()];
    try {
      const results = await Promise.all([
        a.query("SELECT public.pull_secret_card(null, $1, $2)", [GUEST_A, IDS.event]),
        b.query("SELECT public.pull_secret_card(null, $1, $2)", [GUEST_A, IDS.event]),
      ]);
      const cards = results.map((r) => r.rows[0].pull_secret_card.cardId);
      expect(cards[0]).toBe(cards[1]);
      expect(await ledger()).toHaveLength(1);
    } finally {
      await Promise.all([a.end(), b.end()]);
    }
  });

  it("never deals a guest the same card twice while they still have one to find", async () => {
    const a = await addCard("Gary the Grill");
    const b = await addCard("The Gazebo");
    const first = await pullAsGuest();
    await sql("UPDATE public.secret_card_pulls SET pulled_on = pulled_on - 1");
    const second = await pullAsGuest();
    expect(second!.duplicate).toBe(false);
    expect([first!.cardId, second!.cardId].sort()).toEqual([a, b].sort());
  });

  it("hands a guest a duplicate once they own the whole set", async () => {
    await addCard("Gary the Grill");
    await pullAsGuest();
    await sql("UPDATE public.secret_card_pulls SET pulled_on = pulled_on - 1");
    expect((await pullAsGuest())!.duplicate).toBe(true);
    expect(await status(null, GUEST_A)).toMatchObject({ pulled: 1 });
  });

  it("reports a guest's own status, and nobody else's", async () => {
    await addCard("Gary the Grill");
    await pullAsGuest(GUEST_A);
    expect(await status(null, GUEST_A)).toMatchObject({ pulledToday: true, pulled: 1 });
    expect(await status(null, GUEST_B)).toMatchObject({ pulledToday: false, pulled: 0 });
    expect(await status(IDS.alice)).toMatchObject({ pulledToday: false, pulled: 0 });
  });
});

describe("claim_guest_secrets", () => {
  it("carries a guest's cards onto the player they claim", async () => {
    const id = await addCard("Gary the Grill");
    await pullAsGuest(GUEST_A);
    expect(await sql("SELECT public.claim_guest_secrets($1, $2)", [IDS.alice, GUEST_A])).toEqual([
      { claim_guest_secrets: 1 },
    ]);
    const rows = await sql<{ participant_id: string | null; guest_id: string | null }>(
      "SELECT participant_id, guest_id FROM public.secret_card_pulls",
    );
    expect(rows).toEqual([{ participant_id: IDS.alice, guest_id: null }]);
    expect(await status(IDS.alice)).toMatchObject({ pulled: 1 });
    expect(id).toBeTruthy();
  });

  it("keeps the member's own row when both spent the same day", async () => {
    // Their own pull is the one attached to the name the cards live on.
    await addCard("Gary the Grill");
    await pull(IDS.alice);
    await pullAsGuest(GUEST_A);
    await sql("SELECT public.claim_guest_secrets($1, $2)", [IDS.alice, GUEST_A]);
    const rows = await ledger();
    expect(rows).toHaveLength(1);
    expect(await status(IDS.alice)).toMatchObject({ pulled: 1 });
  });

  it("arrives as a duplicate when the member already owns the card", async () => {
    await addCard("Gary the Grill");
    await pull(IDS.alice);
    await pullAsGuest(GUEST_A);
    // Move the guest's row off the member's day so only the ownership rule bites.
    await sql("UPDATE public.secret_card_pulls SET pulled_on = pulled_on - 1 WHERE guest_id = $1", [
      GUEST_A,
    ]);
    await sql("SELECT public.claim_guest_secrets($1, $2)", [IDS.alice, GUEST_A]);
    const rows = await ledger();
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => !r.is_duplicate)).toHaveLength(1);
    expect(await status(IDS.alice)).toMatchObject({ pulled: 1 });
  });

  it("does nothing, and does not raise, for a participant who no longer exists", async () => {
    await addCard("Gary the Grill");
    await pullAsGuest(GUEST_A);
    expect(
      await sql("SELECT public.claim_guest_secrets($1, $2)", [
        "00000000-0000-4000-8000-0000000000ee",
        GUEST_A,
      ]),
    ).toEqual([{ claim_guest_secrets: 0 }]);
  });

  it("does nothing for a guest with no cards", async () => {
    expect(await sql("SELECT public.claim_guest_secrets($1, $2)", [IDS.alice, GUEST_B])).toEqual([
      { claim_guest_secrets: 0 },
    ]);
  });
});

describe("secret_pull_status", () => {
  it("reports nothing to pull against an empty catalogue", async () => {
    expect(await status()).toMatchObject({ pulledToday: false, pulled: 0, available: false });
  });

  it("never reveals how many cards exist", async () => {
    await addCard("Gary the Grill");
    await addCard("The Gazebo");
    await addCard("The Dog");
    const s = await status();
    expect(s.available).toBe(true);
    // `pulled` is how many this member owns. There is deliberately no
    // denominator anywhere in the payload.
    expect(s.pulled).toBe(0);
    expect(Object.keys(s).sort()).toEqual([
      "available",
      "day",
      "pulled",
      "pulledToday",
      "resetsAt",
    ]);
  });

  it("flips pulledToday without spending anything itself", async () => {
    await addCard("Gary the Grill");
    expect((await status()).pulledToday).toBe(false);
    await status();
    expect(await ledger()).toHaveLength(0);
    await pull();
    expect(await status()).toMatchObject({ pulledToday: true, pulled: 1 });
  });

  it("counts the league day, not the caller's session timezone", async () => {
    // Both RPCs pin `SET timezone`, so a client on the other side of the
    // dateline still shares one day boundary with the garden.
    const rows = await sql<{ proname: string; tz: string }>(`
      SELECT p.proname, cfg AS tz
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN LATERAL unnest(p.proconfig) AS cfg
       WHERE n.nspname = 'public'
         AND p.proname IN ('pull_secret_card', 'secret_pull_status')
         AND cfg LIKE 'TimeZone=%'
       ORDER BY p.proname
    `);
    expect(rows).toEqual([
      { proname: "pull_secret_card", tz: "TimeZone=America/New_York" },
      { proname: "secret_pull_status", tz: "TimeZone=America/New_York" },
    ]);
  });
});

describe("claim_guest_secrets and a guest's granted rows", () => {
  it("keeps a guest's granted secret on a day the member also pulled", async () => {
    // A streak milestone pays out as a granted row on the day it is claimed, and
    // a daily player has an ordinary pull that day too. The collision rule is
    // about daily slots; it used to take the reward with it.
    const daily = await addCard("Gary the Grill");
    const reward = await addCard("Tucker");
    // Out of the pool, so both daily pulls land on Gary and the reward row below
    // cannot collide with a Tucker the guest happened to draw.
    await sql("UPDATE public.secret_cards SET weight = 0 WHERE id = $1", [reward]);
    await pull(IDS.alice);
    await pullAsGuest(GUEST_A);
    await sql(
      `INSERT INTO public.secret_card_pulls (guest_id, secret_card_id, pulled_on, granted, tier)
       VALUES ($1, $2, current_date, true, 'rare')`,
      [GUEST_A, reward],
    );
    await sql("SELECT public.claim_guest_secrets($1, $2)", [IDS.alice, GUEST_A]);
    const rows = await sql<{ secret_card_id: string; granted: boolean; guest_id: string | null }>(
      "SELECT secret_card_id, granted, guest_id FROM public.secret_card_pulls ORDER BY granted",
    );
    // The guest's daily pull lost to the member's, as before; the reward came across.
    expect(rows).toEqual([
      { secret_card_id: daily, granted: false, guest_id: null },
      { secret_card_id: reward, granted: true, guest_id: null },
    ]);
    expect(await status(IDS.alice)).toMatchObject({ pulled: 2 });
  });
});
