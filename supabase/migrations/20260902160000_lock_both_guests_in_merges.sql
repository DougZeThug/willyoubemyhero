-- The merges lock the guest ids too.
--
-- 20260902150000 serialised claim_guest_secrets on the participant row and
-- merge_guest_pulls on the destination guest. Neither held the SOURCE guest,
-- so a pull landing for that guest while its rows were being re-parented was
-- left behind on the dead id. claim_guest_packs and merge_guest_packs
-- (20260827130418) already take both, in a fixed order so two merges pointing
-- at each other cannot deadlock; these two now do the same. Participant row
-- first, then the guest locks — the order attach_device_to_player and the pack
-- claim already establish.

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

  -- Does double duty, as in pull_secret_card: proves the member exists, and
  -- serialises this merge against every other write that moves or promotes
  -- their secret rows.
  PERFORM 1 FROM public.participants WHERE id = _participant_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  -- And the guest whose rows are about to move, so a pull for that guest
  -- queues behind the merge rather than landing on an id nothing reads again.
  PERFORM pg_advisory_xact_lock(hashtextextended(_guest_id::text, 0));

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

  -- A card the member now holds only as duplicates gets one owning row: best
  -- tier first, then the oldest, the order resync_secret_ownership uses.
  -- secret_card_pulls_owned_once is satisfied by construction — the NOT EXISTS
  -- proves there is no owning row to collide with, and DISTINCT ON picks one.
  UPDATE public.secret_card_pulls p
     SET is_duplicate = false
    FROM (
      SELECT DISTINCT ON (q.secret_card_id) q.id
        FROM public.secret_card_pulls q
       WHERE q.participant_id = _participant_id
         AND NOT EXISTS (SELECT 1 FROM public.secret_card_pulls o
                          WHERE o.participant_id = _participant_id
                            AND o.secret_card_id = q.secret_card_id
                            AND NOT o.is_duplicate)
       ORDER BY q.secret_card_id, public.secret_tier_rank(q.tier) ASC, q.pulled_on ASC
    ) promote
   WHERE p.id = promote.id;

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

  -- A guest has no row to lock; this is the key pull_secret_card and the streak
  -- claim already serialise on. Both guests, in a fixed order, exactly as
  -- merge_guest_packs does: a pull for either side queues behind the merge, and
  -- two merges pointing at each other cannot deadlock.
  IF _into_guest::text < _from_guest::text THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(_into_guest::text, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended(_from_guest::text, 0));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended(_from_guest::text, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended(_into_guest::text, 0));
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

  -- The same promotion as claim_guest_secrets, for the guest side of the index.
  UPDATE public.secret_card_pulls p
     SET is_duplicate = false
    FROM (
      SELECT DISTINCT ON (q.secret_card_id) q.id
        FROM public.secret_card_pulls q
       WHERE q.guest_id = _into_guest
         AND NOT EXISTS (SELECT 1 FROM public.secret_card_pulls o
                          WHERE o.guest_id = _into_guest
                            AND o.secret_card_id = q.secret_card_id
                            AND NOT o.is_duplicate)
       ORDER BY q.secret_card_id, public.secret_tier_rank(q.tier) ASC, q.pulled_on ASC
    ) promote
   WHERE p.id = promote.id;

  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_guest_pulls(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_guest_pulls(uuid, uuid) TO service_role;
