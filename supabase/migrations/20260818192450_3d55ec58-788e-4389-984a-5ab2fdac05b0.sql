-- Cards packed before a phone knew who it was.
--
-- Secret cards already survive a claim: they are stored server-side against a
-- guest id and claim_guest_secrets moves them. Roster cards do not — a guest's
-- pack tear writes nothing at all (recordCardPulls no-ops without a member), so
-- the collection lives only in that phone's IndexedDB. The moment a code is
-- redeemed, mergeCollection treats card_pulls as the truth and forgetCards
-- deletes everything the server cannot vouch for, which is exactly that
-- collection. This migration gives those cards somewhere to land.

-- ============ SOURCES ============
-- 'adopt': a copy filed from a phone's local collection at claim time.
-- 'grant': a copy handed over by the commissioner.
-- Neither is a pull, so neither carries an acquired_on and neither can ever meet
-- card_copies_one_pull_per_day.
ALTER TABLE public.card_copies DROP CONSTRAINT IF EXISTS card_copies_source_ck;
ALTER TABLE public.card_copies ADD CONSTRAINT card_copies_source_ck
  CHECK (source IN ('pull', 'trade', 'backfill', 'adopt', 'grant'));

-- ============ ADOPT ============
-- File the cards this phone already holds against the person who just claimed.
--
-- ONE COPY PER CARD THEY DO NOT ALREADY HOLD, and never a second copy of one
-- they do. A local row records "I hold this card", not a ledger of copies, so
-- trusting its count would let a device mint duplicates on every claim. A person
-- re-claiming on the same handset therefore adopts nothing the second time,
-- which is what makes this safe to call on every claim.
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

  PERFORM 1 FROM public.participants WHERE id = _participant_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- The JOIN drops ids that are not real roster cards, the same way
  -- record_card_pulls does: an unknown id is skipped rather than failing the
  -- whole adoption. DISTINCT ON keeps the better finish when one card arrives
  -- twice.
  INSERT INTO public.card_copies
    (participant_id, event_participant_id, edition, acquired_on, source)
  SELECT DISTINCT ON (ep.id)
         _participant_id, ep.id, COALESCE(t.edition, 'standard'), NULL, 'adopt'
    FROM unnest(_event_participant_ids, _editions) AS t(id, edition)
    JOIN public.event_participants ep ON ep.id = t.id
   WHERE NOT EXISTS (
     SELECT 1 FROM public.card_copies c
      WHERE c.participant_id = _participant_id
        AND c.event_participant_id = ep.id)
   ORDER BY ep.id, public.card_edition_rank(t.edition);

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

REVOKE ALL ON FUNCTION public.adopt_card_copies(uuid, uuid[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adopt_card_copies(uuid, uuid[], text[]) TO service_role;

-- ============ GRANT ============
-- The commissioner hands somebody a card. Deliberately unconditional: this is the
-- repair tool for a collection that was lost, so it may well be a card they
-- already hold.
CREATE OR REPLACE FUNCTION public.grant_card_copy(
  _participant_id       uuid,
  _event_participant_id uuid,
  _edition              text DEFAULT 'standard'
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _n int;
BEGIN
  PERFORM 1 FROM public.participants WHERE id = _participant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Participant not found'; END IF;
  PERFORM 1 FROM public.event_participants WHERE id = _event_participant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Card not found'; END IF;

  INSERT INTO public.card_copies
    (participant_id, event_participant_id, edition, acquired_on, source)
  VALUES (_participant_id, _event_participant_id,
          COALESCE(_edition, 'standard'), NULL, 'grant');

  PERFORM public.resync_card_pull(_participant_id, _event_participant_id);

  SELECT count(*)::int INTO _n FROM public.card_copies
   WHERE participant_id = _participant_id
     AND event_participant_id = _event_participant_id;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_card_copy(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_card_copy(uuid, uuid, text) TO service_role;

-- ============ GUEST PACK OPENS ============
-- A guest's pack currently records nothing, so their pack count restarts at zero
-- on the day they claim. Same shape secret_card_pulls already uses: exactly one
-- of participant_id / guest_id, and a partial unique index per identity keeping
-- the one-pack-a-day rule on both sides.
ALTER TABLE public.pack_opens ADD COLUMN IF NOT EXISTS guest_id uuid;
ALTER TABLE public.pack_opens DROP CONSTRAINT IF EXISTS pack_opens_pkey;
ALTER TABLE public.pack_opens ALTER COLUMN participant_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pack_opens_one_per_day
  ON public.pack_opens (participant_id, opened_on)
  WHERE participant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pack_opens_guest_one_per_day
  ON public.pack_opens (guest_id, opened_on)
  WHERE guest_id IS NOT NULL;

ALTER TABLE public.pack_opens DROP CONSTRAINT IF EXISTS pack_opens_one_identity;
ALTER TABLE public.pack_opens ADD CONSTRAINT pack_opens_one_identity
  CHECK ((participant_id IS NULL) <> (guest_id IS NULL));

CREATE OR REPLACE FUNCTION public.record_pack_open(
  _participant_id uuid,
  _event_id       uuid DEFAULT NULL,
  _card_count     int  DEFAULT 0,
  _guest_id       uuid DEFAULT NULL
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET timezone = 'America/New_York'
AS $$
DECLARE
  _day date := current_date;
  _n   int;
BEGIN
  -- A member wins over a guest id the same request happens to carry: the phone
  -- keeps its guest token after a claim, and the pack belongs to the person.
  IF _participant_id IS NOT NULL THEN
    PERFORM 1 FROM public.participants WHERE id = _participant_id;
    IF NOT FOUND THEN RETURN 0; END IF;

    INSERT INTO public.pack_opens AS po (participant_id, opened_on, event_id, card_count)
    VALUES (_participant_id, _day, _event_id, GREATEST(COALESCE(_card_count, 0), 0))
    ON CONFLICT (participant_id, opened_on) WHERE participant_id IS NOT NULL DO UPDATE
      SET card_count = GREATEST(po.card_count, EXCLUDED.card_count),
          event_id   = COALESCE(po.event_id, EXCLUDED.event_id);

    SELECT count(*)::int INTO _n FROM public.pack_opens
     WHERE participant_id = _participant_id;
    RETURN _n;
  END IF;

  IF _guest_id IS NULL THEN RETURN 0; END IF;

  INSERT INTO public.pack_opens AS po (guest_id, opened_on, event_id, card_count)
  VALUES (_guest_id, _day, _event_id, GREATEST(COALESCE(_card_count, 0), 0))
  ON CONFLICT (guest_id, opened_on) WHERE guest_id IS NOT NULL DO UPDATE
    SET card_count = GREATEST(po.card_count, EXCLUDED.card_count),
        event_id   = COALESCE(po.event_id, EXCLUDED.event_id);

  SELECT count(*)::int INTO _n FROM public.pack_opens WHERE guest_id = _guest_id;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.record_pack_open(uuid, uuid, int, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_pack_open(uuid, uuid, int, uuid) TO service_role;

-- Move a guest's packs onto the player who just claimed. A day the member
-- already has a pack for is dropped rather than merged: one pack per person per
-- day is the rule the whole table exists to enforce.
CREATE OR REPLACE FUNCTION public.claim_guest_packs(
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

  DELETE FROM public.pack_opens g
   WHERE g.guest_id = _guest_id
     AND EXISTS (SELECT 1 FROM public.pack_opens m
                  WHERE m.participant_id = _participant_id
                    AND m.opened_on = g.opened_on);

  UPDATE public.pack_opens
     SET participant_id = _participant_id, guest_id = NULL
   WHERE guest_id = _guest_id;

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_guest_packs(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_guest_packs(uuid, uuid) TO service_role;