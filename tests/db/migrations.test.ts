// The cluster this suite runs against was built by applying every migration in
// order from an empty database, so reaching these assertions at all proves the
// migrations still apply cleanly. What is checked here is the shape they leave
// behind — the tables, RPCs and constraints the app depends on.
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, sql } from "./helpers";
import { migrationFiles } from "./cluster";

afterAll(closeDb);

const EXPECTED_TABLES = [
  "audit_logs",
  "award_votes",
  "awards",
  "card_comments",
  "card_reactions",
  "draft_selections",
  "event_archive_snapshots",
  "event_participants",
  "event_secrets",
  "events",
  "member_codes",
  "participants",
  "penalties",
  "running_order_randomizations",
  "runs",
  "secret_card_pulls",
  "secret_cards",
  "splits",
  "stations",
];

describe("migrations", () => {
  it("applies every file from an empty database", async () => {
    // Cheap, but it is the only thing that catches a broken migration before it
    // syncs to Lovable and lands on the live project.
    expect((await migrationFiles()).length).toBeGreaterThan(0);
    expect(await sql("SELECT 1 AS ok")).toEqual([{ ok: 1 }]);
  });

  it("creates every table the app reads or writes", async () => {
    const rows = await sql<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    );
    expect(rows.map((r) => r.tablename)).toEqual(EXPECTED_TABLES);
  });

  it("enables row level security on every one of them", async () => {
    const rows = await sql<{ relname: string }>(`
      SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
    `);
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("creates the three award RPCs the app calls", async () => {
    const rows = await sql<{ proname: string }>(`
      SELECT proname FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND proname IN ('cast_award_vote', 'close_award_voting', 'reopen_award_voting')
      ORDER BY proname
    `);
    expect(rows.map((r) => r.proname)).toEqual([
      "cast_award_vote",
      "close_award_voting",
      "reopen_award_voting",
    ]);
  });

  it("creates the secret-card RPCs the app calls", async () => {
    const rows = await sql<{ proname: string }>(`
      SELECT proname FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND proname IN ('pull_secret_card', 'secret_pull_status')
      ORDER BY proname
    `);
    expect(rows.map((r) => r.proname)).toEqual(["pull_secret_card", "secret_pull_status"]);
  });

  it("exposes events through a public view", async () => {
    const rows = await sql<{ viewname: string }>(
      "SELECT viewname FROM pg_views WHERE schemaname = 'public'",
    );
    expect(rows.map((r) => r.viewname)).toContain("events_public");
  });

  it("keeps the PIN out of the public events view", async () => {
    // The whole reason event_secrets exists is that these columns used to live
    // on events, where a public read could reach them.
    const rows = await sql<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'events_public'`,
    );
    const columns = rows.map((r) => r.column_name);
    expect(columns).not.toContain("pin_hash");
    expect(columns).not.toContain("pin_salt");
    expect(columns.length).toBeGreaterThan(0);
  });

  it("enforces one vote per member per category in the schema, not just in code", async () => {
    const rows = await sql<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE tablename = 'award_votes'",
    );
    expect(
      rows.some(
        (r) =>
          r.indexdef.includes("UNIQUE") &&
          r.indexdef.includes("event_id") &&
          r.indexdef.includes("category") &&
          r.indexdef.includes("voter_participant_id"),
      ),
    ).toBe(true);
  });

  it("enforces one reaction per member per emoji per card", async () => {
    const rows = await sql<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE tablename = 'card_reactions'",
    );
    expect(rows.some((r) => r.indexdef.includes("UNIQUE") && r.indexdef.includes("emoji"))).toBe(
      true,
    );
  });

  it("keeps runs unique on client_key, which is what makes a retried save idempotent", async () => {
    const rows = await sql<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE tablename = 'runs'",
    );
    expect(
      rows.some((r) => r.indexdef.includes("UNIQUE") && r.indexdef.includes("client_key")),
    ).toBe(true);
  });

  it("publishes the live tables for realtime", async () => {
    // useEventBundle subscribes to these; a table missing here means cards stop
    // upgrading themselves mid-event.
    const rows = await sql<{ tablename: string }>(
      "SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime'",
    );
    const published = rows.map((r) => r.tablename);
    for (const table of ["runs", "splits", "penalties", "event_participants", "draft_selections"]) {
      expect(published).toContain(table);
    }
  });

  it("keeps the secret tables out of realtime", async () => {
    // Publishing either one broadcasts every pull to every connected phone,
    // which leaks the card ids, who owns what, and — from a row count against
    // the roster — the size of the set. The assertion above is one-directional,
    // so without this a "enable realtime" checkbox in the dashboard is all it
    // takes to undo the feature.
    const rows = await sql<{ tablename: string }>(
      "SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime'",
    );
    const published = rows.map((r) => r.tablename);
    expect(published).not.toContain("secret_cards");
    expect(published).not.toContain("secret_card_pulls");
  });

  it("enforces one secret pull per member per league day in the schema", async () => {
    const rows = await sql<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE tablename = 'secret_card_pulls'",
    );
    expect(
      rows.some(
        (r) =>
          r.indexdef.includes("UNIQUE") &&
          r.indexdef.includes("participant_id") &&
          r.indexdef.includes("pulled_on"),
      ),
    ).toBe(true);
  });
});
