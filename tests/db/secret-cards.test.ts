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
  const [row] = await sql<{ pull_secret_card: Pull }>("SELECT public.pull_secret_card($1, $2)", [
    participantId,
    eventId,
  ]);
  return row.pull_secret_card;
}

async function status(participantId = IDS.alice) {
  const [row] = await sql<{
    secret_pull_status: {
      day: string;
      pulledToday: boolean;
      pulled: number;
      available: boolean;
      resetsAt: string;
    };
  }>("SELECT public.secret_pull_status($1)", [participantId]);
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
      expect(await isDenied(role, "SELECT public.pull_secret_card($1, null)", [IDS.alice])).toBe(
        true,
      );
    },
  );

  it.each(["anon", "authenticated"] as const)(
    "%s cannot execute secret_pull_status",
    async (role) => {
      expect(await isDenied(role, "SELECT public.secret_pull_status($1)", [IDS.alice])).toBe(true);
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
        a.query("SELECT public.pull_secret_card($1, $2)", [IDS.alice, IDS.event]),
        b.query("SELECT public.pull_secret_card($1, $2)", [IDS.alice, IDS.event]),
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
