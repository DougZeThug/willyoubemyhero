-- ===================== pack_opens =====================
CREATE TABLE IF NOT EXISTS public.pack_opens (
  participant_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  opened_on      date NOT NULL,
  event_id       uuid REFERENCES public.events(id) ON DELETE SET NULL,
  card_count     int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (participant_id, opened_on),
  CONSTRAINT pack_opens_card_count_non_negative CHECK (card_count >= 0)
);

COMMENT ON TABLE public.pack_opens IS
  'One row per person per league day they opened a pack. Server-only: unlike card_pulls there is no public aggregate over this at all.';

ALTER TABLE public.pack_opens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pack_opens FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.pack_opens TO service_role;
-- No policies, on purpose: RLS on with zero policies denies every non-BYPASSRLS
-- role, and the revoked grant denies it a second time.

CREATE OR REPLACE FUNCTION public.record_pack_open(
  _participant_id uuid,
  _event_id       uuid DEFAULT NULL,
  _card_count     int  DEFAULT 0
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
-- The league day, fixed here rather than taken as a parameter, so the two daily
-- things in this app agree about what "today" is.
SET timezone = 'America/New_York'
AS $$
DECLARE
  _day date := current_date;
  _n   int;
BEGIN
  IF _participant_id IS NULL THEN RETURN 0; END IF;

  PERFORM 1 FROM public.participants WHERE id = _participant_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  INSERT INTO public.pack_opens AS po (participant_id, opened_on, event_id, card_count)
  VALUES (_participant_id, _day, _event_id, GREATEST(COALESCE(_card_count, 0), 0))
  ON CONFLICT (participant_id, opened_on) DO UPDATE
    SET card_count = GREATEST(po.card_count, EXCLUDED.card_count),
        event_id   = COALESCE(po.event_id, EXCLUDED.event_id);

  SELECT count(*)::int INTO _n FROM public.pack_opens WHERE participant_id = _participant_id;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.record_pack_open(uuid, uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_pack_open(uuid, uuid, int) TO service_role;

INSERT INTO public.pack_opens (participant_id, opened_on, event_id, card_count)
SELECT cp.participant_id,
       (cp.first_pulled_at AT TIME ZONE 'America/New_York')::date,
       (array_agg(ep.event_id))[1],
       GREATEST(count(*)::int, 3)
  FROM public.card_pulls cp
  JOIN public.event_participants ep ON ep.id = cp.event_participant_id
 GROUP BY cp.participant_id, (cp.first_pulled_at AT TIME ZONE 'America/New_York')::date
ON CONFLICT (participant_id, opened_on) DO NOTHING;

-- ===================== guest secret pulls =====================
ALTER TABLE public.secret_card_pulls
  ALTER COLUMN participant_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS guest_id uuid;

COMMENT ON COLUMN public.secret_card_pulls.guest_id IS
  'Server-minted, HMAC-signed anonymous identity for a visitor who has not claimed a player. Never accepted from a request payload.';

DO $$ BEGIN
  ALTER TABLE public.secret_card_pulls
    ADD CONSTRAINT secret_card_pulls_identity_ck
    CHECK ((participant_id IS NOT NULL) <> (guest_id IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS secret_card_pulls_guest_one_per_day
  ON public.secret_card_pulls (guest_id, pulled_on)
  WHERE guest_id IS NOT NULL AND NOT granted;

CREATE UNIQUE INDEX IF NOT EXISTS secret_card_pulls_guest_owned_once
  ON public.secret_card_pulls (guest_id, secret_card_id)
  WHERE guest_id IS NOT NULL AND NOT is_duplicate;

-- Dropped rather than overloaded: PostgREST resolves an RPC by argument names.
DROP FUNCTION IF EXISTS public.pull_secret_card(uuid, uuid);

CREATE OR REPLACE FUNCTION public.pull_secret_card(
  _participant_id uuid,
  _guest_id       uuid,
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
  IF (_participant_id IS NULL) = (_guest_id IS NULL) THEN
    RAISE EXCEPTION 'Exactly one of participant or guest is required';
  END IF;

  IF _participant_id IS NOT NULL THEN
    PERFORM 1 FROM public.participants WHERE id = _participant_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Participant not found'; END IF;
  ELSE
    -- A guest has no row to lock, so the serialisation half comes from here.
    PERFORM pg_advisory_xact_lock(hashtextextended(_guest_id::text, 0));
  END IF;

  SELECT * INTO _row FROM public.secret_card_pulls
   WHERE pulled_on = _day AND NOT granted
     AND ((_participant_id IS NOT NULL AND participant_id = _participant_id)
       OR (_guest_id IS NOT NULL AND guest_id = _guest_id));
  IF FOUND THEN
    RETURN jsonb_build_object('pullId', _row.id, 'cardId', _row.secret_card_id,
      'day', _row.pulled_on, 'duplicate', _row.is_duplicate, 'fresh', false);
  END IF;

  SELECT c.id INTO _card FROM public.secret_cards c
   WHERE c.active AND c.art_path IS NOT NULL AND c.weight > 0
     AND NOT EXISTS (SELECT 1 FROM public.secret_card_pulls p
                      WHERE p.secret_card_id = c.id
                        AND NOT p.is_duplicate
                        AND ((_participant_id IS NOT NULL AND p.participant_id = _participant_id)
                          OR (_guest_id IS NOT NULL AND p.guest_id = _guest_id)))
   ORDER BY (-ln(random()) / c.weight) ASC
   LIMIT 1;

  IF _card IS NULL THEN
    SELECT c.id INTO _card FROM public.secret_cards c
     WHERE c.active AND c.art_path IS NOT NULL AND c.weight > 0
     ORDER BY (-ln(random()) / c.weight) ASC
     LIMIT 1;
    _dupe := _card IS NOT NULL;
  END IF;

  IF _card IS NULL THEN RETURN NULL; END IF;

  IF _participant_id IS NOT NULL THEN
    INSERT INTO public.secret_card_pulls
      (participant_id, secret_card_id, pulled_on, event_id, is_duplicate, granted)
    VALUES (_participant_id, _card, _day, _event_id, _dupe, false)
    ON CONFLICT (participant_id, pulled_on) WHERE NOT granted DO NOTHING
    RETURNING * INTO _row;
  ELSE
    INSERT INTO public.secret_card_pulls
      (guest_id, secret_card_id, pulled_on, event_id, is_duplicate, granted)
    VALUES (_guest_id, _card, _day, _event_id, _dupe, false)
    ON CONFLICT (guest_id, pulled_on) WHERE guest_id IS NOT NULL AND NOT granted DO NOTHING
    RETURNING * INTO _row;
  END IF;

  IF _row.id IS NULL THEN
    SELECT * INTO _row FROM public.secret_card_pulls
     WHERE pulled_on = _day AND NOT granted
       AND ((_participant_id IS NOT NULL AND participant_id = _participant_id)
         OR (_guest_id IS NOT NULL AND guest_id = _guest_id));
    RETURN jsonb_build_object('pullId', _row.id, 'cardId', _row.secret_card_id,
      'day', _row.pulled_on, 'duplicate', _row.is_duplicate, 'fresh', false);
  END IF;

  RETURN jsonb_build_object('pullId', _row.id, 'cardId', _row.secret_card_id,
    'day', _row.pulled_on, 'duplicate', _row.is_duplicate, 'fresh', true);
END;
$$;

REVOKE ALL ON FUNCTION public.pull_secret_card(uuid, uuid, uuid) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.pull_secret_card(uuid, uuid, uuid) TO service_role;

DROP FUNCTION IF EXISTS public.secret_pull_status(uuid);

CREATE OR REPLACE FUNCTION public.secret_pull_status(
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
    'pulledToday', EXISTS (
      SELECT 1 FROM public.secret_card_pulls
       WHERE pulled_on = _day
         AND ((_participant_id IS NOT NULL AND participant_id = _participant_id)
           OR (_guest_id IS NOT NULL AND guest_id = _guest_id))),
    'pulled', (
      SELECT count(*) FROM public.secret_card_pulls
       WHERE NOT is_duplicate
         AND ((_participant_id IS NOT NULL AND participant_id = _participant_id)
           OR (_guest_id IS NOT NULL AND guest_id = _guest_id))),
    'available', EXISTS (SELECT 1 FROM public.secret_cards
                          WHERE active AND art_path IS NOT NULL),
    'resetsAt', ((_day + 1)::timestamp AT TIME ZONE current_setting('TimeZone'))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.secret_pull_status(uuid, uuid) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.secret_pull_status(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_guest_secrets(
  _participant_id uuid,
  _guest_id       uuid
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _n int;
BEGIN
  IF _participant_id IS NULL OR _guest_id IS NULL THEN RETURN 0; END IF;

  PERFORM 1 FROM public.participants WHERE id = _participant_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  DELETE FROM public.secret_card_pulls g
   WHERE g.guest_id = _guest_id
     AND EXISTS (SELECT 1 FROM public.secret_card_pulls m
                  WHERE m.participant_id = _participant_id
                    AND m.pulled_on = g.pulled_on
                    AND NOT m.granted);

  UPDATE public.secret_card_pulls g
     SET is_duplicate = true
   WHERE g.guest_id = _guest_id
     AND NOT g.is_duplicate
     AND EXISTS (SELECT 1 FROM public.secret_card_pulls m
                  WHERE m.participant_id = _participant_id
                    AND m.secret_card_id = g.secret_card_id
                    AND NOT m.is_duplicate);

  UPDATE public.secret_card_pulls
     SET participant_id = _participant_id, guest_id = NULL
   WHERE guest_id = _guest_id;

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_guest_secrets(uuid, uuid) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_guest_secrets(uuid, uuid) TO service_role;

-- ===================== card_pulls once a day =====================
CREATE OR REPLACE FUNCTION public.record_card_pulls(
  _participant_id        uuid,
  _event_participant_ids uuid[]
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET timezone = 'America/New_York'
AS $$
DECLARE _n int;
BEGIN
  IF _participant_id IS NULL OR _event_participant_ids IS NULL THEN RETURN 0; END IF;

  PERFORM 1 FROM public.participants WHERE id = _participant_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  INSERT INTO public.card_pulls AS cp (participant_id, event_participant_id)
  SELECT DISTINCT _participant_id, ep.id
    FROM unnest(_event_participant_ids) AS t(id)
    JOIN public.event_participants ep ON ep.id = t.id
  ON CONFLICT (participant_id, event_participant_id) DO UPDATE
    SET pull_count = cp.pull_count
                   + CASE
                       WHEN (cp.last_pulled_at AT TIME ZONE 'America/New_York')::date
                            = current_date THEN 0
                       ELSE 1
                     END,
        last_pulled_at = now();

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.record_card_pulls(uuid, uuid[]) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_card_pulls(uuid, uuid[]) TO service_role;
