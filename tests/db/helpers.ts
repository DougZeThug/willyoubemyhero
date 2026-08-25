// Talking to the test cluster as each of the Supabase roles.
import { Client } from "pg";
import { inject } from "vitest";

export type Role = "anon" | "authenticated" | "service_role";

let client: Client | undefined;

export async function db(): Promise<Client> {
  if (!client) {
    client = new Client({ connectionString: inject("databaseUrl") });
    await client.connect();
  }
  return client;
}

export async function closeDb() {
  await client?.end();
  client = undefined;
}

/**
 * A second connection, for the caller to own and end.
 *
 * `db()` caches one client and `asRole` wraps every call in a transaction, so a
 * test that needs two statements genuinely in flight at once — proving a row lock
 * serialises them, say — cannot get there through the shared client.
 */
export async function newClient(): Promise<Client> {
  const c = new Client({ connectionString: inject("databaseUrl") });
  await c.connect();
  return c;
}

/**
 * Run a statement as one of the PostgREST roles.
 *
 * `SET LOCAL ROLE` inside a transaction is what makes RLS apply: the connection
 * owns every table, and an owner is exempt from its own policies. Wrapping each
 * call also means a failed statement cannot leave the session in a broken role.
 */
export async function asRole<T = Record<string, unknown>>(
  role: Role,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const c = await db();
  await c.query("BEGIN");
  try {
    await c.query(`SET LOCAL ROLE ${role}`);
    const res = await c.query(sql, params);
    await c.query("COMMIT");
    return res.rows as T[];
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  }
}

/** True when the statement is refused for that role, whatever the reason. */
export async function isDenied(role: Role, sql: string, params: unknown[] = []): Promise<boolean> {
  try {
    await asRole(role, sql, params);
    return false;
  } catch {
    return true;
  }
}

/**
 * Rows visible to a role. A table protected by a policy and a table protected
 * by a missing grant fail differently — one returns nothing, the other errors —
 * and from the client's point of view both mean "you cannot read this".
 */
export async function visibleRows(role: Role, table: string): Promise<number | null> {
  try {
    const rows = await asRole<{ count: string }>(role, `SELECT count(*)::text FROM ${table}`);
    return Number(rows[0].count);
  } catch {
    return null;
  }
}

/** Anything the owner needs to do, with RLS and grants out of the way. */
export async function sql<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const c = await db();
  return (await c.query(text, params)).rows as T[];
}

export const IDS = {
  event: "00000000-0000-4000-8000-0000000000ff",
  alice: "00000000-0000-4000-8000-0000000000a1",
  bob: "00000000-0000-4000-8000-0000000000b1",
  carol: "00000000-0000-4000-8000-0000000000c1",
  outsider: "00000000-0000-4000-8000-0000000000d1",
};

/**
 * A minimal event with three rostered players and one who is not on the roster.
 * Truncates first, so each suite starts from the same state.
 */
export async function seedEvent() {
  // secret_card_pulls before secret_cards, and secret_cards listed explicitly:
  // CASCADE from participants reaches the pulls, but nothing FKs into the
  // catalogue, so with fileParallelism disabled its rows would otherwise
  // accumulate across suites.
  await sql(`
    TRUNCATE
      public.award_votes, public.awards, public.card_comments, public.card_reactions,
      public.member_codes, public.draft_selections, public.penalties, public.splits,
      public.runs, public.stations, public.secret_card_pulls, public.secret_cards,
      public.card_copies, public.card_mints, public.card_pulls, public.pack_opens,
      public.streak_milestone_claims, public.collection_trophies,
      public.dust_ledger,
      public.account_identities,
      public.trades, public.trade_offer_items, public.trade_offers,
      public.event_participants, public.event_secrets,
      public.participants, public.events
    RESTART IDENTITY CASCADE
  `);

  await sql(
    `INSERT INTO public.events (id, name, year, active)
     VALUES ($1, 'Draft Combine', 2026, true)`,
    [IDS.event],
  );
  await sql(
    `INSERT INTO public.participants (id, name, active) VALUES
       ($1, 'Alice', true), ($2, 'Bob', true), ($3, 'Carol', true), ($4, 'Outsider', true)`,
    [IDS.alice, IDS.bob, IDS.carol, IDS.outsider],
  );
  // Outsider is deliberately left off the roster.
  await sql(
    `INSERT INTO public.event_participants (event_id, participant_id, running_order) VALUES
       ($1, $2, 1), ($1, $3, 2), ($1, $4, 3)`,
    [IDS.event, IDS.alice, IDS.bob, IDS.carol],
  );
}
