-- Rescuing a device's cards, in one transaction.
--
-- The ownership audit's confirm says "This can't be undone", and it was three
-- sequential RPCs plus an account repair with nothing tying them together. A
-- failure between any two left the device half-rescued — secrets moved, packs
-- not, or packs moved and the milestone claims left behind on the dead guest id,
-- which is precisely the state that pays a milestone twice — and nothing on the
-- screen said so.
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

  PERFORM public.claim_guest_secrets(_participant_id, _guest_id);
  -- Packs first, then the claims keyed off them: a claim left behind on the dead
  -- guest id reads as unclaimed on this identity and pays its milestone again.
  PERFORM public.claim_guest_packs(_participant_id, _guest_id);
  PERFORM public.claim_guest_streak_milestones(_participant_id, _guest_id);

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

  SELECT count(*)::int INTO _secrets
    FROM public.secret_card_pulls WHERE participant_id = _participant_id;

  RETURN jsonb_build_object('name', _name, 'secrets', _secrets);
END;
$$;

REVOKE ALL ON FUNCTION public.attach_device_to_player(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_device_to_player(uuid, uuid) TO service_role;
