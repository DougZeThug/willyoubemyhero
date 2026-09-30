-- Whether there is a pack, not just whether it has been opened.
--
-- 20260908165733 dropped the old `available` bit from the status with a reason
-- written into the function header: "a pack is always available, and a secret in
-- it is a surprise." Open_pack, three hundred lines above it in the same file,
-- has never agreed. Its pool is this event's roster UNION the secrets with art,
-- and when both halves are empty it returns NULL over the comment "Nothing
-- dealable. No row is written, so the day is not spent."
--
-- No row written means openedToday stays false, so on such a day a claimed
-- identity reads as "today's pack is unopened" — the nav tab takes its dot, the
-- vault's Today card takes its ring and its dot, and all of it points at a screen
-- that says "Nothing to deal today" once you have torn the wrapper open. The cue
-- that exists to tell you there is something waiting was firing on the one day
-- there is not.
--
-- So the status answers the question again. Signature unchanged: this is a
-- replacement, not an overload, and the REVOKE/GRANT pair is restated rather than
-- inferred from the migration that last wrote it.
CREATE OR REPLACE FUNCTION public.pack_status(
  _participant_id uuid,
  _guest_id       uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET timezone = 'America/New_York'
AS $$
DECLARE _day date := current_date;
BEGIN
  RETURN jsonb_build_object(
    'day', _day,
    'openedToday', EXISTS (
      SELECT 1 FROM public.pack_opens
       WHERE opened_on = _day
         AND ((_participant_id IS NOT NULL AND participant_id = _participant_id)
           OR (_guest_id IS NOT NULL AND guest_id = _guest_id))),
    -- Only ever "there is something to deal", never how much and never what --
    -- the same rule secretsOwned below keeps. Both halves of open_pack's pool,
    -- with the same predicates: a secret needs art and a weight to be picked at
    -- all, and the roster half needs an event that is on.
    --
    -- The event is resolved here rather than taken as an argument, the way
    -- claim_streak_milestone resolves its own. That keeps the signature, and the
    -- signature is what keeps `rpc('pack_status', ...)` unambiguous. It reads
    -- slightly wider than open_pack, which is handed the single newest active
    -- event by its caller: with two events somehow active at once and the newer
    -- one empty, this says dealable and open_pack deals from the secrets alone.
    -- That is the direction to be wrong in, and it is the behaviour today.
    'dealable', (
      EXISTS (SELECT 1 FROM public.secret_cards
               WHERE active AND art_path IS NOT NULL AND weight > 0)
      OR EXISTS (SELECT 1 FROM public.event_participants ep
                   JOIN public.events e ON e.id = ep.event_id
                  WHERE e.active)),
    'secretsOwned', (
      SELECT count(*) FROM public.secret_card_pulls
       WHERE NOT is_duplicate
         AND ((_participant_id IS NOT NULL AND participant_id = _participant_id)
           OR (_guest_id IS NOT NULL AND guest_id = _guest_id))),
    'resetsAt', ((_day + 1)::timestamp AT TIME ZONE current_setting('TimeZone'))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pack_status(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pack_status(uuid, uuid) TO service_role;
