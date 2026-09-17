# Database changes for the collector guest merge and the pack's dealable flag

Paste the whole of this file to Lovable. It is one prompt: the rules first, then
the SQL to apply, then five queries that prove it landed correctly.

These are the two migrations from PR #118, already merged to `main`:

- `supabase/migrations/20260916120000_merge_every_guest_in_one_transaction.sql`
- `supabase/migrations/20260916121000_pack_status_says_whether_anything_is_dealable.sql`

**The TypeScript side of this work is already in git; only the database is
missing.** Two bugs stay live until it lands: a signup can permanently strand an
account's whole secret-card collection, and the daily pack cue advertises a pack
on days there is nothing to deal.

### Preconditions

Both of these must already exist in the project. Neither is created here.

- `public.merge_guest_into_collector(uuid, uuid)` — from `20260908172154`. The new
  function delegates to it; applying section 2a without it gives you a function
  that raises `undefined_function` on its first real call.
- `public.pack_status(uuid, uuid)` — from `20260908165733`. Section 2b replaces it.

---

## 1. Read this first — what must NOT change

**This app has no per-user login.** There is no `auth.uid()`. The `authenticated`
role is reachable by anyone holding the publishable key, and that key ships to
every browser that loads the site — so a grant to `authenticated` is a grant to
the public internet. Every read and write goes through a server function running
as `service_role`, which bypasses RLS entirely. Nothing here needs a policy.

Do not do any of the following:

- **Do not grant `EXECUTE` on either function to `anon`, `authenticated` or
  `PUBLIC`,** and **do not remove the `REVOKE ALL ON FUNCTION ... FROM PUBLIC`
  lines.** A `SECURITY DEFINER` function keeps Postgres's default
  `EXECUTE TO PUBLIC`, so dropping the revoke turns
  `POST /rest/v1/rpc/merge_guests_into_collector` into a token-less way to move
  any guest's collection onto any participant.
- **Do not change either function to `SECURITY INVOKER`.** They run as definer so
  the tables underneath can stay unreachable to everyone else.
- **Do not rename `merge_guests_into_collector` to the singular, and do not
  "consolidate" the two into one function.** The plural name is deliberate.
  `CREATE OR REPLACE` cannot change an argument list, so a `(uuid, uuid[])` body
  under the singular name creates an **overload** beside the existing
  `(uuid, uuid)` one — each with its own grants — and `rpc('merge_guest_into_collector', …)`
  becomes ambiguous from PostgREST. That is the trap `20260911130000` had to clean
  up after, and `tests/db/migrations.test.ts` asserts one signature per function
  precisely to catch it.
- **Do not drop, inline or "simplify away" `merge_guest_into_collector`.** The
  plural calls it once per guest on purpose: the participant lock, the
  `'No such player'` raise and the packs-before-the-claims-keyed-off-them ordering
  are defined in exactly one place, and that raise landing _before_ any guest has
  moved is half of what makes the loop all-or-nothing.
- **Do not remove the `ORDER BY g` from the loop.** Each iteration takes an
  advisory lock on its guest and holds it to the end of the transaction, so two
  signups folding an overlapping pair in opposite orders deadlock instead of
  queueing. The sort is the fixed lock order, not tidiness.
- **Do not change `SET timezone = 'America/New_York'` on `pack_status`.** It must
  match `open_pack`, or the league day boundary splits and one person can open two
  packs inside one wall-clock day.
- **Do not remove `STABLE` from `pack_status`.** Opening the pack screen must never
  spend the pack. Equally, **do not add `STABLE` or `IMMUTABLE` to
  `merge_guests_into_collector`** to "match" it — that one writes, and the two
  volatility markers differing is the correct state, not an inconsistency.
- **Do not drop the `dealable` key from the returned object, and do not "tidy" it
  into a count.** The client reads it as a boolean and a missing key reads as
  `false`, which silently kills the pack cue for everybody. It is only ever
  "there is something to deal" — never how much, and never what.
- **Do not edit any application code.** It arrives through git.

---

## 2. What to apply

### 2a. `20260916120000_merge_every_guest_in_one_transaction.sql`

A signup folds the account's own guest id **and** the guest id the handset is
holding. `mergeGuests` called the single-guest RPC once per id, and each call is
its own request to PostgREST and its own implicit transaction — so the first one
commits and stands. When the second raises, the account binding goes back to the
prior guest and the fresh participant is retired, while the rows the first move
already carried sit on that retired id with their `guest_id` nulled. Unreachable,
and the collection lost is the account's canonical one: every pull it ever made.

```sql
CREATE OR REPLACE FUNCTION public.merge_guests_into_collector(
  _participant_id uuid,
  _guest_ids      uuid[]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _g uuid;
BEGIN
  IF _participant_id IS NULL OR _guest_ids IS NULL THEN RETURN; END IF;

  -- Sorted, and not for tidiness: each iteration takes an advisory lock on its
  -- guest and holds it to the end of the transaction, so two signups folding an
  -- overlapping pair in opposite orders are a deadlock rather than a queue. One
  -- fixed order makes them queue. Same reason merge_guest_packs (20260827130418)
  -- orders its two ids before taking their locks.
  --
  -- The per-guest work stays in merge_guest_into_collector rather than being
  -- restated here, so the participant lock, the 'No such player' raise and the
  -- packs-before-the-claims-keyed-off-them ordering are defined in one place.
  -- That raise landing before any guest has moved is half of what makes this
  -- all-or-nothing; the shared transaction is the other half.
  FOR _g IN
    SELECT DISTINCT g FROM unnest(_guest_ids) AS g WHERE g IS NOT NULL ORDER BY g
  LOOP
    PERFORM public.merge_guest_into_collector(_participant_id, _g);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_guests_into_collector(uuid, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_guests_into_collector(uuid, uuid[]) TO service_role;
```

### 2b. `20260916121000_pack_status_says_whether_anything_is_dealable.sql`

`20260908165733` dropped the old availability bit on the stated ground that "a
pack is always available". `open_pack`, in the same file, has never agreed: when
its pool is empty it returns `NULL` and writes no row, deliberately, so the day is
not spent. No row means `openedToday` stays false — and `claimed && !openedToday`
reads that as a pack waiting, so the nav tab takes its dot and the vault's Today
card takes its ring, all pointing at a screen that says "Nothing to deal today".

**Signature unchanged**, so this is a replacement rather than an overload, and it
is safe to re-apply. The `REVOKE`/`GRANT` pair is restated rather than inherited.

```sql
CREATE OR REPLACE FUNCTION public.pack_status(
  _participant_id uuid,
  _guest_id       uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET timezone = 'America/New_York'
AS $$
DECLARE _day date := current_date;
BEGIN
  RETURN jsonb_build_object(
    'day', _day,
    'openedToday', EXISTS (
      SELECT 1 FROM public.pack_opens
       WHERE opened_on = _day
         AND ((_participant_id IS NOT NULL AND participant_id = _participant_id)
           OR (_guest_id IS NOT NULL AND guest_id = _guest_id))),
    -- Only ever "there is something to deal", never how much and never what --
    -- the same rule secretsOwned below keeps. Both halves of open_pack's pool,
    -- with the same predicates: a secret needs art and a weight to be picked at
    -- all, and the roster half needs an event that is on.
    --
    -- The event is resolved here rather than taken as an argument, the way
    -- claim_streak_milestone resolves its own. That keeps the signature, and the
    -- signature is what keeps `rpc('pack_status', ...)` unambiguous. It reads
    -- slightly wider than open_pack, which is handed the single newest active
    -- event by its caller: with two events somehow active at once and the newer
    -- one empty, this says dealable and open_pack deals from the secrets alone.
    -- That is the direction to be wrong in, and it is the behaviour today.
    'dealable', (
      EXISTS (SELECT 1 FROM public.secret_cards
               WHERE active AND art_path IS NOT NULL AND weight > 0)
      OR EXISTS (SELECT 1 FROM public.event_participants ep
                   JOIN public.events e ON e.id = ep.event_id
                  WHERE e.active)),
    'secretsOwned', (
      SELECT count(*) FROM public.secret_card_pulls
       WHERE NOT is_duplicate
         AND ((_participant_id IS NOT NULL AND participant_id = _participant_id)
           OR (_guest_id IS NOT NULL AND guest_id = _guest_id))),
    'resetsAt', ((_day + 1)::timestamp AT TIME ZONE current_setting('TimeZone'))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pack_status(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pack_status(uuid, uuid) TO service_role;
```

---

## 3. Verify — run these and check the output

If any of the five returns something other than what is stated, something in the
block above was modified. Do not proceed: re-apply it exactly as written and
re-run these checks. None of these five writes anything.

```sql
-- 1. Exactly one signature for each of the three, and the singular still there.
--    Expect EXACTLY these three rows, in this order:
--      merge_guest_into_collector   | _participant_id uuid, _guest_id uuid
--      merge_guests_into_collector  | _participant_id uuid, _guest_ids uuid[]
--      pack_status                  | _participant_id uuid, _guest_id uuid
--    A fourth row means an overload was created — see section 1.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('merge_guest_into_collector', 'merge_guests_into_collector', 'pack_status')
 ORDER BY p.proname, args;

-- 2. The settings that must survive. Expect exactly these two rows:
--      sig                                      | proconfig                                     | provolatile | prosecdef
--      merge_guests_into_collector(uuid,uuid[]) | {search_path=public}                          | v           | t
--      pack_status(uuid,uuid)                   | {search_path=public,TimeZone=America/New_York} | s           | t
--    The two provolatile values differ on purpose and neither is a typo: the merge
--    WRITES, so it is volatile ('v'); pack_status is a pure read, so it is STABLE
--    ('s'). Making the merge stable would stop it writing at all.
SELECT p.oid::regprocedure::text AS sig, p.proconfig, p.provolatile, p.prosecdef
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('merge_guests_into_collector', 'pack_status')
 ORDER BY sig;

-- 3. Neither browser role can execute either function. Expect ZERO rows.
SELECT p.oid::regprocedure::text AS sig
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('merge_guest_into_collector', 'merge_guests_into_collector', 'pack_status')
   AND (has_function_privilege('anon', p.oid, 'EXECUTE')
     OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));

-- 4. pack_status answers the new question. Expect has_dealable = t, and dealable
--    true or false depending on whether this project currently has an active
--    event with a roster, or any secret card that is active, has art and has a
--    weight above zero. The guest id is a throwaway; this is a pure read.
WITH s AS (
  SELECT public.pack_status(NULL, '00000000-0000-4000-8000-00000000de01'::uuid) AS status
)
SELECT status ? 'dealable'    AS has_dealable,
       status -> 'dealable'   AS dealable,
       status ? 'openedToday' AS still_has_openedtoday
  FROM s;

-- 5. The atomicity property, proved without seeding anything.
--    5a. An empty array is a no-op even for a participant that does not exist —
--        the loop never runs, so nothing is looked up. Expect NO error.
SELECT public.merge_guests_into_collector(
  '00000000-0000-4000-8000-00000000dead'::uuid, '{}'::uuid[]);

--    5b. A real guest list against a participant that does not exist must RAISE,
--        and raise before the first guest is touched. Expect:
--          ERROR:  No such player
SELECT public.merge_guests_into_collector(
  '00000000-0000-4000-8000-00000000dead'::uuid,
  ARRAY['00000000-0000-4000-8000-00000000de01'::uuid,
        '00000000-0000-4000-8000-00000000de02'::uuid]);
```

Queries 1, 2 and 5 assert the same properties the CI suite already asserts in
`tests/db/migrations.test.ts` and `tests/db/collector-merge.test.ts`, so the prompt
and the test suite are checking literally the same things.

---

## 4. Afterwards (optional)

Regenerate the TypeScript types so `merge_guests_into_collector` is known to the
typed client:

```
supabase gen types typescript --project-id <project-id> > src/integrations/supabase/types.ts
```

Once that is done, the `untypedDb()` wrapper at the top of
`src/lib/collector.server.ts` can be deleted and its one call site switched to
plain `supabaseAdmin` — that function's own header says as much. The same is true
of the sibling wrapper in `src/lib/account.server.ts`, which is waiting on the
same regeneration for `bind_account_to_player`.

`pack_status` needs no type change: it already returns `jsonb`, and the new key is
read through `PackStatusResult` in `src/lib/secret-cards-rows.ts`.
