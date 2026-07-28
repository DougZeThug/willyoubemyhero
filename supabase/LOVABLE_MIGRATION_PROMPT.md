# Database changes for secret cards and pull counts

Paste the whole of this file to Lovable. It is one prompt: the rules first, then
the SQL to apply, then four queries that prove it landed correctly.

---

## 1. Read this first — what must NOT change

**RLS enabled with zero policies is the intended, correct, finished state for
`secret_cards`, `secret_card_pulls` and `card_pulls`.** It is not a bug, it is not
an oversight, and the Supabase dashboard's "RLS enabled, no policies" warning is
expected. **Do not add a policy to any of these three tables. Not a SELECT policy,
not a policy restricted to `authenticated`, not a temporary one.**

Here is why the obvious fix is the catastrophic one. **This app has no per-user
login.** There is no `auth.uid()`. The `authenticated` role is not "a logged-in
user of this app" — it is reachable by anyone holding the publishable key, and the
publishable key ships to every browser that loads the site. So a policy scoped to
`authenticated` is a policy scoped to _the public internet_. One `SELECT` policy on
`secret_cards` hands the entire secret card set — every card, every joke, and the
number of them — to anyone who opens devtools, and the feature is over. It cannot
be undone: once somebody has read the set, they have read it.

Every read and write in this app goes through a server function running as
`service_role`, which bypasses RLS entirely. `service_role` already has
`GRANT ALL`. **Nothing is broken. Nothing needs a policy.**

Do not do any of the following:

- **Do not `GRANT` anything** on those three tables to `anon`, `authenticated` or
  `PUBLIC`. That is the leak described above.
- **Do not add them to the `supabase_realtime` publication.** Publishing them
  broadcasts every pull, with the puller's id attached, to every connected phone.
- **Do not change any `SECURITY DEFINER` function to `SECURITY INVOKER`.** They run
  as definer so that the tables can stay unreachable to everyone else.
- **Do not remove the `REVOKE ALL ON FUNCTION ... FROM PUBLIC` lines.** A
  `SECURITY DEFINER` function keeps Postgres's default `EXECUTE TO PUBLIC`, so
  removing the revoke turns `POST /rest/v1/rpc/pull_secret_card` into a free,
  token-less read of the whole set that also spends everybody's daily pull.
- **Do not change `SET timezone = 'America/New_York'`** on `pull_secret_card` or
  `secret_pull_status`. They must match each other, or the league day boundary
  splits and one person can take two cards inside one wall-clock day.
- **Do not create a view over these tables**, and do not "expose the counts" — the
  app already serves them through a server function.
- **Do not edit any application code.** The TypeScript side of this work arrives
  through git; only the database is missing.

Every statement below is idempotent (`CREATE TABLE IF NOT EXISTS`,
`CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`), so applying this twice
is safe.

---

## 2. What to apply

Run these two migrations in this order.

### 2a. `20260728143000_secret_holo_cards.sql`

Already in git; included here so this file is self-contained and so a project that
never received it is repaired by the same paste.

```sql
-- Secret holo cards: a permanent league collection, not an event's roster.
--
-- Standalone admin-authored cards — the dog, the grill, the legendary moment —
-- with no participant behind them, so they get their own table rather than
-- borrowing event_participants. Deliberately NOT event-scoped: uploaded once,
-- they keep working every combine, and a member's collection carries forward.
--
-- BOTH TABLES ARE SERVER-ONLY, AND THAT IS THE WHOLE FEATURE. One anon SELECT
-- grant and anybody with devtools reads the entire set without opening a pack.

-- ============ CATALOGUE ============
CREATE TABLE IF NOT EXISTS public.secret_cards (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  -- The admin's one line. Its own field rather than a reused player quote,
  -- because a secret card's whole personality is the line written for it.
  flavour    text,
  -- Holo treatment id, resolved in src/lib/secret-cards.ts. Deliberately NOT one
  -- of the six rarity tiers — that vocabulary is persisted in
  -- event_participants.card_rarity and secrets must not squat in it. No CHECK, so
  -- an unknown string falls back in TS the way card-rarity.ts does for an
  -- unrecognised override.
  foil       text NOT NULL DEFAULT 'rosette',
  -- Storage paths in the private participant-photos bucket. Never public URLs.
  art_path   text,
  back_path  text,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT secret_cards_name_len CHECK (char_length(name) BETWEEN 1 AND 60)
);

COMMENT ON TABLE public.secret_cards IS
  'League-wide secret card catalogue. Deliberately not event-scoped: the set is uploaded once and carries forward across combines. Server-only; never exposed through events_public or realtime.';

ALTER TABLE public.secret_cards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.secret_cards FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.secret_cards TO service_role;
-- No policies, on purpose: RLS on with zero policies denies every non-BYPASSRLS
-- role, and the revoked grant denies it a second time. Same shape as
-- event_secrets and member_codes.

CREATE OR REPLACE TRIGGER secret_cards_updated
  BEFORE UPDATE ON public.secret_cards
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ PULL LEDGER ============
CREATE TABLE IF NOT EXISTS public.secret_card_pulls (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  -- RESTRICT, not CASCADE: the ledger is the permanent record of what somebody
  -- actually pulled. Cascading a catalogue delete would erase that.
  secret_card_id uuid NOT NULL REFERENCES public.secret_cards(id) ON DELETE RESTRICT,
  -- The league day this pull was spent on, decided by the SERVER. A date, not a
  -- text day-key, so the unique index is exact.
  pulled_on      date NOT NULL,
  -- Flavour only, and nullable: a pull can happen out of season. SET NULL rather
  -- than CASCADE because the pull outlives the event — that is the whole point.
  event_id       uuid REFERENCES public.events(id) ON DELETE SET NULL,
  is_duplicate   boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.secret_card_pulls IS
  'Who pulled which secret card, and on which league day. Readable by anon this would be worse than the catalogue: it leaks card ids, who owns what, and the set size from a row count against the roster.';

-- THE one-per-day rule, in the schema rather than in the UI. Same reasoning as
-- award_votes' UNIQUE (event_id, category, voter_participant_id). An INDEX rather
-- than a table constraint so it is re-runnable; every ON CONFLICT that targets it
-- therefore infers by COLUMNS, never by constraint name.
CREATE UNIQUE INDEX IF NOT EXISTS secret_card_pulls_one_per_day
  ON public.secret_card_pulls (participant_id, pulled_on);

-- At most one *ownership* row per member per card. Duplicates are exempt, and a
-- duplicate can only exist because a non-duplicate already does.
CREATE UNIQUE INDEX IF NOT EXISTS secret_card_pulls_owned_once
  ON public.secret_card_pulls (participant_id, secret_card_id)
  WHERE NOT is_duplicate;

CREATE INDEX IF NOT EXISTS secret_card_pulls_card_idx
  ON public.secret_card_pulls (secret_card_id);

ALTER TABLE public.secret_card_pulls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.secret_card_pulls FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.secret_card_pulls TO service_role;

-- NO ALTER PUBLICATION supabase_realtime for either table. Publishing them would
-- broadcast every pull to every connected phone: the leak above, and the exact
-- opposite of the design.

-- ============ ONE ACTIVE EVENT ============
-- requireLeagueAdmin resolves "the current combine" server-side to authorize
-- edits to a catalogue that has no event of its own. events.active is a plain
-- boolean today, so two active events are representable and that resolution could
-- disagree with getActiveEvent's.
CREATE UNIQUE INDEX IF NOT EXISTS events_one_active
  ON public.events (active) WHERE active;

-- ============ THE DAILY PULL ============
--
-- Selection happens in SQL for two reasons: atomicity (read-what-you-don't-own
-- and insert are one transaction) and shape (the catalogue never leaves Postgres
-- as a *set*, so there is no variable holding it one careless return from the wire).
CREATE OR REPLACE FUNCTION public.pull_secret_card(
  _participant_id uuid,
  _event_id       uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
-- The league day is decided here and nowhere else. The zone is baked in rather
-- than passed as an argument: a caller-chosen zone can shift the day boundary by
-- 26 hours and farm two cards across one wall-clock day.
SET search_path = public
SET timezone = 'America/New_York'
AS $$
DECLARE
  _day  date := current_date;
  _card uuid;
  _dupe boolean := false;
  _row  public.secret_card_pulls;
BEGIN
  -- Serialize this member's concurrent pulls and prove the member exists, the way
  -- cast_award_vote locks the event row before touching award_votes.
  PERFORM 1 FROM public.participants WHERE id = _participant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Participant not found'; END IF;

  -- Already spent today: return the same card. A double-tap or a retried request
  -- should resume the reveal, not fail.
  SELECT * INTO _row FROM public.secret_card_pulls
   WHERE participant_id = _participant_id AND pulled_on = _day;
  IF FOUND THEN
    RETURN jsonb_build_object('pullId', _row.id, 'cardId', _row.secret_card_id,
      'day', _row.pulled_on, 'duplicate', _row.is_duplicate, 'fresh', false);
  END IF;

  -- `art_path IS NOT NULL` is load-bearing: createSecretCards commits the row
  -- before the upload, so a failed upload would otherwise leave a pullable blank
  -- that burns somebody's once-a-day pull forever.
  SELECT c.id INTO _card FROM public.secret_cards c
   WHERE c.active AND c.art_path IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.secret_card_pulls p
                      WHERE p.participant_id = _participant_id
                        AND p.secret_card_id = c.id)
   ORDER BY random() LIMIT 1;

  IF _card IS NULL THEN
    -- Whole set owned. A duplicate keeps the daily ritual alive; it writes a
    -- ledger row but no new ownership (see secret_card_pulls_owned_once).
    SELECT c.id INTO _card FROM public.secret_cards c
     WHERE c.active AND c.art_path IS NOT NULL ORDER BY random() LIMIT 1;
    _dupe := _card IS NOT NULL;
  END IF;

  -- Nothing pullable yet. Burn no pull and record nothing, so the member can try
  -- again the moment the commissioner uploads the first card.
  IF _card IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.secret_card_pulls
    (participant_id, secret_card_id, pulled_on, event_id, is_duplicate)
  VALUES (_participant_id, _card, _day, _event_id, _dupe)
  -- Inferred by columns. secret_card_pulls_one_per_day is an INDEX, not a
  -- constraint, so ON CONFLICT ON CONSTRAINT <name> would raise on every call.
  ON CONFLICT (participant_id, pulled_on) DO NOTHING
  RETURNING * INTO _row;

  IF _row.id IS NULL THEN
    -- The row lock should make this unreachable; the unique index makes it
    -- harmless. The loser of a race gets a card, not an error.
    SELECT * INTO _row FROM public.secret_card_pulls
     WHERE participant_id = _participant_id AND pulled_on = _day;
    RETURN jsonb_build_object('pullId', _row.id, 'cardId', _row.secret_card_id,
      'day', _row.pulled_on, 'duplicate', _row.is_duplicate, 'fresh', false);
  END IF;

  RETURN jsonb_build_object('pullId', _row.id, 'cardId', _row.secret_card_id,
    'day', _row.pulled_on, 'duplicate', _row.is_duplicate, 'fresh', true);
END;
$$;

-- These two lines are the most important in the migration. A SECURITY DEFINER
-- function keeps Postgres's default EXECUTE TO PUBLIC; without the revoke,
-- POST /rest/v1/rpc/pull_secret_card with the publishable key — which ships to
-- every browser — hands out the entire set with no token at all, and spends
-- everyone else's daily pull while doing it.
REVOKE ALL ON FUNCTION public.pull_secret_card(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pull_secret_card(uuid, uuid) TO service_role;

-- ============ STATUS (pure read) ============
-- Separate from the pull so that opening the pack screen can never spend the drop.
CREATE OR REPLACE FUNCTION public.secret_pull_status(_participant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET timezone = 'America/New_York'   -- must match pull_secret_card
AS $$
DECLARE _day date := current_date;
BEGIN
  RETURN jsonb_build_object(
    'day', _day,
    'pulledToday', EXISTS (SELECT 1 FROM public.secret_card_pulls
                            WHERE participant_id = _participant_id AND pulled_on = _day),
    -- How many this member owns. Never how many exist — the vault line has no
    -- denominator precisely because there is none to show.
    'pulled', (SELECT count(*) FROM public.secret_card_pulls
                WHERE participant_id = _participant_id AND NOT is_duplicate),
    -- Only ever "there is something to pull", never how much.
    'available', EXISTS (SELECT 1 FROM public.secret_cards
                          WHERE active AND art_path IS NOT NULL),
    -- Counted against the league day rather than the phone's, which can be hours
    -- out for someone travelling.
    'resetsAt', ((_day + 1)::timestamp AT TIME ZONE current_setting('TimeZone'))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.secret_pull_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.secret_pull_status(uuid) TO service_role;
```

### 2b. `20260728160000_player_card_pulls.sql`

New.

```sql
-- Who has packed which roster card.
--
-- Until now there was no server-side record of a player-card pull at all:
-- collectCard in src/lib/card-collection.ts writes to this device's IndexedDB and
-- nowhere else. This is the league-wide half of that number, and the only thing
-- it exists to answer is "how many people have this card".
--
-- ONE ROW PER PERSON PER CARD, not one row per pull. A plain row count per card
-- is therefore the distinct-people count with no DISTINCT anywhere — and the
-- composite primary key means one person can contribute at most 1 to any card's
-- count however many times they call in. There is nothing here to inflate.

CREATE TABLE IF NOT EXISTS public.card_pulls (
  participant_id       uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  event_participant_id uuid NOT NULL REFERENCES public.event_participants(id) ON DELETE CASCADE,
  -- Never displayed. The number the UI shows is the ROW count, which a retry
  -- cannot move; this is here because it is free now and a migration later.
  pull_count           int NOT NULL DEFAULT 1,
  first_pulled_at      timestamptz NOT NULL DEFAULT now(),
  last_pulled_at       timestamptz NOT NULL DEFAULT now(),
  -- The primary key IS the uniqueness rule, so there is no surrogate id and
  -- nothing to reference a row by. (secret_card_pulls needs one because its two
  -- uniqueness rules are partial indexes and its ledger rows are individually
  -- referenceable; neither is true here.)
  PRIMARY KEY (participant_id, event_participant_id),
  CONSTRAINT card_pulls_count_positive CHECK (pull_count > 0)
);

COMMENT ON TABLE public.card_pulls IS
  'Which people have packed which roster card. Server-only: the aggregate ("7 people have this card") is public and served by getCardPullCounts, but the per-member rows ("Alice has never packed Bob") are nobody else''s business.';

-- The primary key leads on participant_id, so the count query — group by card
-- across a whole event — needs its own index. Same shape as card_reactions_card_idx.
CREATE INDEX IF NOT EXISTS card_pulls_card_idx ON public.card_pulls (event_participant_id);

ALTER TABLE public.card_pulls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.card_pulls FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.card_pulls TO service_role;
-- No policies, on purpose: RLS on with zero policies denies every non-BYPASSRLS
-- role, and the revoked grant denies it a second time. Same shape as award_votes
-- and secret_card_pulls.

-- NO ALTER PUBLICATION supabase_realtime. Publishing this broadcasts every pull,
-- with the puller's id attached, to every connected phone.

-- ============ THE WRITE ============
-- One statement, so a three-card pack is one round trip and one transaction.
CREATE OR REPLACE FUNCTION public.record_card_pulls(
  _participant_id        uuid,
  _event_participant_ids uuid[]
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _n int;
BEGIN
  IF _participant_id IS NULL OR _event_participant_ids IS NULL THEN RETURN 0; END IF;

  -- Prove the member exists, so a still-valid token for a deleted participant
  -- returns zero rather than raising a foreign-key error into a call the client
  -- makes fire-and-forget and never surfaces.
  PERFORM 1 FROM public.participants WHERE id = _participant_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- The JOIN is what makes an unknown id harmless: it is dropped rather than
  -- failing the whole batch on a foreign key, so a pack dealt from a bundle that
  -- has since changed still records the cards that are still real.
  -- DISTINCT because ON CONFLICT cannot affect the same row twice in one INSERT.
  INSERT INTO public.card_pulls AS cp (participant_id, event_participant_id)
  SELECT DISTINCT _participant_id, ep.id
    FROM unnest(_event_participant_ids) AS t(id)
    JOIN public.event_participants ep ON ep.id = t.id
  ON CONFLICT (participant_id, event_participant_id) DO UPDATE
    SET pull_count = cp.pull_count + 1,
        last_pulled_at = now();

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

-- Same reasoning as pull_secret_card: a SECURITY DEFINER function keeps
-- Postgres's default EXECUTE TO PUBLIC, and the publishable key ships to every
-- browser. Without these two lines anyone can credit themselves every card.
REVOKE ALL ON FUNCTION public.record_card_pulls(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_card_pulls(uuid, uuid[]) TO service_role;
```

---

## 3. Verify — run these and check the output

If any of the four returns something other than what is stated, something in the
block above was modified. Do not proceed: re-apply the DDL exactly as written and
re-run these checks.

```sql
-- 1. Three server-only tables, RLS on, ZERO policies.
--    Expect exactly 3 rows, every rls_enabled = t and every policy_count = 0.
SELECT c.relname, c.relrowsecurity AS rls_enabled,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('secret_cards', 'secret_card_pulls', 'card_pulls')
 ORDER BY c.relname;

-- 2. No grants to anon/authenticated/PUBLIC on any of them. Expect ZERO rows.
SELECT grantee, table_name, privilege_type
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public'
   AND table_name IN ('secret_cards', 'secret_card_pulls', 'card_pulls')
   AND grantee IN ('anon', 'authenticated', 'PUBLIC');

-- 3. anon/authenticated can EXECUTE none of this project's functions.
--    Expect ZERO rows. (Extension and trigger functions are excluded; neither is
--    reachable over PostgREST.)
SELECT p.oid::regprocedure::text AS sig
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.prorettype <> 'pg_catalog.trigger'::regtype
   AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.objid = p.oid AND d.classid = 'pg_proc'::regclass
                      AND d.deptype = 'e')
   AND (has_function_privilege('anon', p.oid, 'EXECUTE')
     OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));

-- 4. None of the three are published for realtime. Expect ZERO rows.
SELECT tablename FROM pg_publication_tables
 WHERE pubname = 'supabase_realtime'
   AND tablename IN ('secret_cards', 'secret_card_pulls', 'card_pulls');
```

Query 3 is the same check the CI suite runs in `tests/db/secret-cards.test.ts`, so
the prompt and the test suite are asserting literally the same property.

One thing no query can check: **the `participant-photos` storage bucket must stay
private.** That flag lives in dashboard state rather than in any migration. Secret
card art is stored there under a `secrets/` prefix, and a public bucket would let
anyone list and read every card without pulling one.

---

## 4. Afterwards (optional)

Regenerate the TypeScript types so the new tables are known to the typed client:

```
supabase gen types typescript --project-id <project-id> > src/integrations/supabase/types.ts
```

Once that is done, `src/lib/secret-cards-db.server.ts` can be deleted and its call
sites switched to plain `supabaseAdmin` — that file's own header says as much.
