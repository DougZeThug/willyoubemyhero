-- Binding an account to a player, in one transaction.
--
-- 20260901140000 made the commissioner's rescue atomic and said why: a device's
-- collection moves in three steps, and "packs moved but their milestone claims
-- did not" is the state that pays a milestone twice. The claim screen's own path
-- still had the shape that migration was written to retire — an account row
-- committed as a member, and only THEN three separate round trips to move the
-- collection that row now claims to own.
--
-- Each of those is its own HTTP request to PostgREST and its own implicit
-- transaction, so nothing rolls the row write back when the second one times
-- out. What is left is an account bound to the player with part of its old guest
-- collection still filed under the dead guest id: recoverable only while the
-- originating device still holds that guest token, and invisible in the audit
-- panel in the shape where secrets moved and packs did not, because that panel
-- reads secret_card_pulls to decide a device is stranded at all.
--
-- So the bind and the three moves happen here, together, or not at all.

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

-- ============ ONE LOCK ORDER ============
-- Unchanged in what it does; the account row is simply taken before the three
-- claims rather than after them, so this and bind_account_to_player above
-- acquire the same locks in the same order. Both hold the participant row first,
-- so two calls naming the same player already queue; the pair that could cross
-- is a rescue and a claim naming DIFFERENT players on one device, where one held
-- the guest lock and wanted the account row while the other held the account row
-- and wanted the guest lock.
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

  SELECT count(*)::int INTO _secrets
    FROM public.secret_card_pulls WHERE participant_id = _participant_id;

  RETURN jsonb_build_object('name', _name, 'secrets', _secrets);
END;
$$;

REVOKE ALL ON FUNCTION public.attach_device_to_player(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_device_to_player(uuid, uuid) TO service_role;
