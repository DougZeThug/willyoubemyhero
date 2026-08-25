-- Editions become a server fact.
--
-- Until now a finish was rolled on the phone (rollEdition in src/lib/card-edition.ts)
-- and posted with the pack. recordCardPulls re-derived that claim in TypeScript and
-- replaced a set matching no candidate league day, which was enough while an
-- edition was only ever a stat about yourself. It stops being enough here: R4 pays
-- dust BY edition, so a finish has to be something Postgres decided rather than
-- something a device asserted and the server agreed with.
--
-- What changes: the derivation moves into SQL, record_card_pulls returns what it
-- decided, and every copy carries a note saying who decided it.

-- ============ THE FINISH ============
-- The same ladder rollEdition walks, and the same arithmetic roll_secret_tier
-- (20260814133353) uses: basis points out of 10000, cumulative, rarest first.
-- 50 platinum / 350 gold / 800 silver / 1800 bronze / 7000 standard.
-- tests/db/card-copies.test.ts pins these thresholds against EDITION_WEIGHTS_BP in
-- src/lib/card-edition.ts, so the TS copy and this one cannot drift.
--
-- DERIVED FROM THE TRIPLE, NOT ROLLED, and that is the load-bearing decision in
-- this file. A random() roll is idempotent only for as long as a conflicting row
-- exists to collide with -- and R4 ships two supported ways to remove that row.
-- mill_card_copy DELETEs the copy; accept_trade_offer clears acquired_on on the
-- copy it re-parents. Either one turns "record the pack again" into a fresh draw,
-- and after 4b the mill route is dust-POSITIVE: you get paid to re-roll, which is
-- strictly better than paying 50 dust to reroll_copy_edition and would undercut
-- the sink the economy is built on. Seeded on the triple the answer is identical
-- on the first call, on the eighteenth retry, and after the copy has been milled
-- and re-minted.
--
-- Not an attempt to mirror rollEdition's own PRNG. That is FNV-1a into mulberry32
-- with 32-bit wraparound (src/lib/format.ts), and reimplementing it here would be
-- a permanent liability in exchange for agreeing with a client whose opinion this
-- migration exists to stop consulting.
--
-- No event in the seed: an event_participant_id belongs to exactly one event, so
-- the event is already implied. The day is folded to a day NUMBER rather than
-- ::text, because date-to-text depends on DateStyle and would make two sessions
-- disagree about the same copy.
--
-- Masked to 31 bits rather than abs()'d: abs(-2^63) raises. The residual bias is
-- about one part in 2e5, a rounding error against a 0.5% rung.
CREATE OR REPLACE FUNCTION public.roll_card_edition(
  _participant_id       uuid,
  _event_participant_id uuid,
  _day                  date
) RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
           WHEN d <   50 THEN 'platinum'
           WHEN d <  400 THEN 'gold'
           WHEN d < 1200 THEN 'silver'
           WHEN d < 3000 THEN 'bronze'
           ELSE 'standard'
         END
    FROM (
      SELECT (hashtextextended(
                _participant_id::text || ':' ||
                _event_participant_id::text || ':' ||
                (_day - DATE '1970-01-01')::text, 0) & 2147483647) % 10000 AS d
    ) t;
$$;

REVOKE ALL ON FUNCTION public.roll_card_edition(uuid, uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roll_card_edition(uuid, uuid, date) TO service_role;

-- ============ WHO DECIDED THIS FINISH ============
-- Not a trust flag on a person, a provenance note on a row. Everything already in
-- the table was decided by a phone, so 'client' is the honest default and there is
-- deliberately no backfill: relabelling history as server-decided would be a lie,
-- and telling the difference is the entire purpose of the column.
--
-- Only two writers set 'server': record_card_pulls below and reroll_copy_edition
-- in the dust migration. adopt_card_copies stays 'client' (a guest's packs were
-- sealed on a device id this server never learns) and so does grant_card_copy -- a
-- commissioner PICKS that edition, they do not roll it, and leaving grants at
-- 'client' is what stops the admin path from being a dust printer.
--
-- A CHECK here where card_copies.edition deliberately has none, and the asymmetry
-- is the point. `edition` is rendered, and card-edition.ts falls anything it does
-- not recognise back to standard on the way out. This one is never rendered and IS
-- money, so an unrecognised value has to be a write that fails rather than a
-- payout that guesses. Append-only, and DROP-then-ADD is the same shape
-- 20260818192450 used to widen card_copies_source_ck, so this replays.
ALTER TABLE public.card_copies
  ADD COLUMN IF NOT EXISTS edition_asserted_by text NOT NULL DEFAULT 'client';

ALTER TABLE public.card_copies DROP CONSTRAINT IF EXISTS card_copies_edition_asserted_by_ck;
ALTER TABLE public.card_copies ADD CONSTRAINT card_copies_edition_asserted_by_ck
  CHECK (edition_asserted_by IN ('client', 'server'));

COMMENT ON COLUMN public.card_copies.edition_asserted_by IS
  'server = roll_card_edition() decided this finish; client = it came off a phone (a pre-R4 pull, an adopt, a commissioner grant). Anything that PAYS BY edition trusts only server rows. Travels with the copy through a trade, because the derivation travelled with it.';

-- ============ THE WRITE ============
-- Dropped rather than replaced, and this one is not a style choice: the return
-- type goes from int to jsonb, which CREATE OR REPLACE cannot do. The ARGUMENT
-- list is deliberately byte-identical to the one 20260817115000 left behind, so
-- this is a replacement and not an overload -- _editions stays, accepted and
-- ignored, and a phone still holding the old bundle keeps recording its packs
-- instead of failing on an unknown parameter. tests/db/migrations.test.ts pins
-- that signature. The DROP takes the ACL with it, which is why the REVOKE/GRANT
-- pair below has to be re-issued rather than inherited.
DROP FUNCTION IF EXISTS public.record_card_pulls(uuid, uuid[], text[]);

CREATE OR REPLACE FUNCTION public.record_card_pulls(
  _participant_id        uuid,
  _event_participant_ids uuid[],
  -- ACCEPTED AND IGNORED, deliberately. Kept so a client mid-rollout keeps
  -- resolving; its value is never read, because reading it is the client-asserted
  -- edition coming back in through the window.
  _editions              text[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
-- Same zone as the pack drop, the secret drop and trade_item_is_spare. Four daily
-- things now, and they all have to agree about where the day ends.
SET timezone = 'America/New_York'
AS $$
DECLARE
  -- Double the pack (PACK_SIZE is 3 in players.pack.tsx), which no honest day can
  -- reach: one pack_opens row per league day, and the only way to name a fourth
  -- card is a re-deal against a roster that changed underneath you.
  _cap constant int := 6;
  _day  date := current_date;
  _held int;
  _eps  uuid[];
  _map  jsonb;
BEGIN
  IF _participant_id IS NULL OR _event_participant_ids IS NULL THEN
    RETURN jsonb_build_object('recorded', 0, 'editions', '{}'::jsonb);
  END IF;

  -- FOR UPDATE, which this function did not used to take. Two reasons, both new.
  -- The mint cap below is a read-then-write and races itself without it: two
  -- retries landing together would both see the same _held. And every dust RPC
  -- locks this same row, so a pack recording while a mill runs queues instead of
  -- interleaving. Position two in the app's lock order -- participants, then the
  -- rows keyed to them -- so no new deadlock shape.
  --
  -- Still returns an empty answer rather than raising for a participant that no
  -- longer exists: this call is fire-and-forget and a throw would surface as a
  -- console error nobody can act on.
  PERFORM 1 FROM public.participants WHERE id = _participant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('recorded', 0, 'editions', '{}'::jsonb);
  END IF;

  -- THE DAILY MINT CAP, and it is here because of what 4b turns a copy into.
  -- This endpoint has always tolerated hand-posted roster ids, on the argument
  -- that the worst anybody could manufacture was "one phantom pack a day on a
  -- stat only they can see". That was written before card_copies existed and is
  -- now false twice over: card_copies_one_pull_per_day is unique per CARD, so a
  -- posted list of every roster id mints a copy of each, and after the dust
  -- migration each of those is millable currency. A private stat became a mint,
  -- so the mint gets a rate limit.
  SELECT count(*)::int INTO _held
    FROM public.card_copies
   WHERE participant_id = _participant_id
     AND source = 'pull'
     AND acquired_on = _day;

  WITH want AS (
    -- The JOIN is what makes an unknown id harmless: dropped rather than failing
    -- the whole batch on a foreign key, so a pack dealt from a bundle that has
    -- since changed still records the cards that are still real.
    SELECT DISTINCT ep.id AS ep_id
      FROM unnest(_event_participant_ids) AS t(id)
      JOIN public.event_participants ep ON ep.id = t.id
  ), ranked AS (
    SELECT w.ep_id,
           EXISTS (SELECT 1 FROM public.card_copies c
                    WHERE c.participant_id = _participant_id
                      AND c.event_participant_id = w.ep_id
                      AND c.source = 'pull'
                      AND c.acquired_on = _day) AS already
      FROM want w
  ), allowed AS (
    -- A card already filed today is ALWAYS let through, cap or no cap: that is
    -- the retry, and it has to reach the RETURNING below or the reveal has no
    -- finish to show. Only NEW mints are rationed.
    SELECT ep_id FROM ranked WHERE already
    UNION ALL
    SELECT ep_id FROM (
      SELECT ep_id, row_number() OVER (ORDER BY ep_id) AS n
        FROM ranked WHERE NOT already
    ) f
     WHERE f.n <= GREATEST(0, _cap - _held)
  ), ins AS (
    INSERT INTO public.card_copies AS cc
      (participant_id, event_participant_id, edition, acquired_on, source, edition_asserted_by)
    SELECT _participant_id, a.ep_id,
           public.roll_card_edition(_participant_id, a.ep_id, _day),
           _day, 'pull', 'server'
      FROM allowed a
    -- Inferred by columns and predicate, never by name: card_copies_one_pull_per_day
    -- is an INDEX rather than a constraint, exactly like its secret-card twin.
    ON CONFLICT (participant_id, event_participant_id, acquired_on) WHERE source = 'pull'
    -- THE STORED FINISH WINS. THIS MUST NEVER BECOME CONDITIONAL AGAIN.
    --
    -- This was a card_edition_rank best-of, which was right while the incoming
    -- edition was a CLAIM about a roll that had already happened elsewhere. With
    -- the server deciding, a best-of is a ratchet: the client records a pack up to
    -- three times per cycle and re-arms on 'online' and 'visibilitychange', so a
    -- member in a dead spot would keep the best of repeated draws.
    --
    -- SET edition = cc.edition -- the target alias, NOT excluded -- writes the row
    -- back to itself. It is a real UPDATE, so RETURNING emits it: one statement
    -- hands back the derived value on an insert and the STORED value on a
    -- conflict, which is what makes a retry and a first call indistinguishable to
    -- the caller. DO NOTHING would return nothing on exactly the path the reveal
    -- depends on. Returning the stored value rather than re-deriving it is also
    -- what leaves room for a future pity floor, which is a fact about history and
    -- can only be applied on first insert.
    DO UPDATE SET edition = cc.edition
    RETURNING cc.event_participant_id AS ep_id, cc.edition AS ed
  )
  SELECT COALESCE(jsonb_object_agg(ep_id::text, ed), '{}'::jsonb),
         COALESCE(array_agg(ep_id), '{}'::uuid[])
    INTO _map, _eps
    FROM ins;

  -- ---- the ownership row ----
  -- Built from the copies that actually landed rather than from the payload, so a
  -- capped id cannot mint a card_pulls row with no copy behind it. pull_count and
  -- edition are placeholders: resync_card_pull below overwrites both.
  INSERT INTO public.card_pulls AS cp (participant_id, event_participant_id)
  SELECT _participant_id, e FROM unnest(_eps) AS e
  ON CONFLICT (participant_id, event_participant_id) DO UPDATE
    SET last_pulled_at = now();

  -- A SEPARATE STATEMENT from the INSERT above, and it has to be. Every arm of a
  -- data-modifying CTE reads the same pre-statement snapshot, so a resync folded
  -- in there would count the copies as they were BEFORE the insert and write a
  -- pull_count short by exactly this pack.
  PERFORM public.resync_card_pull(_participant_id, e) FROM unnest(_eps) AS e;

  -- KEYED BY CARD, NOT POSITIONAL, and that is a deliberate break with the
  -- _editions parameter above. This RPC collapses the payload with DISTINCT and
  -- may ration it, so the response has neither the caller's ordering nor its
  -- length. A map cannot be misaligned; the positional contract needed a refine()
  -- in the handler and a warning comment in the route to survive.
  RETURN jsonb_build_object(
    'recorded', COALESCE(array_length(_eps, 1), 0),
    'editions', _map);
END;
$$;

REVOKE ALL ON FUNCTION public.record_card_pulls(uuid, uuid[], text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_card_pulls(uuid, uuid[], text[]) TO service_role;
