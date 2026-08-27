-- Serialise guest-identity merges with claim_streak_milestone.
--
-- claim_streak_milestone holds pg_advisory_xact_lock(hashtextextended(guest_id, 0))
-- for the whole of a guest claim, but the four merge functions that re-parent
-- that same guest's pack_opens / streak_milestone_claims rows never took it.
-- Under READ COMMITTED a merge could commit between the claim's streak read
-- and its INSERT, leaving a claim row on the dead guest id that the merge's
-- reparenting UPDATE had already passed over. The per-identity partial unique
-- indexes (participant-only and guest-only) don't see across the boundary, so
-- the milestone then pays twice. Taking the same lock here makes claim and
-- merge mutually exclusive.

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

  PERFORM pg_advisory_xact_lock(hashtextextended(_guest_id::text, 0));

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

REVOKE ALL ON FUNCTION public.claim_guest_packs(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_guest_packs(uuid, uuid) TO service_role;

-- Guest -> guest: a claim can be in flight on EITHER side, so both locks are
-- taken, in text order, or two opposing merges deadlock.
CREATE OR REPLACE FUNCTION public.merge_guest_packs(
  _into_guest uuid,
  _from_guest uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _n integer;
BEGIN
  IF _into_guest IS NULL OR _from_guest IS NULL OR _into_guest = _from_guest THEN
    RETURN 0;
  END IF;

  IF _into_guest::text < _from_guest::text THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(_into_guest::text, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended(_from_guest::text, 0));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended(_from_guest::text, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended(_into_guest::text, 0));
  END IF;

  DELETE FROM public.pack_opens source
   WHERE source.guest_id = _from_guest
     AND EXISTS (
       SELECT 1
         FROM public.pack_opens destination
        WHERE destination.guest_id = _into_guest
          AND destination.opened_on = source.opened_on
     );

  UPDATE public.pack_opens
     SET guest_id = _into_guest
   WHERE guest_id = _from_guest;

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_guest_packs(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_guest_packs(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_guest_streak_milestones(
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

  PERFORM pg_advisory_xact_lock(hashtextextended(_guest_id::text, 0));

  PERFORM 1 FROM public.participants WHERE id = _participant_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  DELETE FROM public.streak_milestone_claims g
   WHERE g.guest_id = _guest_id
     AND EXISTS (SELECT 1 FROM public.streak_milestone_claims m
                  WHERE m.participant_id = _participant_id
                    AND m.streak_started_on = g.streak_started_on
                    AND m.milestone = g.milestone);

  UPDATE public.streak_milestone_claims
     SET participant_id = _participant_id, guest_id = NULL
   WHERE guest_id = _guest_id;

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_guest_streak_milestones(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_guest_streak_milestones(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.merge_guest_streak_milestones(
  _into_guest uuid,
  _from_guest uuid
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _n int;
BEGIN
  IF _into_guest IS NULL OR _from_guest IS NULL OR _into_guest = _from_guest THEN
    RETURN 0;
  END IF;

  IF _into_guest::text < _from_guest::text THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(_into_guest::text, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended(_from_guest::text, 0));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended(_from_guest::text, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended(_into_guest::text, 0));
  END IF;

  DELETE FROM public.streak_milestone_claims g
   WHERE g.guest_id = _from_guest
     AND EXISTS (SELECT 1 FROM public.streak_milestone_claims m
                  WHERE m.guest_id = _into_guest
                    AND m.streak_started_on = g.streak_started_on
                    AND m.milestone = g.milestone);

  UPDATE public.streak_milestone_claims
     SET guest_id = _into_guest
   WHERE guest_id = _from_guest;

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_guest_streak_milestones(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_guest_streak_milestones(uuid, uuid) TO service_role;