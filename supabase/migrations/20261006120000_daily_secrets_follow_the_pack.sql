-- A fresh guest can no longer carry an extra day's secrets into a member who
-- has already opened that day's pack.
--
-- claim_guest_secrets dropped a guest's daily (un-granted) pulls for day D only
-- when the member STILL HELD an un-granted pull dated D. Since 20260930120000
-- today's pull sells, trades and lists the moment it lands, and a pack may deal
-- no secret at all — so a member could open their pack, sell what it dealt,
-- open a pack on a brand-new guest id (they are free) and claim it with their
-- own paper code (codes stay valid; attach_device_to_player runs this on every
-- claim), keeping the guest's secrets too. Repeatable, once per fresh guest.
--
-- The test is now the member's SERVER-DEALT pack_opens row for D, OR the old
-- condition. The day is keyed on pack_opens for the same reason open_pack keys
-- the deal on it: nothing a sale or a trade does can make that row disappear.
--
-- Server-dealt only (`cards IS NOT NULL`; NULL on every row from before
-- 20260908120000/20260908165733, see the column comment there). Before then a
-- pack and the daily secret were separate draws: a member could open a roster
-- pack and pull no secret that day, so their pack row says nothing about
-- whether the day's SECRET was spent, and a guest's secret from such a day
-- still moves, as it always did. The OR keeps those older days — a daily
-- secret row but no dealt pack (pull_secret_card) — behaving exactly as before.
--
-- Ordering this relies on, verified in the newest definition of every caller:
-- attach_device_to_player, bind_account_to_player and merge_guest_into_collector
-- (all 20260924130000) call claim_guest_secrets BEFORE claim_guest_packs, so
-- the pack_opens rows read here are the member's own. merge_guests_into_collector
-- (20260917005934) goes through merge_guest_into_collector. merge_guest_pulls is
-- called before merge_guest_packs by syncAccount's guest branch
-- (src/lib/account.server.ts), the only caller.
--
-- What does not change: a mid-day claim by a member who has NOT opened a pack
-- that day still brings the guest's secret (and, through claim_guest_packs, the
-- pack) across. Granted rows — milestone rewards, bought pulls — always move.
--
-- This supersedes the "Known and accepted" paragraph in
-- 20260930120000_todays_pull_is_a_spare.sql (lines 25-28).
--
-- BODIES LIFTED WHOLE from their newest definitions — both functions from
-- 20260902175931 — with only the first DELETE in each changed, for the reason
-- 20260930120000 gives: a body retyped from a stale copy silently reverts
-- whatever landed in between.

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
  --
  -- "The member's daily pull" is their dealt pack for that day, not whatever
  -- secret rows they still hold from it: a member who sold today's secret, or
  -- whose pack dealt none, has spent the day all the same. A pack row with no
  -- cards predates server-dealt packs, when the secret was a separate pull, so
  -- it does not count. Every caller runs this
  -- BEFORE claim_guest_packs, so the pack_opens row read here is the member's
  -- own and never the guest's, which has not moved yet.
  DELETE FROM public.secret_card_pulls g
   WHERE g.guest_id = _guest_id
     AND NOT g.granted
     AND (EXISTS (SELECT 1 FROM public.pack_opens po
                   WHERE po.participant_id = _participant_id
                     AND po.opened_on = g.pulled_on
                     AND po.cards IS NOT NULL)
       OR EXISTS (SELECT 1 FROM public.secret_card_pulls m
                   WHERE m.participant_id = _participant_id
                     AND m.pulled_on = g.pulled_on
                     AND NOT m.granted));

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

  -- The same rule as claim_guest_secrets: a day the destination guest was
  -- dealt a pack is spent, whether or not they still hold what it dealt. Runs before
  -- merge_guest_packs, so the row read here is the destination's own.
  DELETE FROM public.secret_card_pulls g
   WHERE g.guest_id = _from_guest
     AND NOT g.granted
     AND (EXISTS (SELECT 1 FROM public.pack_opens po
                   WHERE po.guest_id = _into_guest
                     AND po.opened_on = g.pulled_on
                     AND po.cards IS NOT NULL)
       OR EXISTS (SELECT 1 FROM public.secret_card_pulls m
                   WHERE m.guest_id = _into_guest
                     AND m.pulled_on = g.pulled_on
                     AND NOT m.granted));

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