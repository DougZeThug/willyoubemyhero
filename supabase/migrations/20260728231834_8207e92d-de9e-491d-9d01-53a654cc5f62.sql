-- Per-card weight for the daily secret pull.
-- Default 100 keeps existing cards at uniform odds after migration (all equal weight = uniform).
ALTER TABLE public.secret_cards
  ADD COLUMN IF NOT EXISTS weight integer NOT NULL DEFAULT 100
    CHECK (weight >= 0 AND weight <= 10000);

COMMENT ON COLUMN public.secret_cards.weight IS
  'Relative pull weight. 0 removes a card from the daily draw entirely without retiring it. Compared as a ratio: 200 vs 100 means twice as likely.';

-- Admin-granted pulls are marked so they do NOT collide with the once-per-day
-- unique index. A granted row is still a real ledger entry (ownership, dupes),
-- but it does not consume today's slot and today's random pull can still happen.
ALTER TABLE public.secret_card_pulls
  ADD COLUMN IF NOT EXISTS granted boolean NOT NULL DEFAULT false;

-- Rebuild the one-per-day index to exclude granted rows.
DROP INDEX IF EXISTS public.secret_card_pulls_one_per_day;
CREATE UNIQUE INDEX IF NOT EXISTS secret_card_pulls_one_per_day
  ON public.secret_card_pulls (participant_id, pulled_on)
  WHERE NOT granted;

-- Weighted daily pull.
--
-- Efraimidis-Spirakis: for each candidate, key = -ln(random()) / weight, take
-- the row with the smallest key. Correct weighted sampling without a running
-- CTE, and identical to the previous behaviour when every weight is equal.
-- Weight 0 rows are excluded up front, so they never appear even as duplicates.
CREATE OR REPLACE FUNCTION public.pull_secret_card(
  _participant_id uuid,
  _event_id       uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET timezone = 'America/New_York'
AS $$
DECLARE
  _day  date := current_date;
  _card uuid;
  _dupe boolean := false;
  _row  public.secret_card_pulls;
BEGIN
  PERFORM 1 FROM public.participants WHERE id = _participant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Participant not found'; END IF;

  -- Spent today already? Return the same card (double-tap safety).
  SELECT * INTO _row FROM public.secret_card_pulls
   WHERE participant_id = _participant_id AND pulled_on = _day AND NOT granted;
  IF FOUND THEN
    RETURN jsonb_build_object('pullId', _row.id, 'cardId', _row.secret_card_id,
      'day', _row.pulled_on, 'duplicate', _row.is_duplicate, 'fresh', false);
  END IF;

  -- First pass: cards this member has NOT owned yet, weighted.
  SELECT c.id INTO _card FROM public.secret_cards c
   WHERE c.active AND c.art_path IS NOT NULL AND c.weight > 0
     AND NOT EXISTS (SELECT 1 FROM public.secret_card_pulls p
                      WHERE p.participant_id = _participant_id
                        AND p.secret_card_id = c.id
                        AND NOT p.is_duplicate)
   ORDER BY (-ln(random()) / c.weight) ASC
   LIMIT 1;

  IF _card IS NULL THEN
    -- Every pullable card already owned: duplicate, still weighted.
    SELECT c.id INTO _card FROM public.secret_cards c
     WHERE c.active AND c.art_path IS NOT NULL AND c.weight > 0
     ORDER BY (-ln(random()) / c.weight) ASC
     LIMIT 1;
    _dupe := _card IS NOT NULL;
  END IF;

  IF _card IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.secret_card_pulls
    (participant_id, secret_card_id, pulled_on, event_id, is_duplicate, granted)
  VALUES (_participant_id, _card, _day, _event_id, _dupe, false)
  ON CONFLICT (participant_id, pulled_on) WHERE NOT granted DO NOTHING
  RETURNING * INTO _row;

  IF _row.id IS NULL THEN
    SELECT * INTO _row FROM public.secret_card_pulls
     WHERE participant_id = _participant_id AND pulled_on = _day AND NOT granted;
    RETURN jsonb_build_object('pullId', _row.id, 'cardId', _row.secret_card_id,
      'day', _row.pulled_on, 'duplicate', _row.is_duplicate, 'fresh', false);
  END IF;

  RETURN jsonb_build_object('pullId', _row.id, 'cardId', _row.secret_card_id,
    'day', _row.pulled_on, 'duplicate', _row.is_duplicate, 'fresh', true);
END;
$$;

REVOKE ALL ON FUNCTION public.pull_secret_card(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pull_secret_card(uuid, uuid) TO service_role;

-- Admin: hand a specific secret card to a participant.
--
-- Marked `granted = true`, so it never conflicts with today's daily slot and
-- never consumes it. Ownership rule (secret_card_pulls_owned_once) still
-- applies: if the participant already owns the card, this records a duplicate
-- instead of a second ownership row.
CREATE OR REPLACE FUNCTION public.grant_secret_card(
  _participant_id uuid,
  _secret_card_id uuid,
  _event_id       uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET timezone = 'America/New_York'
AS $$
DECLARE
  _day       date := current_date;
  _already   boolean;
  _row       public.secret_card_pulls;
BEGIN
  PERFORM 1 FROM public.participants WHERE id = _participant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Participant not found'; END IF;

  PERFORM 1 FROM public.secret_cards WHERE id = _secret_card_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Card not found'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.secret_card_pulls
     WHERE participant_id = _participant_id
       AND secret_card_id = _secret_card_id
       AND NOT is_duplicate
  ) INTO _already;

  INSERT INTO public.secret_card_pulls
    (participant_id, secret_card_id, pulled_on, event_id, is_duplicate, granted)
  VALUES (_participant_id, _secret_card_id, _day, _event_id, _already, true)
  RETURNING * INTO _row;

  RETURN jsonb_build_object(
    'pullId', _row.id,
    'cardId', _row.secret_card_id,
    'day', _row.pulled_on,
    'duplicate', _row.is_duplicate,
    'granted', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.grant_secret_card(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_secret_card(uuid, uuid, uuid) TO service_role;