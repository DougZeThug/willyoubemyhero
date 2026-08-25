-- The daily mint cap, counted from something nothing can edit.
--
-- 20260826120000 added a cap on how many roster copies a member can mint in a
-- league day, because card_copies_one_pull_per_day is unique per CARD and a
-- hand-posted list of every roster id therefore mints a copy of each — which the
-- dust migration turned into currency. The cap counted what the member currently
-- HOLDS today:
--
--     SELECT count(*) FROM card_copies
--      WHERE participant_id = _pid AND source = 'pull' AND acquired_on = _day
--
-- Every term of that predicate is mutable, and accept_trade_offer breaks all
-- three at once: it re-parents the row, sets source = 'trade' and nulls
-- acquired_on. So trading today's copy away gives the slot back AND takes the
-- row out of the partial unique index, and the same pack can be recorded again
-- for a replacement. The received copy escapes mill_card_copy's freshness guard
-- too (it checks source = 'pull'), and edition_asserted_by survives the transfer,
-- so it still pays the full server rate. Two members holding duplicates could
-- swap today's copies, both re-mint, both burn what they received, and repeat
-- for unbounded dust. dust_ledger_earn_once does not bound it: every re-mint is
-- a fresh card_copies.id, so its `ref` differs each cycle.
--
-- A cap over mutable ownership is a cap that anything moving a copy reopens —
-- R5's craft_up_copies consumes three copies and would reopen it again. So the
-- count moves to an append-only record of the mint itself.

-- ============ WHAT WAS MINTED, AND WHEN ============
CREATE TABLE IF NOT EXISTS public.card_mints (
  participant_id       uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  -- The league day, in New York, exactly as record_card_pulls sees it.
  minted_on            date NOT NULL,
  event_participant_id uuid NOT NULL REFERENCES public.event_participants(id) ON DELETE CASCADE,
  created_at           timestamptz NOT NULL DEFAULT now(),
  -- Column order IS the index story. The (participant_id, minted_on) prefix
  -- serves the daily count; the whole key serves the per-card "already minted
  -- today" test. Two questions, one index, no second one to keep in step.
  PRIMARY KEY (participant_id, minted_on, event_participant_id)
);

COMMENT ON TABLE public.card_mints IS
  'One row per roster card a member minted on a league day. Append-only and never edited: a trade moves the copy, a mill deletes it, and neither may hand back a mint. Server-only, the card_pulls posture — it says who has packed whom, which is nobody else''s business.';

ALTER TABLE public.card_mints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.card_mints FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.card_mints TO service_role;
-- No policies, on purpose: RLS on with zero policies denies every non-BYPASSRLS
-- role, and the revoked grant denies it a second time. Same shape as card_pulls.

-- NO ALTER PUBLICATION supabase_realtime. Everything card_pulls says about
-- broadcasting who packed what applies here with a date attached.

-- ============ BACKFILL ============
-- Every pull copy still carrying an acquired_on is a mint that really happened,
-- so this reconstructs it. Copies already traded away have a null acquired_on and
-- cannot be reconstructed at all — an honest gap rather than a guessed one, and
-- it can only matter for the cap on the day this deploys.
--
-- ON CONFLICT rather than a one-shot flag, so the file replays against a database
-- that already has these rows.
INSERT INTO public.card_mints (participant_id, minted_on, event_participant_id)
SELECT DISTINCT cc.participant_id, cc.acquired_on, cc.event_participant_id
  FROM public.card_copies cc
 WHERE cc.source = 'pull' AND cc.acquired_on IS NOT NULL
ON CONFLICT DO NOTHING;

-- ============ THE WRITE ============
-- Same signature, same return type, so CREATE OR REPLACE and no ACL to restore.
-- The grants are restated at the end anyway — the rule belongs next to the
-- function rather than inferred from history.
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

  -- FOR UPDATE. The mint cap below is a read-then-write and races itself without
  -- it: two retries landing together would both see the same _held. And every
  -- dust RPC locks this same row, so a pack recording while a mill runs queues
  -- instead of interleaving. Position two in the app's lock order -- participants,
  -- then the rows keyed to them -- so no new deadlock shape.
  --
  -- Still returns an empty answer rather than raising for a participant that no
  -- longer exists: this call is fire-and-forget and a throw would surface as a
  -- console error nobody can act on.
  PERFORM 1 FROM public.participants WHERE id = _participant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('recorded', 0, 'editions', '{}'::jsonb);
  END IF;

  -- MINTS, NOT COPIES. See the header: counting held copies let a trade hand the
  -- slot back. A mint row is written once and never moved or deleted, so this is
  -- a budget rather than an inventory.
  SELECT count(*)::int INTO _held
    FROM public.card_mints
   WHERE participant_id = _participant_id
     AND minted_on = _day;

  WITH want AS (
    -- The JOIN is what makes an unknown id harmless: dropped rather than failing
    -- the whole batch on a foreign key, so a pack dealt from a bundle that has
    -- since changed still records the cards that are still real.
    SELECT DISTINCT ep.id AS ep_id
      FROM unnest(_event_participant_ids) AS t(id)
      JOIN public.event_participants ep ON ep.id = t.id
  ), fresh AS (
    -- Anything already minted today is dropped outright rather than passed
    -- through, which is the other half of the fix. The previous body UNION'd
    -- already-filed cards back into the insert so a degenerate ON CONFLICT DO
    -- UPDATE would return their stored finish — but a card whose copy has been
    -- traded away has nothing left to conflict with, so that path would mint a
    -- second copy instead of returning the first. What a retry needs to hear is
    -- answered by the read-back at the end instead.
    SELECT w.ep_id, row_number() OVER (ORDER BY w.ep_id) AS n
      FROM want w
     WHERE NOT EXISTS (
       SELECT 1 FROM public.card_mints m
        WHERE m.participant_id = _participant_id
          AND m.minted_on = _day
          AND m.event_participant_id = w.ep_id)
  ), allowed AS (
    SELECT ep_id FROM fresh WHERE n <= GREATEST(0, _cap - _held)
  ), minted AS (
    INSERT INTO public.card_mints (participant_id, minted_on, event_participant_id)
    SELECT _participant_id, _day, a.ep_id FROM allowed a
    -- Belt and braces against the backfill's blind spot: a copy minted before
    -- this migration and traded away leaves no mint row to reconstruct, so the
    -- card can reach `allowed` once more. The copy insert below then no-ops on
    -- the day index and nothing is minted twice.
    ON CONFLICT DO NOTHING
    RETURNING event_participant_id AS ep_id
  )
  INSERT INTO public.card_copies
    (participant_id, event_participant_id, edition, acquired_on, source, edition_asserted_by)
  SELECT _participant_id, m.ep_id,
         public.roll_card_edition(_participant_id, m.ep_id, _day),
         _day, 'pull', 'server'
    FROM minted m
  -- Inferred by columns and predicate, never by name: card_copies_one_pull_per_day
  -- is an INDEX rather than a constraint, exactly like its secret-card twin.
  ON CONFLICT (participant_id, event_participant_id, acquired_on) WHERE source = 'pull'
  DO NOTHING;

  -- Everything of this pack filed against today, whether this call minted it or
  -- an earlier attempt did. Driving the ownership row and the resync off this
  -- rather than off what was just inserted makes a retry self-healing: a call
  -- that minted the copies but died before the resync fixes itself on the next
  -- attempt instead of leaving pull_count short.
  SELECT COALESCE(array_agg(cc.event_participant_id), '{}'::uuid[])
    INTO _eps
    FROM public.card_copies cc
   WHERE cc.participant_id = _participant_id
     AND cc.source = 'pull'
     AND cc.acquired_on = _day
     AND cc.event_participant_id = ANY(_event_participant_ids);

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

  -- ---- what the pack is actually told ----
  -- Read back rather than RETURNING off the insert. The insert now only touches
  -- cards being minted for the first time today, and a retry needs the finishes
  -- of the ones it filed on the previous attempt — so the answer is "whatever is
  -- filed against today", whoever filed it and whenever. A copy the member no
  -- longer owns is absent, which is correct: it is not theirs to be shown.
  --
  -- KEYED BY CARD, NOT POSITIONAL. This RPC collapses the payload with DISTINCT
  -- and may ration it, so the response has neither the caller's ordering nor its
  -- length. A map cannot be misaligned.
  SELECT COALESCE(jsonb_object_agg(cc.event_participant_id::text, cc.edition), '{}'::jsonb)
    INTO _map
    FROM public.card_copies cc
   WHERE cc.participant_id = _participant_id
     AND cc.source = 'pull'
     AND cc.acquired_on = _day
     AND cc.event_participant_id = ANY(_event_participant_ids);

  RETURN jsonb_build_object(
    'recorded', COALESCE(array_length(_eps, 1), 0),
    'editions', _map);
END;
$$;

REVOKE ALL ON FUNCTION public.record_card_pulls(uuid, uuid[], text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_card_pulls(uuid, uuid[], text[]) TO service_role;
