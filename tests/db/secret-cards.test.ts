// The secret-card catalogue and the guest merge, against real Postgres.
//
// The pull itself moved into open_pack (tests/db/open-pack.test.ts) when a
// secret became an ordinary slot in the pack. What stays here is the catalogue's
// own rules, the guarantee that `anon` cannot execute any function this feature
// wrote — the publishable key ships to every browser — and claim_guest_secrets,
// which grafts a guest's pulls onto the player they claim.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, isDenied, IDS, seedEvent, sql } from "./helpers";

afterAll(closeDb);
beforeEach(seedEvent);

/** One secret slot out of a dealt pack, in the shape the old daily pull had. */
type Pull = {
  pullId: string;
  cardId: string;
  day: string;
  duplicate: boolean;
  fresh: boolean;
} | null;

type Pack = {
  day: string;
  fresh: boolean;
  cards: { kind: string; id: string; pullId?: string; duplicate?: boolean }[];
} | null;

/**
 * Open a pack with no event behind it, so the pool is the secrets alone, and
 * hand back its first secret slot. With a one-card catalogue that is the one
 * card, which is what every test below seeds.
 */
function firstSecret(pack: Pack): Pull {
  const slot = pack?.cards.find((c) => c.kind === "secret");
  if (!pack || !slot) return null;
  return { pullId: slot.pullId!, cardId: slot.id, day: pack.day, duplicate: !!slot.duplicate, fresh: pack.fresh }; // prettier-ignore
}

async function addCard(name: string, over: { active?: boolean; artPath?: string | null } = {}) {
  const [row] = await sql<{ id: string }>(
    `INSERT INTO public.secret_cards (name, art_path, active)
     VALUES ($1, $2, $3) RETURNING id`,
    [name, over.artPath === undefined ? `secrets/${name}/art-1.webp` : over.artPath, over.active ?? true], // prettier-ignore
  );
  return row.id;
}

async function pull(participantId = IDS.alice): Promise<Pull> {
  const [row] = await sql<{ open_pack: Pack }>("SELECT public.open_pack($1, $2, $3)", [
    participantId,
    null,
    null,
  ]);
  return firstSecret(row.open_pack);
}

/** The same pull, as a guest. Guests carry a server-minted id, not a participant. */
async function pullAsGuest(guestId = GUEST_A): Promise<Pull> {
  const [row] = await sql<{ open_pack: Pack }>("SELECT public.open_pack($1, $2, $3)", [
    null,
    guestId,
    null,
  ]);
  return firstSecret(row.open_pack);
}

const GUEST_A = "00000000-0000-4000-8000-0000000000e1";
const GUEST_B = "00000000-0000-4000-8000-0000000000e2";

async function status(participantId: string | null = IDS.alice, guestId: string | null = null) {
  const [row] = await sql<{
    pack_status: { day: string; openedToday: boolean; secretsOwned: number; resetsAt: string };
  }>("SELECT public.pack_status($1, $2)", [participantId, guestId]);
  return row.pack_status;
}

const ledger = () =>
  sql<{ secret_card_id: string; pulled_on: string; is_duplicate: boolean }>(
    "SELECT secret_card_id, pulled_on, is_duplicate FROM public.secret_card_pulls ORDER BY pulled_on",
  );

describe("the RPCs are unreachable with the publishable key", () => {
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
    expect(await status(IDS.alice)).toMatchObject({ secretsOwned: 1 });
    expect(id).toBeTruthy();
  });

  it("keeps the member's own row when both spent the same day", async () => {
    // Their own pull is the one attached to the name the cards live on. Both
    // packs are dealt from a one-card catalogue, so both hold exactly Gary.
    await addCard("Gary the Grill");
    await pull(IDS.alice);
    await pullAsGuest(GUEST_A);
    await sql("SELECT public.claim_guest_secrets($1, $2)", [IDS.alice, GUEST_A]);
    const rows = await ledger();
    expect(rows).toHaveLength(1);
    expect(await status(IDS.alice)).toMatchObject({ secretsOwned: 1 });
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
    expect(await status(IDS.alice)).toMatchObject({ secretsOwned: 1 });
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
    expect(await status(IDS.alice)).toMatchObject({ secretsOwned: 2 });
  });
});

describe("claim_guest_secrets promotes a preserved reward", () => {
  it("leaves the member owning a card the guest now holds only as a reward", async () => {
    // The guest pulled X as their daily, then a milestone dealt them a second X
    // the same day — a granted duplicate. The member pulled Y that day. The
    // daily X loses the day, the reward stays; it has to become the owning row
    // or every count says the member does not hold X.
    const x = await addCard("Gary the Grill");
    const y = await addCard("Tucker");
    await sql("UPDATE public.secret_cards SET weight = 0 WHERE id = $1", [y]);
    await pullAsGuest(GUEST_A); // X, as their daily
    await sql(
      `INSERT INTO public.secret_card_pulls
         (guest_id, secret_card_id, pulled_on, is_duplicate, granted, tier)
       VALUES ($1, $2, current_date, true, true, 'rare')`,
      [GUEST_A, x],
    );
    // The member's daily lands on Y: X is out of the pool for a beat.
    await sql("UPDATE public.secret_cards SET weight = 0 WHERE id = $1", [x]);
    await sql("UPDATE public.secret_cards SET weight = 100 WHERE id = $1", [y]);
    await pull(IDS.alice);

    await sql("SELECT public.claim_guest_secrets($1, $2)", [IDS.alice, GUEST_A]);
    const rows = await sql<{ secret_card_id: string; is_duplicate: boolean; granted: boolean }>(
      `SELECT secret_card_id, is_duplicate, granted FROM public.secret_card_pulls
        WHERE participant_id = $1 ORDER BY granted`,
      [IDS.alice],
    );
    expect(rows).toEqual([
      { secret_card_id: y, is_duplicate: false, granted: false },
      { secret_card_id: x, is_duplicate: false, granted: true },
    ]);
    expect(await status(IDS.alice)).toMatchObject({ secretsOwned: 2 });
  });
});
