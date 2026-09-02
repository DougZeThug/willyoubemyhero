-- Adoption was the one unrationed mint left in the economy.
--
-- adopt_card_copies files the roster cards a phone packed as a guest against the
-- member it has just become. It was written before copies were currency, and
-- three things about it stopped being safe the day the dust ledger landed:
--
--   1. It took the finish from the phone. An `adopt` copy is `edition_asserted_by
--      = 'client'` and mills for the flat floor, but `card_pulls.edition` is
--      derived from the copies and every screen — the vault, a counterparty's
--      spares, the marketplace — dressed the card in whatever the request said.
--   2. It held no lock. The guard was NOT EXISTS over card_copies, so N calls in
--      flight at once each read an empty table and each filed a copy, and N-1 of
--      every card were millable spares.
--   3. It joined event_participants by id alone, so any event's roster was
--      adoptable, and it ran on every sign-in from a store the phone owns.
--
-- The repair keeps the honest path exactly as it was — one standard copy of each
-- active-roster card the person does not already hold — and makes every other
-- path a no-op.

-- ============ THE LEDGER ============
-- Each (person, card) pair is CONSIDERED for adoption exactly once, ever. That is
-- the rule the old NOT EXISTS could not express: a copy that was milled or traded
-- away is gone from card_copies, so "no copy held" was true again and the next
-- sign-in filed a fresh one. Append-only, same shape as card_mints and for the
-- same reason — a budget over mutable ownership is one that anything moving a
-- copy reopens.
CREATE TABLE IF NOT EXISTS public.card_adoptions (
  participant_id       uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  event_participant_id uuid NOT NULL REFERENCES public.event_participants(id) ON DELETE CASCADE,
  adopted_on           date NOT NULL DEFAULT current_date,
  PRIMARY KEY (participant_id, event_participant_id)
);

COMMENT ON TABLE public.card_adoptions IS
  'Every (person, roster card) pair adopt_card_copies has ever considered. Server-only. A pair here is never adopted again, whatever the phone holds.';

ALTER TABLE public.card_adoptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.card_adoptions FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.card_adoptions TO service_role;

-- Every adopt copy that already exists was an adoption; record it so the rule
-- holds for people who claimed before this landed. created_at is the closest
-- thing to the day it happened.
--
-- Best effort, and knowingly so. An adopt copy milled before today is gone, and
-- one traded away is now somebody else's 'trade' row indistinguishable from a
-- traded pull, so neither can be recovered here. The residual is one further
-- standard copy per such pair, once, reachable only from a doctored store —
-- after which the ledger holds. A heuristic reconstruction would also record
-- adoptions that never happened, which is the worse error.
INSERT INTO public.card_adoptions (participant_id, event_participant_id, adopted_on)
SELECT DISTINCT ON (participant_id, event_participant_id)
       participant_id, event_participant_id, created_at::date
  FROM public.card_copies
 WHERE source = 'adopt'
 ORDER BY participant_id, event_participant_id, created_at
ON CONFLICT DO NOTHING;

-- ============ ADOPT ============
-- Same signature, so a phone holding a cached bundle from before this keeps
-- resolving. `_editions` is accepted and ignored, exactly as record_card_pulls
-- treats its own: the parameter is a shape, not an input.
CREATE OR REPLACE FUNCTION public.adopt_card_copies(
  _participant_id        uuid,
  _event_participant_ids uuid[],
  _editions              text[] DEFAULT NULL
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n  int := 0;
  _ep record;
BEGIN
  IF _participant_id IS NULL OR _event_participant_ids IS NULL THEN RETURN 0; END IF;

  -- Two sign-ins racing on one account are settled by the ledger's primary key
  -- below either way. The lock is for the other writers that hold this row —
  -- record_card_pulls and mill_card_copy — so the "no copy held yet" read cannot
  -- interleave with a pack landing or a copy leaving.
  PERFORM 1 FROM public.participants WHERE id = _participant_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- Active roster only. A guest's pack is dealt from the live event's roster and
  -- nothing else, so an id from another event is not a card this phone could
  -- honestly hold — it is skipped, the same way an unknown id is.
  WITH wanted AS (
    SELECT DISTINCT ep.id
      FROM unnest(_event_participant_ids) AS t(id)
      JOIN public.event_participants ep ON ep.id = t.id
      JOIN public.events e ON e.id = ep.event_id AND e.active
  ),
  -- Noted before filing, and noted even for a card they already hold: the
  -- ledger says "this pair has been through adoption", not "a copy was filed".
  noted AS (
    INSERT INTO public.card_adoptions (participant_id, event_participant_id)
    SELECT _participant_id, id FROM wanted
    ON CONFLICT DO NOTHING
    RETURNING event_participant_id
  )
  INSERT INTO public.card_copies
    (participant_id, event_participant_id, edition, acquired_on, source, edition_asserted_by)
  SELECT _participant_id, n.event_participant_id, 'standard', NULL, 'adopt', 'client'
    FROM noted n
   WHERE NOT EXISTS (
     SELECT 1 FROM public.card_copies c
      WHERE c.participant_id = _participant_id
        AND c.event_participant_id = n.event_participant_id);

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

REVOKE ALL ON FUNCTION public.adopt_card_copies(uuid, uuid[], text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adopt_card_copies(uuid, uuid[], text[]) TO service_role;
