-- Who has packed which roster card.
--
-- Until now there was no server-side record of a player-card pull at all:
-- collectCard in src/lib/card-collection.ts writes to this device's IndexedDB and
-- nowhere else. This is the league-wide half of that number, and the only thing
-- it exists to answer is "how many people have this card".
--
-- ONE ROW PER PERSON PER CARD, not one row per pull.

CREATE TABLE IF NOT EXISTS public.card_pulls (
  participant_id       uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  event_participant_id uuid NOT NULL REFERENCES public.event_participants(id) ON DELETE CASCADE,
  pull_count           int NOT NULL DEFAULT 1,
  first_pulled_at      timestamptz NOT NULL DEFAULT now(),
  last_pulled_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (participant_id, event_participant_id),
  CONSTRAINT card_pulls_count_positive CHECK (pull_count > 0)
);

COMMENT ON TABLE public.card_pulls IS
  'Which people have packed which roster card. Server-only: the aggregate ("7 people have this card") is public and served by getCardPullCounts, but the per-member rows ("Alice has never packed Bob") are nobody else''s business.';

CREATE INDEX IF NOT EXISTS card_pulls_card_idx ON public.card_pulls (event_participant_id);

ALTER TABLE public.card_pulls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.card_pulls FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.card_pulls TO service_role;

-- ============ THE WRITE ============
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

  PERFORM 1 FROM public.participants WHERE id = _participant_id;
  IF NOT FOUND THEN RETURN 0; END IF;

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

REVOKE ALL ON FUNCTION public.record_card_pulls(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_card_pulls(uuid, uuid[]) TO service_role;