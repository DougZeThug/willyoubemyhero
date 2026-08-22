// What the anon key can and cannot reach.
//
// The browser holds the publishable key, so `anon` is the role an attacker
// gets for free. Everything readable here is readable by anyone who opens
// devtools; everything denied here is denied by a grant or a policy, and this
// suite is what keeps that from quietly changing.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole, closeDb, isDenied, IDS, seedEvent, sql, visibleRows } from "./helpers";

beforeAll(seedEvent);
afterAll(closeDb);

/** A secret card seeded through the owner, so the leak assertions have something to leak. */
const SECRET_CARD_ID = "00000000-0000-4000-8000-00000000ce01";
const PROMPT_RUN_ID = "00000000-0000-4000-8000-00000000ce02";
const OFFER_ID = "00000000-0000-4000-8000-00000000ce03";
const TRADE_ID = "00000000-0000-4000-8000-00000000ce04";
const COPY_ID = "00000000-0000-4000-8000-00000000ce05";

/** Tables the vault, leaderboard, live view and recap all read without a session. */
const PUBLIC_READ = [
  "public.participants",
  "public.events_public",
  "public.event_participants",
  "public.stations",
  "public.runs",
  "public.splits",
  "public.penalties",
  "public.draft_selections",
  "public.awards",
  "public.card_reactions",
  "public.card_comments",
  "public.event_archive_snapshots",
  // Completed trades are an announcement — the feed is the point. Public-safe by
  // construction rather than by filtering: see the redaction test below.
  "public.trades",
  // Set NAMES only, granted by 20260822121000 so getSecretCollections can serve
  // them on the publishable key. The catalogue itself stays in SERVER_ONLY below,
  // which is the half that matters.
  "public.secret_collections",
];

/** Server-only tables. Each one leaks something specific if it becomes readable. */
const SERVER_ONLY = [
  // Salted PIN hashes for the commissioner console.
  "public.event_secrets",
  // Salted claim codes. Readable means anyone can claim any player.
  "public.member_codes",
  // The secret ballot, before the reveal.
  "public.award_votes",
  // Both of these shipped publicly readable and were locked down afterwards by
  // 20260724151735 ("Remove public read on internal-only tables"). Asserting it
  // here is what stops a future migration handing the grant back.
  "public.audit_logs",
  "public.running_order_randomizations",
  // The secret card catalogue. Readable means one person with devtools reads the
  // whole set without opening a pack, and the feature is over.
  "public.secret_cards",
  // Worse than the catalogue: it leaks the card ids, who owns what, and the size
  // of the set from a row count against the roster.
  "public.secret_card_pulls",
  // The aggregate ("7 people have this card") is public and served by a server
  // function. These rows are not: they say who has never packed whom.
  "public.card_pulls",
  // Strictly worse than card_pulls: the same private collection, one row per copy,
  // with the finish on each.
  "public.card_copies",
  // Unlike card_pulls there is no public aggregate over this at all — a pack
  // count is shown to the person it belongs to and to nobody else.
  "public.pack_opens",
  // Editable prompt sources and immutable authoring history are commissioner-only.
  "public.card_prompt_templates",
  "public.card_prompt_runs",
  // A pending offer is between two people, and it names cards they hold — the
  // same private collection data card_pulls is locked down to protect. Only the
  // completed trade is public, and only in its redacted form.
  "public.trade_offers",
  "public.trade_offer_items",
];

describe("public reads", () => {
  it.each(PUBLIC_READ)("anon can read %s", async (table) => {
    expect(await visibleRows("anon", table)).not.toBeNull();
  });

  it("lets anon read on_clock_since, which is what makes the crowd clock tick", async () => {
    // event_participants is granted at table level, so a new column is readable
    // without a fresh grant — but the spectator timer is the one thing that
    // breaks silently if that ever stops being true.
    const rows = await asRole<{ on_clock_since: string | null }>(
      "anon",
      "SELECT on_clock_since FROM public.event_participants",
    );
    expect(rows).not.toBeNull();
  });

  it("anon sees the seeded roster, not an empty result from a silent policy", async () => {
    const rows = await asRole<{ name: string }>(
      "anon",
      "SELECT name FROM public.participants ORDER BY name",
    );
    expect(rows.map((r) => r.name)).toEqual(["Alice", "Bob", "Carol", "Outsider"]);
  });

  it("anon can read the active event through the public view", async () => {
    const rows = await asRole<{ id: string }>(
      "anon",
      "SELECT id FROM public.events_public WHERE active",
    );
    expect(rows.map((r) => r.id)).toEqual([IDS.event]);
  });

  it("anon can read the events table itself — the PIN no longer lives there", async () => {
    // 20260724151735 revoked public read on events to hide the PIN columns;
    // 20260724151755 moved those columns into event_secrets and handed the
    // grant back. Both halves of that pair have to stay true together.
    expect(await visibleRows("anon", "public.events")).toBe(1);
  });

  it("has no PIN columns left on events for anyone to select", async () => {
    const rows = await sql<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'events'`,
    );
    const columns = rows.map((r) => r.column_name);
    expect(columns).not.toContain("pin_hash");
    expect(columns).not.toContain("pin_salt");
  });

  it("lets anon read a completed trade, which is what makes the feed a feed", async () => {
    // The positive control for `trades` being in PUBLIC_READ above: that list is
    // checked with `visibleRows(...) !== null`, which an empty table satisfies
    // without proving a single row would come back.
    await sql(
      `INSERT INTO public.trades
         (id, event_id, proposer_id, recipient_id, proposer_gave, recipient_gave)
       VALUES ($1, $2, $3, $4, '[{"kind":"secret"}]'::jsonb, '[{"kind":"secret"}]'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [TRADE_ID, IDS.event, IDS.alice, IDS.bob],
    );
    const rows = await asRole<{ id: string }>("anon", "SELECT id FROM public.trades");
    expect(rows.map((r) => r.id)).toEqual([TRADE_ID]);
  });

  it("lets anon read a set's name and order, which is all the vault labels need", async () => {
    // The positive control for secret_collections being in PUBLIC_READ: the list
    // above passes on `!== null`, which an empty table satisfies without proving
    // a row comes back. The table is seeded by 20260819222006 itself.
    const rows = await asRole<{ id: string; label: string }>(
      "anon",
      "SELECT id, label, sort_order, active FROM public.secret_collections ORDER BY sort_order",
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.id)).toContain("pets");
  });

  it("keeps the timestamps on a set out of the grant", async () => {
    // The grant is column-scoped, like runs. Anything not named in it stays out
    // of reach, which is what stops a later column being published by accident.
    expect(await isDenied("anon", "SELECT created_at FROM public.secret_collections")).toBe(true);
  });

  it("grants the names of the sets without granting the cards in them", async () => {
    // The silence rule the whole secret-card feature rests on: a label says
    // nothing about contents or size. This is the pair that has to stay true
    // together — one readable, the other not.
    await sql(
      `INSERT INTO public.secret_cards (id, name, art_path, collection)
       VALUES ($1, 'Gary the Grill', 'secrets/x/art-1.webp', 'pets')
       ON CONFLICT (id) DO NOTHING`,
      [SECRET_CARD_ID],
    );
    expect(await visibleRows("anon", "public.secret_collections")).toBeGreaterThan(0);
    const cards = await visibleRows("anon", "public.secret_cards");
    expect(cards === null || cards === 0).toBe(true);
  });

  it("hides the private columns on runs while keeping the times readable", async () => {
    // 20260724151735 narrowed the runs grant to named columns: notes and the
    // idempotency key are not among them.
    const rows = await asRole("anon", "SELECT official_time_ms, status FROM public.runs");
    expect(Array.isArray(rows)).toBe(true);
    expect(await isDenied("anon", "SELECT client_key FROM public.runs")).toBe(true);
  });
});

describe("server-only tables", () => {
  it.each(SERVER_ONLY)("anon cannot read %s", async (table) => {
    // Null means the read was refused outright; 0 rows would mean a policy is
    // filtering, which is also fine — what must never happen is rows coming back.
    const visible = await visibleRows("anon", table);
    expect(visible === null || visible === 0).toBe(true);
  });

  it.each(SERVER_ONLY)("authenticated cannot read %s either", async (table) => {
    const visible = await visibleRows("authenticated", table);
    expect(visible === null || visible === 0).toBe(true);
  });

  it("keeps a real PIN hash out of anon's reach", async () => {
    // Seeded through the owner, so there is genuinely something to leak.
    await sql(
      `INSERT INTO public.event_secrets (event_id, pin_salt, pin_hash)
       VALUES ($1, 'salt', 'hash') ON CONFLICT (event_id) DO NOTHING`,
      [IDS.event],
    );
    expect(await sql("SELECT count(*)::int AS n FROM public.event_secrets")).toEqual([{ n: 1 }]);
    const visible = await visibleRows("anon", "public.event_secrets");
    expect(visible === null || visible === 0).toBe(true);
  });

  it("keeps a real claim code out of anon's reach", async () => {
    await sql(
      `INSERT INTO public.member_codes (participant_id, code_salt, code_hash)
       VALUES ($1, 'salt', 'hash') ON CONFLICT (participant_id) DO NOTHING`,
      [IDS.alice],
    );
    const visible = await visibleRows("anon", "public.member_codes");
    expect(visible === null || visible === 0).toBe(true);
  });

  it("keeps a real secret card out of anon's reach", async () => {
    // Seeded through the owner, so there is genuinely something to leak — the
    // `visible === null || visible === 0` idiom above passes vacuously against an
    // empty table, and an empty table is exactly what this suite would otherwise
    // be asserting on.
    await sql(
      `INSERT INTO public.secret_cards (id, name, flavour, art_path)
       VALUES ($1, 'Gary the Grill', 'Lit at 11am. Still going at 11pm.', 'secrets/x/art-1.webp')
       ON CONFLICT (id) DO NOTHING`,
      [SECRET_CARD_ID],
    );
    expect(await sql("SELECT count(*)::int AS n FROM public.secret_cards")).toEqual([{ n: 1 }]);
    const visible = await visibleRows("anon", "public.secret_cards");
    expect(visible === null || visible === 0).toBe(true);
  });

  it("keeps a real prompt-history row out of anon's reach", async () => {
    await sql(
      `INSERT INTO public.card_prompt_runs
         (id, template_slug, template_name_snapshot, event_id, subject_name, generated_prompt, kind)
       VALUES ($1, 'secret_pet', 'Secret Pet', $2, 'Pickles',
         'Create a sufficiently detailed secret pet card prompt for Pickles.', 'initial')
       ON CONFLICT (id) DO NOTHING`,
      [PROMPT_RUN_ID, IDS.event],
    );
    expect(
      await sql("SELECT count(*)::int AS n FROM public.card_prompt_runs WHERE id = $1", [
        PROMPT_RUN_ID,
      ]),
    ).toEqual([{ n: 1 }]);
    const visible = await visibleRows("anon", "public.card_prompt_runs");
    expect(visible === null || visible === 0).toBe(true);
  });

  it("keeps who pulled what out of anon's reach", async () => {
    await sql(
      `INSERT INTO public.secret_cards (id, name, art_path)
       VALUES ($1, 'Gary the Grill', 'secrets/x/art-1.webp') ON CONFLICT (id) DO NOTHING`,
      [SECRET_CARD_ID],
    );
    await sql(
      `INSERT INTO public.secret_card_pulls (participant_id, secret_card_id, pulled_on)
       VALUES ($1, $2, current_date) ON CONFLICT DO NOTHING`,
      [IDS.alice, SECRET_CARD_ID],
    );
    expect(await sql("SELECT count(*)::int AS n FROM public.secret_card_pulls")).toEqual([
      { n: 1 },
    ]);
    const visible = await visibleRows("anon", "public.secret_card_pulls");
    expect(visible === null || visible === 0).toBe(true);
  });

  it("keeps who has packed whom out of anon's reach", async () => {
    await sql(
      `INSERT INTO public.card_pulls (participant_id, event_participant_id)
       SELECT $1, id FROM public.event_participants LIMIT 1
       ON CONFLICT DO NOTHING`,
      [IDS.alice],
    );
    expect(await sql("SELECT count(*)::int AS n FROM public.card_pulls")).toEqual([{ n: 1 }]);
    const visible = await visibleRows("anon", "public.card_pulls");
    expect(visible === null || visible === 0).toBe(true);
  });

  it("keeps the finish on each of somebody's copies out of anon's reach", async () => {
    // card_copies is what made a finish tradeable, and it is the most detailed
    // private record in the app: one row per copy, with the roll on each.
    await sql(
      `INSERT INTO public.card_copies (participant_id, event_participant_id, edition, source)
       SELECT $1, id, 'platinum', 'backfill' FROM public.event_participants LIMIT 1`,
      [IDS.bob],
    );
    const [{ n }] = await sql<{ n: number }>("SELECT count(*)::int AS n FROM public.card_copies");
    expect(n).toBeGreaterThan(0);
    const visible = await visibleRows("anon", "public.card_copies");
    expect(visible === null || visible === 0).toBe(true);
  });

  it("keeps how many packs somebody has opened out of anon's reach", async () => {
    await sql(
      `INSERT INTO public.pack_opens (participant_id, opened_on)
       VALUES ($1, current_date) ON CONFLICT DO NOTHING`,
      [IDS.alice],
    );
    expect(await sql("SELECT count(*)::int AS n FROM public.pack_opens")).toEqual([{ n: 1 }]);
    const visible = await visibleRows("anon", "public.pack_opens");
    expect(visible === null || visible === 0).toBe(true);
  });

  it("keeps a pending offer, and the cards staked on it, between the two people in it", async () => {
    // Seeded through the owner, so there is genuinely something to leak — the
    // `visible === null || visible === 0` idiom passes vacuously against an empty
    // table, and an empty table is what these two would otherwise be asserting on.
    await sql(
      `INSERT INTO public.trade_offers (id, event_id, proposer_id, recipient_id)
       VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
      [OFFER_ID, IDS.event, IDS.alice, IDS.bob],
    );
    await sql(
      `INSERT INTO public.card_copies (id, participant_id, event_participant_id, edition, source)
       SELECT $1, $2, id, 'platinum', 'backfill'
         FROM public.event_participants ORDER BY running_order LIMIT 1
       ON CONFLICT (id) DO NOTHING`,
      [COPY_ID, IDS.alice],
    );
    await sql(
      `INSERT INTO public.trade_offer_items (offer_id, giver_side, kind, card_copy_id)
       VALUES ($1, 'proposer', 'roster', $2) ON CONFLICT DO NOTHING`,
      [OFFER_ID, COPY_ID],
    );
    expect(await sql("SELECT count(*)::int AS n FROM public.trade_offers")).toEqual([{ n: 1 }]);
    expect(await sql("SELECT count(*)::int AS n FROM public.trade_offer_items")).toEqual([
      { n: 1 },
    ]);

    for (const role of ["anon", "authenticated"] as const) {
      for (const table of ["public.trade_offers", "public.trade_offer_items"]) {
        const visible = await visibleRows(role, table);
        expect(visible === null || visible === 0).toBe(true);
      }
    }
  });

  it("keeps a cast ballot secret before the reveal", async () => {
    await sql(
      `INSERT INTO public.award_votes (event_id, category, voter_participant_id, target_participant_id)
       VALUES ($1, 'mvp', $2, $3)
       ON CONFLICT (event_id, category, voter_participant_id) DO NOTHING`,
      [IDS.event, IDS.alice, IDS.bob],
    );
    const visible = await visibleRows("anon", "public.award_votes");
    expect(visible === null || visible === 0).toBe(true);
  });
});

describe("anon has no write grant anywhere", () => {
  // Every write in the app goes through a server function running as
  // service_role. If anon could write directly, the guards in
  // require-auth.server.ts would be decorative.
  const WRITES: [string, string, unknown[]][] = [
    [
      "insert trash talk",
      `INSERT INTO public.card_comments (event_participant_id, participant_id, body)
       SELECT id, $1, 'anon was here' FROM public.event_participants LIMIT 1`,
      [IDS.alice],
    ],
    [
      "insert a reaction",
      `INSERT INTO public.card_reactions (event_participant_id, participant_id, emoji)
       SELECT id, $1, '🔥' FROM public.event_participants LIMIT 1`,
      [IDS.alice],
    ],
    ["update a run time", "UPDATE public.runs SET official_time_ms = 1", []],
    ["delete a run", "DELETE FROM public.runs", []],
    ["scratch a player", "UPDATE public.event_participants SET participation_status = 'scratched'", []], // prettier-ignore
    ["unlock the results", "UPDATE public.events SET results_locked = false", []],
    ["rename a player", "UPDATE public.participants SET name = 'pwned'", []],
    ["publish an award", `INSERT INTO public.awards (event_id, award_name) VALUES ($1, 'MVP')`, [IDS.event]], // prettier-ignore
    ["stuff the ballot", `INSERT INTO public.award_votes (event_id, category, voter_participant_id, target_participant_id) VALUES ($1, 'mvp', $2, $2)`, [IDS.event, IDS.alice]], // prettier-ignore
    ["issue itself a claim code", `INSERT INTO public.member_codes (participant_id, code_salt, code_hash) VALUES ($1, 's', 'h')`, [IDS.bob]], // prettier-ignore
    ["set its own event PIN", `INSERT INTO public.event_secrets (event_id, pin_salt, pin_hash) VALUES ($1, 's', 'h')`, [IDS.event]], // prettier-ignore
    ["print itself a secret card", `INSERT INTO public.secret_cards (name, art_path) VALUES ('Pwned', 'secrets/x/art.webp')`, []], // prettier-ignore
    ["grant itself a secret pull", `INSERT INTO public.secret_card_pulls (participant_id, secret_card_id, pulled_on) SELECT $1, id, current_date FROM public.secret_cards LIMIT 1`, [IDS.alice]], // prettier-ignore
    ["credit itself a card pull", `INSERT INTO public.card_pulls (participant_id, event_participant_id) SELECT $1, id FROM public.event_participants LIMIT 1`, [IDS.alice]], // prettier-ignore
    // Bob on a past date, not Alice on today's: this suite seeds once for the
    // whole file and the read test above already inserted (alice, current_date),
    // so that key would collide on the primary key and `isDenied` — which counts
    // any error as a denial — would pass without ever reaching the grant.
    ["inflate its own pack count", `INSERT INTO public.pack_opens (participant_id, opened_on) VALUES ($1, current_date - 30)`, [IDS.bob]], // prettier-ignore
    // `trades` is the one trading table anon can SELECT, which makes it the one
    // that needs saying out loud that the grant is read-only: a forged row here
    // is a trade announced in the feed that never happened.
    ["announce a trade that never happened", `INSERT INTO public.trades (event_id, proposer_id, recipient_id) VALUES ($1, $2, $3)`, [IDS.event, IDS.alice, IDS.bob]], // prettier-ignore
    ["plant an offer in somebody's inbox", `INSERT INTO public.trade_offers (event_id, proposer_id, recipient_id) VALUES ($1, $2, $3)`, [IDS.event, IDS.alice, IDS.bob]], // prettier-ignore
    ["stake a card on an offer", `INSERT INTO public.trade_offer_items (offer_id, giver_side, kind, card_copy_id) VALUES ($1, 'proposer', 'roster', $2)`, [OFFER_ID, COPY_ID]], // prettier-ignore
    ["mint itself a platinum copy", `INSERT INTO public.card_copies (participant_id, event_participant_id, edition) SELECT $1, id, 'platinum' FROM public.event_participants LIMIT 1`, [IDS.alice]], // prettier-ignore
    ["upgrade the finish on a copy", `UPDATE public.card_copies SET edition = 'platinum'`, []], // prettier-ignore
    // The whole swap runs inside accept_trade_offer as service_role. Reaching the
    // status column directly would take both people's cards out of the loop.
    ["accept somebody else's offer", `UPDATE public.trade_offers SET status = 'accepted'`, []], // prettier-ignore
    // 20260822121000 granted SELECT on the set names. Read-only, like every other
    // public grant in this app — renaming a set from devtools is still refused.
    ["rename a set", `UPDATE public.secret_collections SET label = 'pwned'`, []], // prettier-ignore
    ["invent a set", `INSERT INTO public.secret_collections (id, label) VALUES ('pwned', 'Pwned')`, []], // prettier-ignore
  ];

  it.each(WRITES)("anon cannot %s", async (_label, statement, params) => {
    expect(await isDenied("anon", statement, params)).toBe(true);
  });

  it.each(WRITES)("authenticated cannot %s either", async (_label, statement, params) => {
    // There is no per-user login in this app, so `authenticated` should be no
    // more privileged than `anon`.
    expect(await isDenied("authenticated", statement, params)).toBe(true);
  });

  it("leaves the data untouched after every refused write", async () => {
    const [{ n }] = await sql<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.participants WHERE name = 'pwned'",
    );
    expect(n).toBe(0);
  });
});

describe("service_role", () => {
  it("bypasses RLS, which is why the server-side guards carry the whole load", async () => {
    const rows = await asRole<{ n: string }>(
      "service_role",
      "SELECT count(*)::text AS n FROM public.event_secrets",
    );
    expect(Number(rows[0].n)).toBeGreaterThan(0);
  });

  it("can write where anon cannot", async () => {
    expect(
      await isDenied("service_role", "UPDATE public.participants SET nickname = nickname"),
    ).toBe(false);
  });
});
