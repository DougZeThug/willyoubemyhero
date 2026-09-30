-- One transaction for the collector handoff.
--
-- The signup flow moved a device's guest rows with three separate RPCs and then,
-- on failure, retired the fresh participant and put the account binding back. A
-- failure between two of those calls therefore committed some rows onto an id
-- nothing referenced any more — and because the claim_guest_* functions null
-- guest_id as they go, the retry's WHERE guest_id = _guest_id could never find
-- them again. Everything moves, or nothing does.
--
-- Deliberately does not touch account_identities: unlike attach_device_to_player,
-- the collector flow owns that binding and its own restore path.
CREATE OR REPLACE FUNCTION public.merge_guest_into_collector(
  _participant_id uuid,
  _guest_id       uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _name text;
BEGIN
  -- Participant lock first, then the guest locks the claims take: the same order
  -- attach_device_to_player and the pack merges use, so these cannot deadlock.
  SELECT name INTO _name FROM public.participants WHERE id = _participant_id FOR UPDATE;
  IF _name IS NULL THEN
    RAISE EXCEPTION 'No such player';
  END IF;

  PERFORM public.claim_guest_secrets(_participant_id, _guest_id);
  -- Packs first, then the claims keyed off them: a claim left behind on the dead
  -- guest id reads as unclaimed on this identity and pays its milestone again.
  PERFORM public.claim_guest_packs(_participant_id, _guest_id);
  PERFORM public.claim_guest_streak_milestones(_participant_id, _guest_id);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_guest_into_collector(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_guest_into_collector(uuid, uuid) TO service_role;