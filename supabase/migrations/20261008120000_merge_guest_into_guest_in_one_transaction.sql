-- A guest folded into another guest moves in one transaction.
--
-- syncAccount's guest branch (src/lib/account.server.ts) ran merge_guest_pulls,
-- merge_guest_packs and merge_guest_streak_milestones as three requests, each
-- committing on its own. Two things went wrong in the gaps:
--
--   * merge_guest_pulls drops the incoming guest's daily secrets for any day
--     the destination was dealt a pack (20261006120000). Between the pulls and
--     the packs commit, the destination could open today's pack: the pulls step
--     had already found no pack and kept the incoming secret, and the packs step
--     then kept the destination's own pack — a second day's secret, the farm
--     20261006120000 closed for members.
--   * a failure after the packs left milestone claims on the dead guest id,
--     where they read as unclaimed and pay again. The member branch already
--     moved to merge_guest_into_collector for exactly that reason.
--
-- So one function, under both guest locks for the whole run. The locks are the
-- advisory keys every guest write serialises on (open_pack, the bonus pull, the
-- streak claim), taken in the fixed text order merge_guest_pulls, _packs and
-- _milestones each take themselves — so re-taking them inside is a no-op and
-- two merges pointing at each other queue rather than deadlock. Pulls before
-- packs, because the pulls step reads the destination's own pack_opens rows and
-- must not see the incoming guest's, which have not moved yet. Milestone claims
-- after the packs they are keyed off.
--
-- The three functions are called rather than restated: each is already the
-- latest definition of its step, and restating them here is how a later fix to
-- one would silently fork.

CREATE OR REPLACE FUNCTION public.merge_guest_into_guest(
  _into_guest uuid,
  _from_guest uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _into_guest IS NULL OR _from_guest IS NULL OR _into_guest = _from_guest THEN
    RETURN;
  END IF;

  IF _into_guest::text < _from_guest::text THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(_into_guest::text, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended(_from_guest::text, 0));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended(_from_guest::text, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended(_into_guest::text, 0));
  END IF;

  PERFORM public.merge_guest_pulls(_into_guest, _from_guest);
  PERFORM public.merge_guest_packs(_into_guest, _from_guest);
  PERFORM public.merge_guest_streak_milestones(_into_guest, _from_guest);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_guest_into_guest(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_guest_into_guest(uuid, uuid) TO service_role;
