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
  flavour    text,
  foil       text NOT NULL DEFAULT 'rosette',
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

CREATE OR REPLACE TRIGGER secret_cards_updated
  BEFORE UPDATE ON public.secret_cards
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ PULL LEDGER ============
CREATE TABLE IF NOT EXISTS public.secret_card_pulls (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  secret_card_id uuid NOT NULL REFERENCES public.secret_cards(id) ON DELETE RESTRICT,
  pulled_on      date NOT NULL,
  event_id       uuid REFERENCES public.events(id) ON DELETE SET NULL,
  is_duplicate   boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.secret_card_pulls IS
  'Who pulled which secret card, and on which league day. Readable by anon this would be worse than the catalogue: it leaks card ids, who owns what, and the set size from a row count against the roster.';

CREATE UNIQUE INDEX IF NOT EXISTS secret_card_pulls_one_per_day
  ON public.secret_card_pulls (participant_id, pulled_on);

CREATE UNIQUE INDEX IF NOT EXISTS secret_card_pulls_owned_once
  ON public.secret_card_pulls (participant_id, secret_card_id)
  WHERE NOT is_duplicate;

CREATE INDEX IF NOT EXISTS secret_card_pulls_card_idx
  ON public.secret_card_pulls (secret_card_id);

ALTER TABLE public.secret_card_pulls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.secret_card_pulls FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.secret_card_pulls TO service_role;

-- ============ ONE ACTIVE EVENT ============
CREATE UNIQUE INDEX IF NOT EXISTS events_one_active
  ON public.events (active) WHERE active;

-- ============ THE DAILY PULL ============
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

  SELECT * INTO _row FROM public.secret_card_pulls
   WHERE participant_id = _participant_id AND pulled_on = _day;
  IF FOUND THEN
    RETURN jsonb_build_object('pullId', _row.id, 'cardId', _row.secret_card_id,
      'day', _row.pulled_on, 'duplicate', _row.is_duplicate, 'fresh', false);
  END IF;

  SELECT c.id INTO _card FROM public.secret_cards c
   WHERE c.active AND c.art_path IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.secret_card_pulls p
                      WHERE p.participant_id = _participant_id
                        AND p.secret_card_id = c.id)
   ORDER BY random() LIMIT 1;

  IF _card IS NULL THEN
    SELECT c.id INTO _card FROM public.secret_cards c
     WHERE c.active AND c.art_path IS NOT NULL ORDER BY random() LIMIT 1;
    _dupe := _card IS NOT NULL;
  END IF;

  IF _card IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.secret_card_pulls
    (participant_id, secret_card_id, pulled_on, event_id, is_duplicate)
  VALUES (_participant_id, _card, _day, _event_id, _dupe)
  ON CONFLICT (participant_id, pulled_on) DO NOTHING
  RETURNING * INTO _row;

  IF _row.id IS NULL THEN
    SELECT * INTO _row FROM public.secret_card_pulls
     WHERE participant_id = _participant_id AND pulled_on = _day;
    RETURN jsonb_build_object('pullId', _row.id, 'cardId', _row.secret_card_id,
      'day', _row.pulled_on, 'duplicate', _row.is_duplicate, 'fresh', false);
  END IF;

  RETURN jsonb_build_object('pullId', _row.id, 'cardId', _row.secret_card_id,
    'day', _row.pulled_on, 'duplicate', _row.is_duplicate, 'fresh', true);
END;
$$;

REVOKE ALL ON FUNCTION public.pull_secret_card(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pull_secret_card(uuid, uuid) TO service_role;

-- ============ STATUS (pure read) ============
CREATE OR REPLACE FUNCTION public.secret_pull_status(_participant_id uuid)
RETURNS jsonb
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
    'pulledToday', EXISTS (SELECT 1 FROM public.secret_card_pulls
                            WHERE participant_id = _participant_id AND pulled_on = _day),
    'pulled', (SELECT count(*) FROM public.secret_card_pulls
                WHERE participant_id = _participant_id AND NOT is_duplicate),
    'available', EXISTS (SELECT 1 FROM public.secret_cards
                          WHERE active AND art_path IS NOT NULL),
    'resetsAt', ((_day + 1)::timestamp AT TIME ZONE current_setting('TimeZone'))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.secret_pull_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.secret_pull_status(uuid) TO service_role;