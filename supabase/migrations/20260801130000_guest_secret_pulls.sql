-- Let a guest own a secret card.
--
-- Until now the daily drop needed a claimed player: participant_id was NOT NULL
-- and both uniqueness rules keyed on it, so an unclaimed visitor got a lock icon
-- and a link to /claim. Guests are in the garden holding a beer too.
--
-- Shape copied from 20260728230717, which did the same thing for reactions and
-- comments: nullable participant_id, a guest column, a CHECK that exactly one is
-- set, and a partial unique index for the guest side.
--
-- WHAT IS DELIBERATELY *NOT* REUSED: card_reactions.guest_key. That key is minted
-- in the browser and sent unsigned, which is fine for a 🔥 on somebody's card and
-- not fine here — anyone could name somebody else's key and spend their pull.
-- guest_id is fed only from a `g.` token this server minted and signed (see
-- signGuestToken / startGuestSession). Do not merge the two columns.
--
-- KNOWN AND ACCEPTED: a guest who clears site data loses the token, and the next
-- visit mints a fresh id with a fresh daily pull. Nothing server-side can tell
-- that apart from a genuinely new phone. Closing it needs a signal this app does
-- not have, and for a thirteen-person party the honest answer is that nobody is
-- going to clear their browser to farm a joke card.

ALTER TABLE public.secret_card_pulls
  ALTER COLUMN participant_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS guest_id uuid;

COMMENT ON COLUMN public.secret_card_pulls.guest_id IS
  'Server-minted, HMAC-signed anonymous identity for a visitor who has not claimed a player. Never accepted from a request payload — unlike card_reactions.guest_key, which is client-minted and unsigned.';

DO $$ BEGIN
  ALTER TABLE public.secret_card_pulls
    ADD CONSTRAINT secret_card_pulls_identity_ck
    CHECK ((participant_id IS NOT NULL) <> (guest_id IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The two member indexes are left exactly as they are. Nulls do not collide in a
-- unique index, so guest rows (participant_id NULL) simply never meet them —
-- the same reasoning 20260728230717 gives for leaving the member reaction index
-- alone. These two are the guest mirrors.
CREATE UNIQUE INDEX IF NOT EXISTS secret_card_pulls_guest_one_per_day
  ON public.secret_card_pulls (guest_id, pulled_on)
  WHERE guest_id IS NOT NULL AND NOT granted;

CREATE UNIQUE INDEX IF NOT EXISTS secret_card_pulls_guest_owned_once
  ON public.secret_card_pulls (guest_id, secret_card_id)
  WHERE guest_id IS NOT NULL AND NOT is_duplicate;

-- ============ THE PULL ============
-- Dropped rather than overloaded: PostgREST resolves an RPC by argument names,
-- and leaving a 2-arg and a 3-arg version side by side is a resolution hazard
-- rather than a convenience.
DROP FUNCTION IF EXISTS public.pull_secret_card(uuid, uuid);

CREATE OR REPLACE FUNCTION public.pull_secret_card(
  _participant_id uuid,
  _guest_id       uuid,
  _event_id       uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
-- The zone is baked in rather than passed as an argument: a caller-chosen zone
-- can shift the day boundary by 26 hours and farm two cards across one wall-clock
-- day. Unchanged from the member-only version.
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
    -- Does double duty: proves the member exists, and serialises their concurrent
    -- pulls so a double-tap cannot race itself into two cards.
    PERFORM 1 FROM public.participants WHERE id = _participant_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Participant not found'; END IF;
  ELSE
    -- A guest has no row to lock, so the serialisation half has to come from
    -- somewhere. Without this the unique index is the only thing left, and the
    -- loser of a race gets an error instead of a card.
    PERFORM pg_advisory_xact_lock(hashtextextended(_guest_id::text, 0));
  END IF;

  -- Spent today already? Return the same card (double-tap safety).
  -- Written as two guarded halves rather than `participant_id = _participant_id
  -- OR guest_id = _guest_id`: with one of them null that reads as NULL rather
  -- than false, which is correct but far too subtle to leave for the next reader.
  SELECT * INTO _row FROM public.secret_card_pulls
   WHERE pulled_on = _day AND NOT granted
     AND ((_participant_id IS NOT NULL AND participant_id = _participant_id)
       OR (_guest_id IS NOT NULL AND guest_id = _guest_id));
  IF FOUND THEN
    RETURN jsonb_build_object('pullId', _row.id, 'cardId', _row.secret_card_id,
      'day', _row.pulled_on, 'duplicate', _row.is_duplicate, 'fresh', false);
  END IF;

  -- First pass: cards this owner has NOT owned yet, weighted.
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
    -- Every pullable card already owned: duplicate, still weighted.
    SELECT c.id INTO _card FROM public.secret_cards c
     WHERE c.active AND c.art_path IS NOT NULL AND c.weight > 0
     ORDER BY (-ln(random()) / c.weight) ASC
     LIMIT 1;
    _dupe := _card IS NOT NULL;
  END IF;

  IF _card IS NULL THEN RETURN NULL; END IF;

  -- Two inserts rather than one, because the conflict target differs: a single
  -- statement cannot infer against both partial indexes.
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

  -- The loser of a race gets a card, not an error.
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

-- ============ THE STATUS ============
DROP FUNCTION IF EXISTS public.secret_pull_status(uuid);

CREATE OR REPLACE FUNCTION public.secret_pull_status(
  _participant_id uuid,
  _guest_id       uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
-- Must match pull_secret_card, or the screen and the write disagree about what
-- day it is.
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
    -- Only ever "there is something to pull", never how much.
    'available', EXISTS (SELECT 1 FROM public.secret_cards
                          WHERE active AND art_path IS NOT NULL),
    'resetsAt', ((_day + 1)::timestamp AT TIME ZONE current_setting('TimeZone'))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.secret_pull_status(uuid, uuid) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.secret_pull_status(uuid, uuid) TO service_role;

-- ============ CLAIMING ============
-- Carry a guest's secrets onto the player they just claimed.
--
-- Without this, pulling a card as a guest and then claiming loses it, which
-- defeats the point of letting guests pull at all. Called from claimPlayer, and
-- deliberately tolerant: it must never be the reason a claim fails.
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

  -- A day the member already spent themselves. Their own row is the one that
  -- counts — it is the one attached to the name the cards live on.
  DELETE FROM public.secret_card_pulls g
   WHERE g.guest_id = _guest_id
     AND EXISTS (SELECT 1 FROM public.secret_card_pulls m
                  WHERE m.participant_id = _participant_id
                    AND m.pulled_on = g.pulled_on
                    AND NOT m.granted);

  -- A card the member already owns arrives as a duplicate rather than a second
  -- ownership row, which is what secret_card_pulls_owned_once requires.
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
