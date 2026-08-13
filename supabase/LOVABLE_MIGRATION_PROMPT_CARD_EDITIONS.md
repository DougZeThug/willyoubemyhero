# Database changes for card editions

Paste the whole of this file to Lovable. It is one prompt: the rules first, then
the SQL to apply, then five queries that prove it landed correctly.

This is the migration `supabase/migrations/20260813120000_card_pull_editions.sql`.
It supersedes `LOVABLE_MIGRATION_PROMPT.md` in one place — that file still contains
the two-argument `record_card_pulls`, which this replaces. **Apply this one after
it, never before, and never re-paste that file afterwards.**

---

## 1. Read this first — what must NOT change

Everything in `LOVABLE_MIGRATION_PROMPT.md` section 1 still applies in full: RLS
enabled with zero policies is the finished state for `secret_cards`,
`secret_card_pulls` and `card_pulls`; no grants to `anon`, `authenticated` or
`PUBLIC`; no realtime publication; no `SECURITY DEFINER` → `SECURITY INVOKER`; no
removing a `REVOKE ... FROM PUBLIC`. Do not undo any of it while applying this.

Five more rules specific to this change.

**1. The `DROP FUNCTION` is required. Do not skip it, and do not "keep the old one
for compatibility."** `CREATE OR REPLACE FUNCTION` cannot change an argument list.
Adding `_editions` without dropping first leaves the two-argument function standing
as a separate _overload_ — with its own grants, which the drop is also there to
remove. Once both exist, a two-argument call is genuinely ambiguous and PostgREST's
resolution stops being predictable. There must be exactly one `record_card_pulls`
when this finishes, and query 2 below checks that.

**2. Do not add a `CHECK` constraint to `card_pulls.edition`.** The vocabulary lives
in `src/lib/card-edition.ts`, which falls back to `standard` for anything it does not
recognise — the same contract `event_participants.card_rarity` and `secret_cards.foil`
already have. A CHECK here would turn a harmless unknown value into a failed write in
the middle of somebody's pack.

**3. Do not change the primary key on `card_pulls`.** It stays
`(participant_id, event_participant_id)`. The entire "how many people have packed
this card" number is a plain row count with no `DISTINCT` anywhere, and that only
works because one person cannot have two rows for one card. A second pull in a better
finish **upgrades the existing row**; it never inserts one. Widening the key to
include `edition` silently inflates every public count.

**4. Do not remove `SET timezone = 'America/New_York'` or the `pull_count` CASE.**
They are carried over unchanged from the existing function. The timezone defines the
league day boundary, and the CASE is what stops re-opening an already-torn pack
adding a duplicate to the stats on every mount.

**5. Create `card_edition_rank` before `record_card_pulls`.** The second references
the first. The block below is already in the right order — apply it top to bottom as
one script.

Every statement below is idempotent (`ADD COLUMN IF NOT EXISTS`,
`DROP FUNCTION IF EXISTS`, `CREATE OR REPLACE FUNCTION`), so applying this twice is
safe.

---

## 2. What to apply

### `20260813120000_card_pull_editions.sql`

```sql
-- The finish on a copy of a card.
--
-- A card's TIER is earned on the course and reads the same on every phone. Its
-- EDITION is rolled when you pull it, so two people can hold the same champion
-- and one of them holds a better print of it.
--
-- That is why the column lives HERE and not on event_participants: card_pulls is
-- a row about a person's copy, event_participants is a row about a player.

ALTER TABLE public.card_pulls
  ADD COLUMN IF NOT EXISTS edition text NOT NULL DEFAULT 'standard';

COMMENT ON COLUMN public.card_pulls.edition IS
  'Best finish this person has ever pulled of this card. NOT NULL DEFAULT backfills every pre-existing row as standard, which is the honest statement: those cards were packed before editions existed. No CHECK, on purpose — the ids live in src/lib/card-edition.ts and an unrecognised value falls back to standard there, exactly as an unrecognised event_participants.card_rarity falls back to base.';

-- ============ THE LADDER ============
-- Rarest first. This ordering exists in exactly two places: here, and
-- EDITION_ORDER in src/lib/card-edition.ts. An unknown id sorts last rather than
-- raising, which is what lets a real finish still displace a corrupt stored value.
CREATE OR REPLACE FUNCTION public.card_edition_rank(_edition text)
RETURNS int
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE(
    array_position(ARRAY['platinum','gold','silver','bronze','standard'], _edition),
    99);
$$;

-- Not SECURITY DEFINER — it reads nothing. Revoked anyway, because the rule this
-- schema holds itself to is blanket rather than case-by-case: anon must have
-- EXECUTE on NO function this app wrote.
REVOKE ALL ON FUNCTION public.card_edition_rank(text) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.card_edition_rank(text) TO service_role;

-- ============ THE WRITE ============
-- Dropped, not replaced: CREATE OR REPLACE cannot change an argument list, so it
-- would leave the two-arg function standing as an OVERLOAD with its own grants.
-- Dropping also drops those grants, which is why the REVOKE/GRANT pair at the
-- bottom has to be re-issued here rather than inherited.
DROP FUNCTION IF EXISTS public.record_card_pulls(uuid, uuid[]);

CREATE OR REPLACE FUNCTION public.record_card_pulls(
  _participant_id        uuid,
  _event_participant_ids uuid[],
  -- Positionally aligned with the ids above. DEFAULT NULL so a caller that
  -- predates editions — an old bundle still in a phone's cache mid-rollout —
  -- still resolves, and simply records standard.
  _editions              text[] DEFAULT NULL
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET timezone = 'America/New_York'
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
  -- failing the whole batch on a foreign key.
  --
  -- unnest(a, b) zips the two arrays and pads the shorter with NULL, which is how
  -- a caller may omit editions entirely and still get standard out of the COALESCE.
  --
  -- DISTINCT ON rather than plain DISTINCT: ON CONFLICT cannot affect the same row
  -- twice in one INSERT, and the same card id can now arrive twice carrying two
  -- different finishes — which plain DISTINCT would no longer collapse.
  INSERT INTO public.card_pulls AS cp (participant_id, event_participant_id, edition)
  SELECT DISTINCT ON (ep.id)
         _participant_id, ep.id, COALESCE(t.edition, 'standard')
    FROM unnest(_event_participant_ids, _editions) AS t(id, edition)
    JOIN public.event_participants ep ON ep.id = t.id
   ORDER BY ep.id, public.card_edition_rank(t.edition)
  ON CONFLICT (participant_id, event_participant_id) DO UPDATE
    SET pull_count = cp.pull_count
                   + CASE
                       WHEN (cp.last_pulled_at AT TIME ZONE 'America/New_York')::date
                            = current_date THEN 0
                       ELSE 1
                     END,
        -- Best wins, and only upward. A worse finish of a card you already hold
        -- is a duplicate, not a downgrade.
        edition = CASE
                    WHEN public.card_edition_rank(EXCLUDED.edition)
                       < public.card_edition_rank(cp.edition)
                    THEN EXCLUDED.edition
                    ELSE cp.edition
                  END,
        last_pulled_at = now();

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

-- A SECURITY DEFINER function keeps Postgres's default EXECUTE TO PUBLIC, and the
-- publishable key ships to every browser. Without these two lines anyone can
-- credit themselves every card, now in any finish they like.
REVOKE ALL ON FUNCTION public.record_card_pulls(uuid, uuid[], text[]) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_card_pulls(uuid, uuid[], text[]) TO service_role;
```

---

## 3. Verify — run these and check the output

If any of the five returns something other than what is stated, something in the
block above was modified. Do not proceed: re-apply the DDL exactly as written and
re-run these checks.

```sql
-- 1. The column exists, is NOT NULL, and defaults to standard.
--    Expect exactly 1 row: is_nullable = NO, column_default containing 'standard'.
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'card_pulls' AND column_name = 'edition';

-- 2. EXACTLY ONE record_card_pulls, and it is the three-argument one.
--    Expect exactly 1 row, args = '_participant_id uuid, _event_participant_ids uuid[], _editions text[]'.
--    TWO rows here means the DROP was skipped and an ambiguous overload now exists.
SELECT pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'record_card_pulls';

-- 3. The ladder orders rarest first, and an unknown value sorts last.
--    Expect: 1, 2, 3, 4, 5, 99, 99.
SELECT public.card_edition_rank('platinum'), public.card_edition_rank('gold'),
       public.card_edition_rank('silver'),   public.card_edition_rank('bronze'),
       public.card_edition_rank('standard'), public.card_edition_rank('legendary'),
       public.card_edition_rank(NULL);

-- 4. The primary key did NOT move. Expect exactly one row:
--    'card_pulls_pkey' over (participant_id, event_participant_id) — no edition.
SELECT conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
 WHERE conrelid = 'public.card_pulls'::regclass AND contype = 'p';

-- 5. anon/authenticated can EXECUTE neither new function. Expect ZERO rows.
SELECT p.oid::regprocedure::text AS sig
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('record_card_pulls', 'card_edition_rank')
   AND (has_function_privilege('anon', p.oid, 'EXECUTE')
     OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
```

Queries 1, 2 and 5 are the same properties the CI suite asserts in
`tests/db/migrations.test.ts` and `tests/db/card-pulls.test.ts`, so the prompt and
the test suite are checking literally the same things.

### A behaviour check, if you want one

Safe to run against a real database — it writes nothing that survives it.

```sql
BEGIN;
  -- Pick any real member and any real card.
  WITH m AS (SELECT id FROM public.participants LIMIT 1),
       c AS (SELECT id FROM public.event_participants LIMIT 1)
  SELECT public.record_card_pulls((SELECT id FROM m), ARRAY[(SELECT id FROM c)], ARRAY['bronze']);

  WITH m AS (SELECT id FROM public.participants LIMIT 1),
       c AS (SELECT id FROM public.event_participants LIMIT 1)
  SELECT public.record_card_pulls((SELECT id FROM m), ARRAY[(SELECT id FROM c)], ARRAY['platinum']);

  -- Expect ONE row, edition = 'platinum'. An upgrade must not add a row.
  SELECT count(*) AS rows, max(edition) AS edition
    FROM public.card_pulls
   WHERE participant_id = (SELECT id FROM public.participants LIMIT 1)
     AND event_participant_id = (SELECT id FROM public.event_participants LIMIT 1);

  WITH m AS (SELECT id FROM public.participants LIMIT 1),
       c AS (SELECT id FROM public.event_participants LIMIT 1)
  SELECT public.record_card_pulls((SELECT id FROM m), ARRAY[(SELECT id FROM c)], ARRAY['standard']);

  -- Still 'platinum'. A worse finish is a duplicate, not a downgrade.
  SELECT edition FROM public.card_pulls
   WHERE participant_id = (SELECT id FROM public.participants LIMIT 1)
     AND event_participant_id = (SELECT id FROM public.event_participants LIMIT 1);
ROLLBACK;
```

---

## 4. Afterwards (optional)

Regenerate the TypeScript types so `card_pulls.edition` is known to the typed client:

```
supabase gen types typescript --project-id <project-id> > src/integrations/supabase/types.ts
```

Note that `src/integrations/supabase/types.ts` is generated and `.prettierignore`d —
never hand-edit it. Until it is regenerated, `card_pulls` is reached through the
untyped client in `src/lib/secret-cards-db.server.ts`, which already carries the
`edition` field on its `CardPullRow` type, so nothing is blocked on this.
