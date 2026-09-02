-- A guest's earned bonus secrets were destroyed at claim.
--
-- claim_guest_secrets and merge_guest_pulls both start by dropping every guest
-- row for a day the destination already spent — "today's unspent pull on the
-- destination wins", so a merge cannot hand somebody a second daily pull. The
-- predicate checked that the DESTINATION row was not granted and forgot to ask
-- the same of the guest's. A streak milestone pays out as a `granted = true`
-- row on the day it was claimed, and a daily player has an ordinary pull on
-- that day too — so the day-3, day-7 and day-14 rewards a guest earned were
-- deleted the moment they claimed a player, while claim_guest_streak_milestones
-- carried the claim row across and marked the milestone spent.
--
-- A granted row is not a daily slot. It cannot collide with one, and it is not
-- what the deletion is for. Both functions are re-stated whole, with the one
-- extra line, because CREATE OR REPLACE is the only way to change a body.

CREATE OR REPLACE FUNCTION public.claim_guest_secrets(_participant_id uuid, _guest_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _n int;
  _c record;
BEGIN
  IF _participant_id IS NULL OR _guest_id IS NULL THEN RETURN 0; END IF;

  PERFORM 1 FROM public.participants WHERE id = _participant_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- Only the guest's DAILY pull loses to the member's daily pull. A granted row
  -- — a milestone's reward, a bought pull — spent no slot and keeps its place.
  DELETE FROM public.secret_card_pulls g
   WHERE g.guest_id = _guest_id
     AND NOT g.granted
     AND EXISTS (SELECT 1 FROM public.secret_card_pulls m
                  WHERE m.participant_id = _participant_id
                    AND m.pulled_on = g.pulled_on
                    AND NOT m.granted);

  -- A guest copy that outranks the member copy hands its tier over before it is
  -- demoted to a duplicate: merging two identities must not lose the better roll.
  UPDATE public.secret_card_pulls m
     SET tier = g.tier
    FROM public.secret_card_pulls g
   WHERE g.guest_id = _guest_id
     AND NOT g.is_duplicate
     AND m.participant_id = _participant_id
     AND m.secret_card_id = g.secret_card_id
     AND NOT m.is_duplicate
     AND public.secret_tier_rank(g.tier) < public.secret_tier_rank(m.tier);

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

  -- BANKING A GUEST'S TROPHIES. See 20260825120000_collection_trophies.sql for
  -- why this sweeps every set and why it never raises.
  BEGIN
    FOR _c IN
      SELECT DISTINCT c.collection
        FROM public.secret_card_pulls p
        JOIN public.secret_cards c ON c.id = p.secret_card_id
       WHERE p.participant_id = _participant_id
         AND NOT p.is_duplicate
         AND c.collection IS NOT NULL
    LOOP
      PERFORM public.award_collection_trophy(_participant_id, _c.collection, 'claim', NULL);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN _n;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_guest_secrets(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_guest_secrets(uuid, uuid) TO service_role;

-- The guest-to-guest twin, with the same line.
CREATE OR REPLACE FUNCTION public.merge_guest_pulls(_into_guest uuid, _from_guest uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _n int;
BEGIN
  IF _into_guest IS NULL OR _from_guest IS NULL OR _into_guest = _from_guest THEN
    RETURN 0;
  END IF;

  DELETE FROM public.secret_card_pulls g
   WHERE g.guest_id = _from_guest
     AND NOT g.granted
     AND EXISTS (SELECT 1 FROM public.secret_card_pulls m
                  WHERE m.guest_id = _into_guest
                    AND m.pulled_on = g.pulled_on
                    AND NOT m.granted);

  UPDATE public.secret_card_pulls m
     SET tier = g.tier
    FROM public.secret_card_pulls g
   WHERE g.guest_id = _from_guest
     AND NOT g.is_duplicate
     AND m.guest_id = _into_guest
     AND m.secret_card_id = g.secret_card_id
     AND NOT m.is_duplicate
     AND public.secret_tier_rank(g.tier) < public.secret_tier_rank(m.tier);

  UPDATE public.secret_card_pulls g
     SET is_duplicate = true
   WHERE g.guest_id = _from_guest
     AND NOT g.is_duplicate
     AND EXISTS (SELECT 1 FROM public.secret_card_pulls m
                  WHERE m.guest_id = _into_guest
                    AND m.secret_card_id = g.secret_card_id
                    AND NOT m.is_duplicate);

  UPDATE public.secret_card_pulls
     SET guest_id = _into_guest
   WHERE guest_id = _from_guest;

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_guest_pulls(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_guest_pulls(uuid, uuid) TO service_role;
