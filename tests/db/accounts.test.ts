// Accounts, against real Postgres.
//
// Two things live here. `account_identities` is a private table — the publishable
// key ships to every browser, so `anon` reaching it would expose which account
// owns which collection. And `merge_guest_pulls` is what stops a second device's
// pulls being stranded when somebody signs in: it has to collapse duplicates,
// keep the better tier, and never hand anybody a second daily pull.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, isDenied, IDS, seedEvent, sql } from "./helpers";

afterAll(closeDb);
beforeEach(seedEvent);

const GUEST_A = "00000000-0000-4000-8000-00000000ac01";
const GUEST_B = "00000000-0000-4000-8000-00000000ac02";

async function addCard(name: string) {
  const [row] = await sql<{ id: string }>(
    `INSERT INTO public.secret_cards (name, art_path, active)
     VALUES ($1, $2, true) RETURNING id`,
    [name, `secrets/${name}/art-1.webp`],
  );
  return row.id;
}

async function givePull(
  guestId: string,
  cardId: string,
  over: { day?: string; duplicate?: boolean; granted?: boolean; tier?: string } = {},
) {
  const [row] = await sql<{ id: string }>(
    `INSERT INTO public.secret_card_pulls
       (guest_id, secret_card_id, pulled_on, is_duplicate, granted, tier)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      guestId,
      cardId,
      over.day ?? "2026-01-01",
      over.duplicate ?? false,
      over.granted ?? true,
      over.tier ?? "common",
    ],
  );
  return row.id;
}

async function merge(into = GUEST_A, from = GUEST_B) {
  const [row] = await sql<{ merge_guest_pulls: number }>(
    "SELECT public.merge_guest_pulls($1, $2)",
    [into, from],
  );
  return row.merge_guest_pulls;
}

async function mergePacks(into = GUEST_A, from = GUEST_B) {
  const [row] = await sql<{ merge_guest_packs: number }>(
    "SELECT public.merge_guest_packs($1, $2)",
    [into, from],
  );
  return row.merge_guest_packs;
}

async function pullsFor(guestId: string) {
  return sql<{ secret_card_id: string; is_duplicate: boolean; tier: string }>(
    "SELECT secret_card_id, is_duplicate, tier FROM public.secret_card_pulls WHERE guest_id = $1",
    [guestId],
  );
}

describe("merge_guest_pulls", () => {
  it("moves the other identity's cards across", async () => {
    const card = await addCard("merge-move");
    await givePull(GUEST_B, card);

    expect(await merge()).toBe(1);
    expect(await pullsFor(GUEST_B)).toHaveLength(0);
    expect(await pullsFor(GUEST_A)).toHaveLength(1);
  });

  it("files an already-owned card as a duplicate, not a second ownership row", async () => {
    const card = await addCard("merge-dupe");
    await givePull(GUEST_A, card);
    await givePull(GUEST_B, card, { day: "2026-01-02" });

    await merge();
    const owned = (await pullsFor(GUEST_A)).filter((p) => !p.is_duplicate);
    expect(owned).toHaveLength(1);
    expect(await pullsFor(GUEST_A)).toHaveLength(2);
  });

  it("carries the better tier over before demoting the losing copy", async () => {
    const card = await addCard("merge-tier");
    await givePull(GUEST_A, card, { tier: "common" });
    await givePull(GUEST_B, card, { day: "2026-01-02", tier: "mythic" });

    await merge();
    const owned = (await pullsFor(GUEST_A)).find((p) => !p.is_duplicate);
    expect(owned?.tier).toBe("mythic");
  });

  it("drops an incoming pull that would collide with today's unspent one", async () => {
    // secret_card_pulls_one_per_day is UNIQUE (guest_id, pulled_on) WHERE NOT
    // granted: two unspent rows on the same day cannot coexist, and the merge has
    // to lose one rather than abort the whole sign-in.
    const a = await addCard("merge-today-a");
    const b = await addCard("merge-today-b");
    await givePull(GUEST_A, a, { day: "2026-02-01", granted: false });
    await givePull(GUEST_B, b, { day: "2026-02-01", granted: false });

    await merge();
    expect(await pullsFor(GUEST_B)).toHaveLength(0);
    expect(await pullsFor(GUEST_A)).toHaveLength(1);
  });

  it("is a no-op on itself", async () => {
    const card = await addCard("merge-self");
    await givePull(GUEST_A, card);
    expect(await merge(GUEST_A, GUEST_A)).toBe(0);
    expect(await pullsFor(GUEST_A)).toHaveLength(1);
  });

  it("is not executable by anon or authenticated", async () => {
    expect(await isDenied("anon", "SELECT public.merge_guest_pulls($1, $2)", [GUEST_A, GUEST_B])).toBe(true); // prettier-ignore
    expect(await isDenied("authenticated", "SELECT public.merge_guest_pulls($1, $2)", [GUEST_A, GUEST_B])).toBe(true); // prettier-ignore
  });
});

describe("merge_guest_packs", () => {
  it("moves pack history and drops a same-day collision", async () => {
    await sql(
      `INSERT INTO public.pack_opens (guest_id, opened_on, card_count)
       VALUES ($1, '2026-01-01', 3), ($2, '2026-01-01', 3), ($2, '2026-01-02', 3)`,
      [GUEST_A, GUEST_B],
    );

    expect(await mergePacks()).toBe(1);
    const rows = await sql<{ guest_id: string; opened_on: string }>(
      "SELECT guest_id, opened_on FROM public.pack_opens ORDER BY opened_on",
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.guest_id === GUEST_A)).toBe(true);
  });

  it("is not executable by anon or authenticated", async () => {
    expect(await isDenied("anon", "SELECT public.merge_guest_packs($1, $2)", [GUEST_A, GUEST_B])).toBe(true); // prettier-ignore
    expect(await isDenied("authenticated", "SELECT public.merge_guest_packs($1, $2)", [GUEST_A, GUEST_B])).toBe(true); // prettier-ignore
  });
});

describe("account_identities", () => {
  it("is unreadable and unwritable by anon and authenticated", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      expect(await isDenied(role, "SELECT * FROM public.account_identities")).toBe(true);
      expect(
        await isDenied(role, "INSERT INTO public.account_identities (user_id, guest_id) VALUES ($1, $2)", [IDS.event, GUEST_A]), // prettier-ignore
      ).toBe(true);
    }
  });

  it("refuses a row that is both a member and a guest, or neither", async () => {
    const both = sql(
      "INSERT INTO public.account_identities (user_id, participant_id, guest_id) VALUES ($1, $2, $3)",
      [GUEST_A, IDS.alice, GUEST_B],
    );
    await expect(both).rejects.toThrow();

    const neither = sql("INSERT INTO public.account_identities (user_id) VALUES ($1)", [GUEST_A]);
    await expect(neither).rejects.toThrow();
  });
});
