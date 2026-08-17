-- One row per COPY of a roster card.
--
-- The missing entity. `card_pulls` is one row per person per card — that shape is
-- load-bearing, because a plain row count per card IS the public "Packed by N"
-- number with no DISTINCT anywhere (see 20260728160000_player_card_pulls.sql). So
-- `card_pulls.edition` never meant "the finish of this copy"; it means "the best
-- finish this person has ever pulled", and there was no single copy's finish to
-- hand to anybody. That is why a traded card used to arrive `standard`.
--
-- This table is that copy. It changes nothing about what `card_pulls` means or
-- how many rows it has: `pull_count` and `edition` simply stop being maintained by
-- arithmetic and start being DERIVED from the copies, by one function
-- (`resync_card_pull`) that both the pack and the trade call. Two writers, one
-- rule.
--
-- THE CONSEQUENCE WORTH KNOWING ABOUT: `card_pulls.edition` can now go DOWN. Trade
-- away your only platinum and your best finish really is standard. Every other
-- path still only ever raises it, but "monotonically increasing" is no longer a
-- property of that column, and `mergeCollection` in src/lib/collection-merge.ts
-- had to stop assuming it was.

CREATE TABLE IF NOT EXISTS public.card_copies (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id       uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  event_participant_id uuid NOT NULL REFERENCES public.event_participants(id) ON DELETE CASCADE,
  -- Same unconstrained text as card_pulls.edition, and for the same reason: the
  -- ids live in src/lib/card-edition.ts, which renders anything it does not
  -- recognise as standard rather than throwing on the way out of a read.
  edition              text NOT NULL DEFAULT 'standard',
  -- The league day this copy was PULLED on, and the key to the once-a-day rule
  -- below. NULL for a copy that did not come from a pack — a traded copy, or one
  -- reconstructed by the backfill — so those never meet that index.
  acquired_on          date,
  source               text NOT NULL DEFAULT 'pull',
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT card_copies_source_ck CHECK (source IN ('pull', 'trade', 'backfill'))
);

COMMENT ON TABLE public.card_copies IS
  'One row per copy of a roster card somebody holds. Server-only, exactly like card_pulls: the aggregate over it is public, the rows are not. card_pulls.pull_count and .edition are derived from this table by resync_card_pull().';

CREATE INDEX IF NOT EXISTS card_copies_owner_idx
  ON public.card_copies (participant_id, event_participant_id);

-- THE ONCE-A-DAY RULE, moved out of a timestamp comparison and into the schema.
--
-- 20260801140000 enforced it by comparing card_pulls.last_pulled_at against
-- current_date, because there was nothing to make unique. There is now, and this
-- is the same shape secret_card_pulls_one_per_day already uses for the daily
-- secret: a replayed pack mints no second copy by construction rather than by
-- arithmetic that has to be got right in every future edit.
CREATE UNIQUE INDEX IF NOT EXISTS card_copies_one_pull_per_day
  ON public.card_copies (participant_id, event_participant_id, acquired_on)
  WHERE source = 'pull';

ALTER TABLE public.card_copies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.card_copies FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.card_copies TO service_role;
-- No policies, on purpose: RLS on with zero policies denies every non-BYPASSRLS
-- role, and the revoked grant denies it a second time. Same shape as card_pulls.

-- NO ALTER PUBLICATION supabase_realtime. Everything 20260728160000 says about
-- publishing card_pulls applies here per copy, which is strictly worse.

-- ============ BACKFILL ============
-- Reconstruct copies for every row written before this table existed.
--
-- ONE copy carries the stored finish and the rest are standard, and that is the
-- honest reconstruction rather than a lossy one: the column only ever recorded the
-- BEST finish a person had pulled, so the finishes of their other copies are
-- genuinely unknown. Giving them all the best one would mint value that was never
-- rolled — and, now that copies are tradeable, value that could be handed to
-- somebody else.
--
-- Guarded by NOT EXISTS rather than a one-shot flag, so replaying this file
-- against a database that already has copies does nothing.
INSERT INTO public.card_copies (participant_id, event_participant_id, edition, source)
SELECT cp.participant_id,
       cp.event_participant_id,
       CASE WHEN g.n = 1 THEN cp.edition ELSE 'standard' END,
       'backfill'
  FROM public.card_pulls cp
  CROSS JOIN LATERAL generate_series(1, cp.pull_count) AS g(n)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.card_copies c
    WHERE c.participant_id = cp.participant_id
      AND c.event_participant_id = cp.event_participant_id);

-- ============ THE DERIVATION ============
-- The only place card_pulls.pull_count and .edition are written from now on.
--
-- One function rather than the same expression in record_card_pulls and
-- accept_trade_offer, because a pull and a trade disagreeing about how many copies
-- somebody holds is exactly the drift this table would otherwise introduce.
CREATE OR REPLACE FUNCTION public.resync_card_pull(
  _participant_id       uuid,
  _event_participant_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n    int;
  _best text;
BEGIN
  SELECT count(*)::int INTO _n
    FROM public.card_copies
   WHERE participant_id = _participant_id
     AND event_participant_id = _event_participant_id;

  -- No copies left: the person does not hold the card at all, so the row goes.
  -- Unreachable through trading, which always leaves the giver at least one copy —
  -- and that is precisely what stops this from ever moving the public count.
  IF _n = 0 THEN
    DELETE FROM public.card_pulls
     WHERE participant_id = _participant_id
       AND event_participant_id = _event_participant_id;
    RETURN;
  END IF;

  -- Best across the copies. An unrecognised value ranks 99 and so loses to any
  -- real finish, which is what lets a corrupt string be displaced rather than
  -- preserved forever — the same argument card_edition_rank was written for.
  SELECT edition INTO _best
    FROM public.card_copies
   WHERE participant_id = _participant_id
     AND event_participant_id = _event_participant_id
   ORDER BY public.card_edition_rank(edition) ASC
   LIMIT 1;

  -- Upsert rather than update: the receiving side of a trade may not hold this
  -- card at all yet, and this is the one place that decides what its row says.
  -- last_pulled_at is deliberately untouched — it is a "when did we last hear
  -- about this" stamp owned by record_card_pulls, not a fact about the copies.
  INSERT INTO public.card_pulls (participant_id, event_participant_id, pull_count, edition)
  VALUES (_participant_id, _event_participant_id, _n, _best)
  ON CONFLICT (participant_id, event_participant_id) DO UPDATE
    SET pull_count = EXCLUDED.pull_count,
        edition    = EXCLUDED.edition;
END;
$$;

REVOKE ALL ON FUNCTION public.resync_card_pull(uuid, uuid) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.resync_card_pull(uuid, uuid) TO service_role;

-- ============ THE WRITE ============
-- Dropped and recreated rather than replaced: the body changes shape, and keeping
-- the 3-arg signature means every existing caller and the DEFAULT NULL on
-- _editions carry on working untouched.
DROP FUNCTION IF EXISTS public.record_card_pulls(uuid, uuid[], text[]);

CREATE OR REPLACE FUNCTION public.record_card_pulls(
  _participant_id        uuid,
  _event_participant_ids uuid[],
  _editions              text[] DEFAULT NULL
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
-- Same zone as the pack drop, the secret drop and trade_item_is_spare. Four daily
-- things now, and they all have to agree about where the day ends.
SET timezone = 'America/New_York'
AS $$
DECLARE
  _n  int;
  _ep record;
BEGIN
  IF _participant_id IS NULL OR _event_participant_ids IS NULL THEN RETURN 0; END IF;

  -- Prove the member exists, so a still-valid token for a deleted participant
  -- returns zero rather than raising a foreign-key error into a call the client
  -- makes fire-and-forget and never surfaces.
  PERFORM 1 FROM public.participants WHERE id = _participant_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- ---- the copies ----
  -- The JOIN is what makes an unknown id harmless: it is dropped rather than
  -- failing the whole batch on a foreign key, so a pack dealt from a bundle that
  -- has since changed still records the cards that are still real.
  --
  -- DISTINCT ON rather than DISTINCT: the same card id can arrive twice carrying
  -- two different finishes, and ON CONFLICT cannot affect the same row twice in
  -- one INSERT. Ordering by rank inside the group keeps the better one.
  INSERT INTO public.card_copies AS cc
    (participant_id, event_participant_id, edition, acquired_on, source)
  SELECT DISTINCT ON (ep.id)
         _participant_id, ep.id, COALESCE(t.edition, 'standard'), current_date, 'pull'
    FROM unnest(_event_participant_ids, _editions) AS t(id, edition)
    JOIN public.event_participants ep ON ep.id = t.id
   ORDER BY ep.id, public.card_edition_rank(t.edition)
  -- Inferred by columns and predicate, never by name: card_copies_one_pull_per_day
  -- is an INDEX rather than a constraint, exactly like its secret-card twin.
  ON CONFLICT (participant_id, event_participant_id, acquired_on) WHERE source = 'pull'
  DO UPDATE
    -- A replay of today's pack does not mint a second copy, but it may carry a
    -- better finish than the one already filed — a client mid-rollout, or a
    -- re-roll. Best wins on the copy itself, which keeps the rule in one place
    -- instead of letting the derived card_pulls row and its copy disagree.
    SET edition = CASE
                    WHEN public.card_edition_rank(EXCLUDED.edition)
                       < public.card_edition_rank(cc.edition)
                    THEN EXCLUDED.edition
                    ELSE cc.edition
                  END;

  -- ---- the ownership row ----
  -- pull_count and edition are deliberately placeholders here: resync_card_pull
  -- below overwrites both from the copies. What this statement is actually for is
  -- the row existing, last_pulled_at moving on EVERY call including a replay, and
  -- the row count the caller uses as the pack's card count.
  INSERT INTO public.card_pulls AS cp (participant_id, event_participant_id)
  SELECT DISTINCT _participant_id, ep.id
    FROM unnest(_event_participant_ids) AS t(id)
    JOIN public.event_participants ep ON ep.id = t.id
  ON CONFLICT (participant_id, event_participant_id) DO UPDATE
    SET last_pulled_at = now();

  GET DIAGNOSTICS _n = ROW_COUNT;

  FOR _ep IN
    SELECT DISTINCT ep.id
      FROM unnest(_event_participant_ids) AS t(id)
      JOIN public.event_participants ep ON ep.id = t.id
  LOOP
    PERFORM public.resync_card_pull(_participant_id, _ep.id);
  END LOOP;

  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.record_card_pulls(uuid, uuid[], text[])
  FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_card_pulls(uuid, uuid[], text[]) TO service_role;
