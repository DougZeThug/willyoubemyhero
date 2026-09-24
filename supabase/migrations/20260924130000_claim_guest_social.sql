-- A guest's reactions and trash talk follow them onto the player they claim.
--
-- Every other thing a guest does on a device — secret pulls, packs, milestone
-- claims — is moved onto the participant when the device is claimed. Reactions
-- and comments were not, and the two identity columns dedup independently:
-- UNIQUE (event_participant_id, participant_id, emoji) for members, the partial
-- card_reactions_guest_uniq for guests. So a guest who put a 🔥 on a card, then
-- claimed their player and tapped 🔥 again, found no row under their
-- participant id and inserted a second one. The guest row was orphaned for
-- good: toggleReaction only ever looks under the identity of the request, and a
-- member session always wins, so nothing could delete it — the count on that
-- card oscillated between one and two and never reached zero.
--
-- social.functions.ts claimed "signing in later can't silently double up your
-- reactions". That was only ever true within one request. This makes it true.
--
-- Comments move too. They have no uniqueness to collide with, but a comment
-- left filed under a guest key is one its author can never delete again, for
-- the same member-wins reason.
--
-- KNOWN AND ACCEPTED: duplicates written before this migration stay. A claim
-- nulls the guest id it folded (account_identities, and every row it moved), so
-- nothing left in the database says which guest became which player.

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

  -- The same per-guest lock the other claim_guest_* functions take, so a claim
  -- and a merge of the same guest queue rather than interleave.
  PERFORM pg_advisory_xact_lock(hashtextextended(_guest_id::text, 0));

  PERFORM 1 FROM public.participants WHERE id = _participant_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- A reaction the player already has on that card is the same reaction twice.
  -- Dropped rather than moved, or the UPDATE below trips the member unique.
  DELETE FROM public.card_reactions g
   WHERE g.guest_key = _guest_id::text
     AND EXISTS (SELECT 1 FROM public.card_reactions m
                  WHERE m.participant_id = _participant_id
                    AND m.event_participant_id = g.event_participant_id
                    AND m.emoji = g.emoji);

  -- guest_name goes with the key: the row is the player's now, and a stale
  -- "Guest" beside it would only ever be read by something that got the
  -- precedence wrong.
  UPDATE public.card_reactions
     SET participant_id = _participant_id, guest_key = NULL, guest_name = NULL
   WHERE guest_key = _guest_id::text;
  GET DIAGNOSTICS _reactions = ROW_COUNT;

  UPDATE public.card_comments
     SET participant_id = _participant_id, guest_key = NULL, guest_name = NULL
   WHERE guest_key = _guest_id::text;
  GET DIAGNOSTICS _comments = ROW_COUNT;

  RETURN _reactions + _comments;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_guest_social(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_guest_social(uuid, uuid) TO service_role;

-- ============ THE THREE WAYS A GUEST BECOMES A PLAYER ============
-- Restated from 20260911140000 (bind_account_to_player, attach_device_to_player)
-- and 20260908172154 (merge_guest_into_collector) with one line added to each.
-- Called inside the same transaction as the other moves, so the social rows move
-- with the collection or not at all.

CREATE OR REPLACE FUNCTION public.bind_account_to_player(
  _user_id        uuid,
  _participant_id uuid,
  /**
   * A guest id the CALLER knows this account was holding.
   *
   * The row's own `guest_id` is the ordinary source and is used whenever it is
   * set. This is for syncAccount, which read the account's guest identity before
   * calling and must still fold it in if a bind from another device won the race
   * in between — by then the row's guest_id has already been cleared by the
   * winner, and that collection would otherwise be stranded by the very write
   * that was meant to rescue it.
   */
  _guest_id       uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _name        text;
  _bound       uuid;
  _bound_name  text;
  _prior_guest uuid;
  _merged      int := 0;
BEGIN
  -- Participant row first, then the account row, then the guest locks the three
  -- claims take for themselves. The order is fixed and shared with
  -- attach_device_to_player (which this migration re-orders to match), because
  -- the two can be running at once on the same device — a commissioner filing a
  -- loose handset while its owner claims their paper code — and opposite orders
  -- are a deadlock rather than a queue.
  SELECT name INTO _name FROM public.participants WHERE id = _participant_id FOR UPDATE;
  IF _name IS NULL THEN
    RAISE EXCEPTION 'No such player';
  END IF;

  -- The read is only a fast path; the write has to be the guard, or two
  -- concurrent binds both see an unbound row and the last one silently wins.
  INSERT INTO public.account_identities (user_id, participant_id, guest_id)
  VALUES (_user_id, _participant_id, NULL)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT participant_id, guest_id INTO _bound, _prior_guest
    FROM public.account_identities WHERE user_id = _user_id FOR UPDATE;

  -- Guest -> member is an upgrade and is taken. A DIFFERENT roster player is
  -- refused rather than overwritten: syncAccount treats this row as
  -- authoritative, so taking it over would re-mint every other device onto the
  -- new player and strand the first identity with no way back.
  IF _bound IS NULL THEN
    UPDATE public.account_identities
       SET participant_id = _participant_id, guest_id = NULL
     WHERE user_id = _user_id;
    _bound := _participant_id;
  END IF;

  -- Whoever the row actually belongs to now gets the collection — including when
  -- that is not who we were asked to bind. The cards were never the thing in
  -- dispute, and leaving them behind is how a device ends up stranded.
  _prior_guest := COALESCE(_prior_guest, _guest_id);
  IF _prior_guest IS NOT NULL THEN
    _merged := public.claim_guest_secrets(_bound, _prior_guest);
    -- Packs first, then the claims keyed off them: a claim left behind on the
    -- dead guest id reads as unclaimed on this identity and pays its milestone
    -- again.
    PERFORM public.claim_guest_packs(_bound, _prior_guest);
    PERFORM public.claim_guest_streak_milestones(_bound, _prior_guest);
    -- Reactions and comments, or the next tap on an emoji doubles it.
    PERFORM public.claim_guest_social(_bound, _prior_guest);
  END IF;

  SELECT name INTO _bound_name FROM public.participants WHERE id = _bound;

  RETURN jsonb_build_object(
    'bound', _bound = _participant_id,
    'boundParticipantId', _bound,
    'boundName', _bound_name,
    'name', _name,
    'mergedGuest', _prior_guest,
    'secrets', _merged
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bind_account_to_player(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bind_account_to_player(uuid, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.attach_device_to_player(
  _participant_id uuid,
  _guest_id       uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _name    text;
  _user    uuid;
  _bound   uuid;
  _secrets int;
BEGIN
  SELECT name INTO _name FROM public.participants WHERE id = _participant_id FOR UPDATE;
  IF _name IS NULL THEN
    RAISE EXCEPTION 'No such player';
  END IF;

  -- An account sitting on this device with no player of its own would keep
  -- acting as a guest on its next visit, re-stranding new pulls.
  SELECT user_id, participant_id INTO _user, _bound
    FROM public.account_identities WHERE guest_id = _guest_id FOR UPDATE;
  IF _user IS NOT NULL AND _bound IS NULL THEN
    -- guest_id cleared in the same statement: account_identities_one_kind allows
    -- exactly one, and the TypeScript this replaced set the participant while
    -- leaving the guest id in place — so the repair raised a check violation and
    -- took the rest of the rescue down with it.
    UPDATE public.account_identities
       SET participant_id = _participant_id, guest_id = NULL
     WHERE user_id = _user;
  END IF;

  PERFORM public.claim_guest_secrets(_participant_id, _guest_id);
  -- Packs first, then the claims keyed off them: a claim left behind on the dead
  -- guest id reads as unclaimed on this identity and pays its milestone again.
  PERFORM public.claim_guest_packs(_participant_id, _guest_id);
  PERFORM public.claim_guest_streak_milestones(_participant_id, _guest_id);
  -- Reactions and comments, or the next tap on an emoji doubles it.
  PERFORM public.claim_guest_social(_participant_id, _guest_id);

  SELECT count(*)::int INTO _secrets
    FROM public.secret_card_pulls WHERE participant_id = _participant_id;

  RETURN jsonb_build_object('name', _name, 'secrets', _secrets);
END;
$$;

REVOKE ALL ON FUNCTION public.attach_device_to_player(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_device_to_player(uuid, uuid) TO service_role;

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
  -- Reactions and comments, or the next tap on an emoji doubles it.
  PERFORM public.claim_guest_social(_participant_id, _guest_id);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_guest_into_collector(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_guest_into_collector(uuid, uuid) TO service_role;
