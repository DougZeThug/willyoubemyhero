-- A commissioner's authority stops at their own combine.
--
-- grantCard authenticates against the event it names — `requireAdmin(eventId)`,
-- a token minted for exactly one combine — and then dropped that event on the
-- floor. The RPC beneath it took a participant id and an event_participants id
-- and asked only whether each row EXISTED, anywhere in the database. So an admin
-- token for this year's combine minted copies of cards from ANY event's roster,
-- credited to anybody in the league, as many times as there were grant keys; and
-- because grant_card_copy ends in resync_card_pull, each one also bumped the
-- other event's public "packed by N" count. Both of those are ordinary powers
-- over one's own event. Neither is a power over somebody else's, and the
-- event-scoped token is the only thing that was ever supposed to say so.
--
-- The event travels with the grant now, and both ends of it are checked: the
-- card has to be on that event's roster, and so does the person receiving it.
--
-- Deliberately NOT `AND e.active`. This is the repair tool for a collection that
-- went missing, last year's commissioner still holds a valid token for last
-- year's combine, and putting a card back into a finished event is precisely
-- what it is for. The rule is "your own event", not "the live one" — the same
-- distinction adopt_card_copies gets to ignore, because a guest's pack is dealt
-- from the live roster and could not honestly hold anything else.

-- ============ THE GRANT ============
-- Dropped rather than replaced, and not a style choice: adding a parameter makes
-- an OVERLOAD rather than a replacement, and two candidates leave
-- `rpc('grant_card_copy', ...)` ambiguous from PostgREST — the trap
-- 20260818192523 had to clean up after record_pack_open. The DROP takes the ACL
-- with it, which is why the REVOKE/GRANT pair below is re-issued rather than
-- inherited.
DROP FUNCTION IF EXISTS public.grant_card_copy(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.grant_card_copy(
  _participant_id       uuid,
  _event_participant_id uuid,
  _edition              text DEFAULT 'standard',
  -- Last and defaulted, so that a server still running the old bundle against a
  -- migrated database fails LOUDLY on the line below rather than resolving to
  -- nothing and making an unscoped grant. A deploy is the one moment both
  -- versions exist, and it is the one moment the guard must not be optional.
  _event_id             uuid DEFAULT NULL
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _n int;
BEGIN
  IF _event_id IS NULL THEN
    RAISE EXCEPTION 'Grant needs the event it is being made in';
  END IF;

  -- By (id, event_id) rather than by id alone. That difference IS the bug: every
  -- roster row ever written passed the existence check this replaces.
  PERFORM 1 FROM public.event_participants
   WHERE id = _event_participant_id AND event_id = _event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Card not found'; END IF;

  -- And the person being handed it. A copy filed against somebody outside this
  -- event is a card in a vault this commissioner has no say over — and the
  -- panel only ever offers this event's roster in either picker, so nothing
  -- honest is narrowed here. Via event_participants, which FKs to participants,
  -- so this subsumes the bare "participant exists" check it replaces.
  PERFORM 1 FROM public.event_participants
   WHERE event_id = _event_id AND participant_id = _participant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Player is not in this event'; END IF;

  INSERT INTO public.card_copies
    (participant_id, event_participant_id, edition, acquired_on, source)
  VALUES (_participant_id, _event_participant_id,
          COALESCE(_edition, 'standard'), NULL, 'grant');

  PERFORM public.resync_card_pull(_participant_id, _event_participant_id);

  SELECT count(*)::int INTO _n FROM public.card_copies
   WHERE participant_id = _participant_id
     AND event_participant_id = _event_participant_id;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_card_copy(uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_card_copy(uuid, uuid, text, uuid) TO service_role;

-- ============ THE KEY ============
-- Same treatment, for the same overload reason. The key is still claimed BEFORE
-- the grant, so a retry arriving while the first call is in flight blocks on the
-- primary key rather than racing it — and a grant that the checks above refuse
-- takes the key row down with it, because PostgREST runs this as one statement
-- in one transaction. tests/db/grants-and-rescue.test.ts pins that.
DROP FUNCTION IF EXISTS public.grant_card_copy_once(text, uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.grant_card_copy_once(
  _grant_key            text,
  _participant_id       uuid,
  _event_participant_id uuid,
  _edition              text DEFAULT 'standard',
  _event_id             uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n     int;
  _prior jsonb;
BEGIN
  INSERT INTO public.admin_grants (grant_key, kind, participant_id, event_participant_id)
  VALUES (_grant_key, 'card', _participant_id, _event_participant_id)
  ON CONFLICT (grant_key) DO NOTHING;

  IF NOT FOUND THEN
    SELECT result INTO _prior FROM public.admin_grants WHERE grant_key = _grant_key;
    RETURN jsonb_build_object('copies', COALESCE((_prior->>'copies')::int, 0), 'repeat', true);
  END IF;

  _n := public.grant_card_copy(_participant_id, _event_participant_id, _edition, _event_id);
  UPDATE public.admin_grants
     SET result = jsonb_build_object('copies', _n)
   WHERE grant_key = _grant_key;

  RETURN jsonb_build_object('copies', _n, 'repeat', false);
END;
$$;

REVOKE ALL ON FUNCTION public.grant_card_copy_once(text, uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_card_copy_once(text, uuid, uuid, text, uuid)
  TO service_role;
