-- Stop a reload inflating somebody's duplicate count.
--
-- `record_card_pulls` bumped pull_count on every conflict, and the pack screen
-- fires it once per mount for whatever pack is stored — so reopening an
-- already-torn pack, or coming back to the tab, replayed the same three cards and
-- counted each one again. Nothing about the *collection* moved (the composite
-- primary key still caps a person at one row per card), but "Dupes" on the pack
-- stats section reads pull_count, and it climbed every time somebody looked.
--
-- A pack is once a league day, so a card can genuinely be pulled at most once a
-- day. That makes the day the natural idempotency key: the counter moves the
-- first time a card lands and never again until tomorrow, so a real duplicate
-- pulled on a later day still counts and a replay of today's pack does not.
--
-- last_pulled_at still moves on every call. It is a "when did we last hear about
-- this" timestamp rather than a ledger entry, and keeping it fresh is what lets
-- the comparison below work at all.

CREATE OR REPLACE FUNCTION public.record_card_pulls(
  _participant_id        uuid,
  _event_participant_ids uuid[]
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
-- Same zone as the pack drop and the secret drop. Three daily things in this app
-- and they all have to agree about where the day ends.
SET timezone = 'America/New_York'
AS $$
DECLARE _n int;
BEGIN
  IF _participant_id IS NULL OR _event_participant_ids IS NULL THEN RETURN 0; END IF;

  -- Prove the member exists, so a still-valid token for a deleted participant
  -- returns zero rather than raising a foreign-key error into a call the client
  -- makes fire-and-forget and never surfaces.
  PERFORM 1 FROM public.participants WHERE id = _participant_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- The JOIN is what makes an unknown id harmless: it is dropped rather than
  -- failing the whole batch on a foreign key, so a pack dealt from a bundle that
  -- has since changed still records the cards that are still real.
  -- DISTINCT because ON CONFLICT cannot affect the same row twice in one INSERT.
  INSERT INTO public.card_pulls AS cp (participant_id, event_participant_id)
  SELECT DISTINCT _participant_id, ep.id
    FROM unnest(_event_participant_ids) AS t(id)
    JOIN public.event_participants ep ON ep.id = t.id
  ON CONFLICT (participant_id, event_participant_id) DO UPDATE
    SET pull_count = cp.pull_count
                   + CASE
                       -- Already counted today: this is a replay, not a pull.
                       WHEN (cp.last_pulled_at AT TIME ZONE 'America/New_York')::date
                            = current_date THEN 0
                       ELSE 1
                     END,
        last_pulled_at = now();

  -- Still the number of rows the call matched, which is what the caller uses as
  -- the pack's card count. Unchanged by the idempotency above: a replay matches
  -- the same three rows, it just stops counting them twice.
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.record_card_pulls(uuid, uuid[]) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_card_pulls(uuid, uuid[]) TO service_role;
