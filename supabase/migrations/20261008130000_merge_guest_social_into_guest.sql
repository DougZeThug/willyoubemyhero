-- A guest folded into another guest takes their reactions and comments with them.
--
-- merge_guest_into_guest (20261008120000) moved the pulls, the packs and the
-- milestone claims and nothing else, while the three folds into a PLAYER all move
-- the social rows too (claim_guest_social). So a guest who played on a second
-- handset and reacted or commented there, then signed into an account whose
-- recorded identity was still a guest, left those rows on a guest key the
-- surviving identity can never look under: toggleReaction adds a second 🔥 beside
-- the orphan and can only ever remove its own, and the author of an orphaned
-- comment can no longer delete it.
--
-- Written the way claim_guest_social now is (20260924140000), not the DELETE
-- ... WHERE EXISTS plus UPDATE it replaced: the copy is INSERT ... ON CONFLICT DO
-- NOTHING, which skips a reaction the destination already has instead of tripping
-- card_reactions_guest_uniq and rolling the whole merge back, and the absorbed
-- guest's rows are deleted afterwards. The moved reactions get new ids; nothing
-- references card_reactions.id. Comments have nothing to collide with and keep
-- theirs, each with the name it was posted under.
--
-- Inline rather than a new function: it runs under the two guest locks this
-- function already holds, which are the keys every guest write serialises on
-- (the refuse_claimed_guest_social trigger takes the same one before each guest
-- insert), so a reaction in flight under either id finishes first or queues
-- behind the move.
--
-- A destination that has been claimed in the meantime refuses the move, for
-- reactions AND comments: moving rows onto a guest key that now belongs to a
-- player is the orphan this exists to prevent. The trigger would catch the
-- reaction INSERT, but the comments move is an UPDATE and it is BEFORE INSERT
-- only, so the check is explicit. Raised only when there is social to move, so a
-- merge of pulls alone behaves as it did. The sync retries as the player.

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

  IF EXISTS (SELECT 1 FROM public.claimed_guests WHERE guest_id = _into_guest)
     AND (EXISTS (SELECT 1 FROM public.card_reactions WHERE guest_key = _from_guest::text)
          OR EXISTS (SELECT 1 FROM public.card_comments WHERE guest_key = _from_guest::text)) THEN
    RAISE EXCEPTION 'This phone belongs to a player now. Claim your player to join in.';
  END IF;

  INSERT INTO public.card_reactions (event_participant_id, guest_key, guest_name, emoji, created_at)
  SELECT event_participant_id, _into_guest::text, guest_name, emoji, created_at
    FROM public.card_reactions
   WHERE guest_key = _from_guest::text
  ON CONFLICT (event_participant_id, guest_key, emoji) WHERE guest_key IS NOT NULL DO NOTHING;

  DELETE FROM public.card_reactions WHERE guest_key = _from_guest::text;

  UPDATE public.card_comments
     SET guest_key = _into_guest::text
   WHERE guest_key = _from_guest::text;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_guest_into_guest(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_guest_into_guest(uuid, uuid) TO service_role;
