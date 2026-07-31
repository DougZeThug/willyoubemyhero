-- How many packs a person has ripped.
--
-- Nothing has ever recorded this. `card_pulls` answers "how many people have this
-- card" and, incidentally, "which cards do I hold" — but a pack whose three cards
-- were all duplicates writes no new row there, so counting packs from it
-- undercounts the moment the collection fills up. This is the counter's own table.
--
-- ONE ROW PER PERSON PER LEAGUE DAY, because one pack a day is already the rule
-- the pack screen enforces. That makes the primary key the idempotency guarantee:
-- a double tear, a refresh mid-reveal, or a retry after a dropped response all
-- land on the same row, so `count(*)` per person is the honest pack count with
-- nothing to inflate it.

CREATE TABLE IF NOT EXISTS public.pack_opens (
  participant_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  -- The *league* day, not the device's. See the timezone note on record_pack_open.
  opened_on      date NOT NULL,
  -- Nullable and ON DELETE SET NULL: a pack you opened is still a pack you opened
  -- after the event it was dealt from is gone.
  event_id       uuid REFERENCES public.events(id) ON DELETE SET NULL,
  -- How many cards were in that pack. Never used as a denominator; it is here so
  -- "cards seen" is answerable later without a migration, and because a future
  -- change to PACK_SIZE would otherwise be unrecoverable from the data.
  card_count     int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- The primary key IS the one-pack-a-day rule, so there is no surrogate id.
  -- Same reasoning as card_pulls.
  PRIMARY KEY (participant_id, opened_on),
  CONSTRAINT pack_opens_card_count_non_negative CHECK (card_count >= 0)
);

COMMENT ON TABLE public.pack_opens IS
  'One row per person per league day they opened a pack. Server-only: unlike card_pulls there is no public aggregate over this at all — a pack count is shown to the person it belongs to and nobody else.';

ALTER TABLE public.pack_opens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pack_opens FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.pack_opens TO service_role;
-- No policies, on purpose: RLS on with zero policies denies every non-BYPASSRLS
-- role, and the revoked grant denies it a second time. Same shape as card_pulls,
-- award_votes and secret_card_pulls.

-- NO ALTER PUBLICATION supabase_realtime. Publishing this broadcasts every pack
-- open, with the opener's id attached, to every connected phone.

-- ============ THE WRITE ============
CREATE OR REPLACE FUNCTION public.record_pack_open(
  _participant_id uuid,
  _event_id       uuid DEFAULT NULL,
  _card_count     int  DEFAULT 0
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
-- The league day, fixed here rather than taken as a parameter. The secret drop
-- already rolls over on this timezone (see pull_secret_card), so a pack must roll
-- over on the same one or the two daily things in this app disagree about what
-- "today" is. Taking a day key from the client would also let a phone with a wrong
-- clock — or a set one — mint extra packs.
SET timezone = 'America/New_York'
AS $$
DECLARE
  _day date := current_date;
  _n   int;
BEGIN
  IF _participant_id IS NULL THEN RETURN 0; END IF;

  -- Prove the member exists, so a still-valid token for a deleted participant
  -- returns zero rather than raising a foreign-key error into a call the client
  -- makes fire-and-forget and never surfaces. Same guard as record_card_pulls.
  PERFORM 1 FROM public.participants WHERE id = _participant_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  INSERT INTO public.pack_opens AS po (participant_id, opened_on, event_id, card_count)
  VALUES (_participant_id, _day, _event_id, GREATEST(COALESCE(_card_count, 0), 0))
  ON CONFLICT (participant_id, opened_on) DO UPDATE
    -- GREATEST rather than assignment: the reveal-by-reveal retries that reach
    -- here must never shrink a pack that was already recorded in full.
    SET card_count = GREATEST(po.card_count, EXCLUDED.card_count),
        event_id   = COALESCE(po.event_id, EXCLUDED.event_id);

  -- The person's lifetime pack count, so the caller can show the new number
  -- without a second round trip.
  SELECT count(*)::int INTO _n FROM public.pack_opens WHERE participant_id = _participant_id;
  RETURN _n;
END;
$$;

-- Same reasoning as record_card_pulls: a SECURITY DEFINER function keeps
-- Postgres's default EXECUTE TO PUBLIC, and the publishable key ships to every
-- browser. Without these two lines anyone can inflate anyone's pack count.
REVOKE ALL ON FUNCTION public.record_pack_open(uuid, uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_pack_open(uuid, uuid, int) TO service_role;

-- ============ BACKFILL ============
-- Packs opened before this table existed. `recordCardPulls` fires once per tear
-- with that pack's ids, so a distinct first_pulled_at date is a pack open — the
-- one inference available, and an exact one for every pack that contained at
-- least one new card (which, early on, is all of them).
--
-- Deliberately reads the date in the same timezone the RPC writes it in, or a
-- late-evening pack would backfill onto tomorrow and then be counted twice.
-- ON CONFLICT DO NOTHING so this replays: tests/db applies every migration from
-- empty, and a live re-run must not double-count.
INSERT INTO public.pack_opens (participant_id, opened_on, event_id, card_count)
SELECT cp.participant_id,
       (cp.first_pulled_at AT TIME ZONE 'America/New_York')::date,
       -- Any one of the day's events. There is only ever one in practice, and
       -- uuid has no max() to pick with.
       (array_agg(ep.event_id))[1],
       count(*)::int
  FROM public.card_pulls cp
  JOIN public.event_participants ep ON ep.id = cp.event_participant_id
 GROUP BY cp.participant_id, (cp.first_pulled_at AT TIME ZONE 'America/New_York')::date
ON CONFLICT (participant_id, opened_on) DO NOTHING;
