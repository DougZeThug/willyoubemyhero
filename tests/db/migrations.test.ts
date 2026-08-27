// The cluster this suite runs against was built by applying every migration in
// order from an empty database, so reaching these assertions at all proves the
// migrations still apply cleanly. What is checked here is the shape they leave
// behind — the tables, RPCs and constraints the app depends on.
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, sql } from "./helpers";
import { migrationFiles } from "./cluster";

afterAll(closeDb);

const EXPECTED_TABLES = [
  "account_identities",
  "admin_accounts",
  "admin_grants",
  "audit_logs",
  "auth_attempts",
  "award_votes",
  "awards",
  "card_comments",
  "card_copies",
  "card_mints",
  "card_prompt_runs",
  "card_prompt_templates",
  "card_pulls",
  "card_reactions",
  "collection_trophies",
  "draft_selections",
  "dust_ledger",
  "event_archive_snapshots",
  "event_participants",
  "event_secrets",
  "events",
  "market_listings",
  "member_codes",
  "pack_opens",
  "participants",
  "penalties",
  "running_order_randomizations",
  "runs",
  "secret_card_pulls",
  "secret_cards",
  "secret_collections",
  "splits",
  "stations",
  "streak_milestone_claims",
  "trade_offer_items",
  "trade_offers",
  "trades",
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

  it("creates the trading RPCs the app calls", async () => {
    const rows = await sql<{ proname: string }>(`
      SELECT proname FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND proname IN ('accept_trade_offer', 'create_trade_offer', 'trade_item_is_spare',
                        'trade_leaves_a_copy', 'trade_has_both_sides',
                        'resync_card_pull', 'resync_secret_ownership')
      ORDER BY proname
    `);
    expect(rows.map((r) => r.proname)).toEqual([
      "accept_trade_offer",
      "create_trade_offer",
      "resync_card_pull",
      "resync_secret_ownership",
      "trade_has_both_sides",
      "trade_item_is_spare",
      "trade_leaves_a_copy",
    ]);
  });

  it("creates the marketplace RPCs the app calls", async () => {
    const rows = await sql<{ proname: string }>(`
      SELECT proname FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND proname IN ('list_card_for_dust', 'cancel_market_listing', 'buy_market_listing')
      ORDER BY proname
    `);
    expect(rows.map((r) => r.proname)).toEqual([
      "buy_market_listing",
      "cancel_market_listing",
      "list_card_for_dust",
    ]);
  });

  it("keeps one copy off the shelf twice", async () => {
    // The listing is what a sale re-validates against, so two active listings of
    // one copy would let the same card be sold twice — the second sale finding a
    // copy that is no longer the seller's and voiding, but only after somebody
    // tapped Buy on it. Partial and status-scoped, so a sold listing does not
    // stop the buyer re-listing the copy they now own.
    const rows = await sql<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE tablename = 'market_listings'",
    );
    const defs = rows.map((r) => r.indexdef);
    expect(
      defs.some((d) => d.includes("(card_copy_id)") && d.includes("status = 'active'::text")),
    ).toBe(true);
    expect(
      defs.some((d) => d.includes("(secret_pull_id)") && d.includes("status = 'active'::text")),
    ).toBe(true);
  });

  it("enforces one pulled copy per person per card per league day", async () => {
    // The rule that stops a replayed pack minting copies. An index rather than a
    // timestamp comparison, the same shape secret_card_pulls has always used.
    const rows = await sql<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE tablename = 'card_copies'",
    );
    expect(
      rows.some(
        (r) =>
          r.indexdef.includes("UNIQUE") &&
          r.indexdef.includes("participant_id") &&
          r.indexdef.includes("event_participant_id") &&
          r.indexdef.includes("acquired_on"),
      ),
    ).toBe(true);
  });

  it("creates the two RPCs the pack calls when it is torn", async () => {
    const rows = await sql<{ proname: string }>(`
      SELECT proname FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND proname IN ('record_card_pulls', 'record_pack_open')
      ORDER BY proname
    `);
    expect(rows.map((r) => r.proname)).toEqual(["record_card_pulls", "record_pack_open"]);
  });

  it("leaves exactly one record_card_pulls, with the editions argument", async () => {
    // CREATE OR REPLACE cannot change an argument list, so 20260813120000 has to
    // DROP the two-arg version first. Forget that and Postgres keeps both as
    // overloads — the old one still carrying its own grants, and a two-arg call
    // now ambiguous. The list above would catch the duplicate; this says which
    // signature is supposed to survive, and why there is only one.
    const rows = await sql<{ args: string }>(`
      SELECT pg_get_function_identity_arguments(p.oid) AS args
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND proname = 'record_card_pulls'
    `);
    expect(rows.map((r) => r.args)).toEqual([
      "_participant_id uuid, _event_participant_ids uuid[], _editions text[]",
    ]);
  });

  it("leaves exactly one pull_bonus_secret_card, with the floor argument", async () => {
    // The same trap record_card_pulls fell into, one migration later:
    // 20260824190000 adds a rarity floor to the argument list, so it has to DROP
    // the three-arg version first. Forget that and the new parameter's DEFAULT
    // makes every three-argument call ambiguous — including the one inside
    // claim_streak_milestone, which is a milestone nobody can cash.
    const rows = await sql<{ args: string }>(`
      SELECT pg_get_function_identity_arguments(p.oid) AS args
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND proname = 'pull_bonus_secret_card'
    `);
    expect(rows.map((r) => r.args)).toEqual([
      "_participant_id uuid, _guest_id uuid, _event_id uuid, _floor_tier text",
    ]);
  });

  it("keeps the search_path hardening a replay would otherwise drop", async () => {
    // 20260825165117 hardens roll_card_edition and mill_value, and sorts BEFORE
    // the two migrations that create them. A bare ALTER there raises on a replay
    // from empty, which took out the cluster build and with it every test in
    // tests/db — so that file now skips a signature it cannot find.
    //
    // Skipping alone would trade the loud failure for a silent one: neither
    // function is created with a search_path of its own, so a replayed database
    // would quietly differ from the live one. 20260829130000 re-asserts both
    // after the CREATEs, and this is what proves it — the guard cannot be left
    // in place with nothing behind it.
    const rows = await sql<{ sig: string; config: string[] | null }>(`
      SELECT p.oid::regprocedure::text AS sig, p.proconfig AS config
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('roll_card_edition', 'mill_value')
       ORDER BY sig
    `);
    expect(rows.map((r) => r.sig)).toEqual([
      "mill_value(text)",
      "roll_card_edition(uuid,uuid,date)",
    ]);
    for (const row of rows) {
      // `?? []` so a function with NO settings at all fails as "expected [] to
      // contain", which is the actual complaint, rather than as a type error
      // about null — proconfig is NULL rather than empty when nothing is set.
      expect(row.config ?? [], row.sig).toContain("search_path=public");
    }
  });

  it("gives every card_pulls row a finish, defaulting to standard", async () => {
    // NOT NULL with a default is what backfills rows written before editions
    // existed, rather than leaving a null the TS fallback would have to cover.
    const [row] = await sql<{ is_nullable: string; column_default: string | null }>(`
      SELECT is_nullable, column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'card_pulls' AND column_name = 'edition'
    `);
    expect(row.is_nullable).toBe("NO");
    expect(row.column_default).toContain("standard");
  });

  it("gives the crowd screens a timestamp for who is on the clock", async () => {
    // Between "on the clock" and "finished" the database held no timestamp at
    // all — the runs row is only written when the run ends — so /live counted
    // up from whenever the browser noticed rather than from anything real.
    const [row] = await sql<{ data_type: string; is_nullable: string }>(`
      SELECT data_type, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'event_participants'
         AND column_name = 'on_clock_since'
    `);
    expect(row.data_type).toBe("timestamp with time zone");
    // Nullable is the point: null means nobody is on the clock.
    expect(row.is_nullable).toBe("YES");
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

  it("indexes prompt history by event and newest first", async () => {
    const rows = await sql<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE tablename = 'card_prompt_runs'",
    );
    expect(
      rows.some(
        (row) => row.indexdef.includes("event_id") && row.indexdef.includes("created_at DESC"),
      ),
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
    // A completed trade is the app's only live signal that anything traded at
    // all: both parties' vaults refetch off this insert, and the feed updates on
    // everyone else's phone. Unpublished, the feature works but never moves until
    // somebody reloads.
    expect(published).toContain("trades");
    // The only channel that reaches somebody an admin just granted their last
    // card to: grant_secret_card runs on the commissioner's phone, and
    // grantSecretCard can invalidate nothing but the commissioner's own query
    // key. Unpublished, the trophy is real but silent until a reload.
    expect(published).toContain("collection_trophies");
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
    // Different rationale, same failure mode: publishing card_pulls broadcasts
    // every pull with the puller's id attached to every connected phone.
    expect(published).not.toContain("card_pulls");
    expect(published).not.toContain("pack_opens");
    expect(published).not.toContain("card_prompt_templates");
    expect(published).not.toContain("card_prompt_runs");
    // Same rationale again, and the reason `trades` above is a separate table
    // rather than a status on the offer: an offer names cards its two parties
    // hold, so publishing either of these broadcasts private collection data —
    // and a pending offer — to every phone in the garden.
    expect(published).not.toContain("trade_offers");
    expect(published).not.toContain("trade_offer_items");
    // Everything the card_pulls line above says, per copy and with the finish on
    // each — strictly the worse leak of the two.
    expect(published).not.toContain("card_copies");
    // A dust balance is a proxy for how deep somebody's collection is, and every
    // row's ref points at a secret_card_pulls or card_copies id — so publishing
    // this leaks the secret ledger sideways AND gives every phone a live feed of
    // who is about to buy a pull.
    expect(published).not.toContain("dust_ledger");
    // Everything the card_pulls line says, with a date attached: this is a feed
    // of who packed whom and when.
    expect(published).not.toContain("card_mints");
    // A listing names a card somebody holds and what they will part with it for,
    // which is trade_offers' leak with a price on it. The seller hears about a
    // sale through the payload-free broadcast instead, which publishes nothing.
    expect(published).not.toContain("market_listings");
  });

  it("enforces one pack_opens row per person per league day, which is what makes a row count a pack count", async () => {
    const rows = await sql<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE tablename = 'pack_opens'",
    );
    expect(
      rows.some(
        (r) =>
          r.indexdef.includes("UNIQUE") &&
          r.indexdef.includes("participant_id") &&
          r.indexdef.includes("opened_on"),
      ),
    ).toBe(true);
  });

  it("enforces one card_pulls row per person per card, which is what makes a row count a people count", async () => {
    const rows = await sql<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE tablename = 'card_pulls'",
    );
    expect(
      rows.some(
        (r) =>
          r.indexdef.includes("UNIQUE") &&
          r.indexdef.includes("participant_id") &&
          r.indexdef.includes("event_participant_id"),
      ),
    ).toBe(true);
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
