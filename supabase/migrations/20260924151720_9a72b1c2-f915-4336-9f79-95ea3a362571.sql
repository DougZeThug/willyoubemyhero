-- Two races 20260924130000 left open in claim_guest_social.
--
-- 1. A guest write that lands after the claim. toggleReaction and postComment
--    are plain inserts that took no lock, so one in flight as a claim ran could
--    miss the claim's UPDATE (its snapshot predates the insert's commit) and then
--    commit under the old guest_key — the orphaned, undeletable row the claim
--    exists to prevent. Taking the claim's lock alone only moves the problem: an
--    insert that queues behind the claim still commits under the guest key once
--    the claim lets go. So the database now remembers which guest ids have been
--    claimed, and a guest reaction or comment from one of them is refused
--    outright. Refused rather than refiled under the player: a phone the
--    commissioner rescued can still be acting as a guest, and filing its writes
--    under the player would let a guest token post in the player's name. The one
--    tap that races a claim fails, and the retry goes out as the player.
--
-- 2. A member reaction that lands during the claim. The duplicate DELETE and
--    the UPDATE were two statements with two snapshots, so the player adding the
--    same emoji from another phone between them made the UPDATE trip the member
--    unique — and that error rolled back the whole claim it was part of. The move
--    is now INSERT ... ON CONFLICT DO NOTHING, which waits out a concurrent
--    insert and skips it, followed by deleting the guest rows. The moved
--    reactions get new ids; nothing references card_reactions.id.

-- ============ WHO HAS BEEN CLAIMED ============
-- Server-only, like account_identities: a guest id is a device identity, and
-- this says which device became which player.
CREATE TABLE IF NOT EXISTS public.claimed_guests (
  guest_id       uuid PRIMARY KEY,
  participant_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  claimed_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.claimed_guests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.claimed_guests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.claimed_guests TO service_role;

-- ============ THE CLAIM ============
CREATE OR REPLACE FUNCTION public.claim_guest_social(
  _participant_id uuid,
  _guest_id       uuid
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _reactions int;
  _comments  int;
BEGIN
  IF _participant_id IS NULL OR _guest_id IS NULL THEN RETURN 0; END IF;

  -- The same per-guest lock the other claim_guest_* functions take, and the one
  -- the refusal trigger below takes before every guest insert. A guest write
  -- already holding it finishes first, and the statements below see it.
  PERFORM pg_advisory_xact_lock(hashtextextended(_guest_id::text, 0));

  PERFORM 1 FROM public.participants WHERE id = _participant_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- Recorded before anything moves, and under the lock, so a guest insert that
  -- queued behind this claim reads it once the claim commits. A guest claimed a
  -- second time belongs to whoever claimed it last, which is where its rows went.
  INSERT INTO public.claimed_guests (guest_id, participant_id)
  VALUES (_guest_id, _participant_id)
  ON CONFLICT (guest_id) DO UPDATE
    SET participant_id = EXCLUDED.participant_id, claimed_at = now();

  -- Copied rather than updated in place: ON CONFLICT is what skips a reaction
  -- the player already has, including one another phone of theirs is inserting
  -- this instant. A NOT EXISTS check reads a snapshot and cannot see that one.
  INSERT INTO public.card_reactions (event_participant_id, participant_id, emoji, created_at)
  SELECT event_participant_id, _participant_id, emoji, created_at
    FROM public.card_reactions
   WHERE guest_key = _guest_id::text
  ON CONFLICT (event_participant_id, participant_id, emoji) DO NOTHING;
  GET DIAGNOSTICS _reactions = ROW_COUNT;

  DELETE FROM public.card_reactions WHERE guest_key = _guest_id::text;

  -- Comments have no uniqueness to collide with, so they keep their ids. A
  -- comment left under a guest key is one its author could never delete again.
  UPDATE public.card_comments
     SET participant_id = _participant_id, guest_key = NULL, guest_name = NULL
   WHERE guest_key = _guest_id::text;
  GET DIAGNOSTICS _comments = ROW_COUNT;

  RETURN _reactions + _comments;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_guest_social(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_guest_social(uuid, uuid) TO service_role;

-- ============ LATE GUEST WRITES ============
CREATE OR REPLACE FUNCTION public.refuse_claimed_guest_social() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.guest_key IS NULL THEN RETURN NEW; END IF;

  -- The claim's lock. Taken here, a guest insert either finishes before a claim
  -- starts moving rows (and is moved with them) or waits for the claim to
  -- commit and then reads claimed_guests below. Nothing lands in between.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.guest_key, 0));

  IF EXISTS (SELECT 1 FROM public.claimed_guests WHERE guest_id::text = NEW.guest_key) THEN
    RAISE EXCEPTION 'This phone belongs to a player now. Claim your player to join in.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER card_reactions_refuse_claimed_guest
  BEFORE INSERT ON public.card_reactions
  FOR EACH ROW EXECUTE FUNCTION public.refuse_claimed_guest_social();

CREATE OR REPLACE TRIGGER card_comments_refuse_claimed_guest
  BEFORE INSERT ON public.card_comments
  FOR EACH ROW EXECUTE FUNCTION public.refuse_claimed_guest_social();