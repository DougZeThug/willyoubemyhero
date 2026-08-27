-- A commissioner's grant, taken at most once.
--
-- grant_card_copy and grant_secret_card both insert unconditionally. The only
-- thing standing between a timed-out request, or a thumb on a phone in a garden,
-- and a real second copy was a per-row spinner that does not survive a reload —
-- in a game whose whole economy is scarcity. Now every grant carries a key the
-- screen generates once per intent, and a repeat reads back what the first one
-- did instead of handing out another card.

CREATE TABLE IF NOT EXISTS public.admin_grants (
  grant_key            text PRIMARY KEY,
  kind                 text NOT NULL,
  participant_id       uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  -- Exactly one of these is set, depending on kind. Not a CHECK: a roster card
  -- and a secret card are different tables and this is a ledger, not a
  -- constraint on either of them.
  event_participant_id uuid REFERENCES public.event_participants(id) ON DELETE CASCADE,
  secret_card_id       uuid,
  /** What the underlying grant returned, replayed verbatim to a retry. */
  result               jsonb,
  created_at           timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_grants ENABLE ROW LEVEL SECURITY;
-- No policy at all: anon and authenticated have no business reading who was
-- handed what, and every write here runs as service_role.
REVOKE ALL ON public.admin_grants FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.admin_grants TO service_role;

/**
 * Hand over a roster card once per key.
 *
 * The key is claimed BEFORE the grant, so a retry that arrives while the first
 * call is still in flight blocks on the primary key and then reads its result
 * rather than racing it.
 */
CREATE OR REPLACE FUNCTION public.grant_card_copy_once(
  _grant_key            text,
  _participant_id       uuid,
  _event_participant_id uuid,
  _edition              text DEFAULT 'standard'
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

  _n := public.grant_card_copy(_participant_id, _event_participant_id, _edition);
  UPDATE public.admin_grants
     SET result = jsonb_build_object('copies', _n)
   WHERE grant_key = _grant_key;

  RETURN jsonb_build_object('copies', _n, 'repeat', false);
END;
$$;

/** The same key, for a secret card. Returns grant_secret_card's own payload. */
CREATE OR REPLACE FUNCTION public.grant_secret_card_once(
  _grant_key       text,
  _participant_id  uuid,
  _secret_card_id  uuid,
  _event_id        uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _res   jsonb;
  _prior jsonb;
BEGIN
  INSERT INTO public.admin_grants (grant_key, kind, participant_id, secret_card_id)
  VALUES (_grant_key, 'secret', _participant_id, _secret_card_id)
  ON CONFLICT (grant_key) DO NOTHING;

  IF NOT FOUND THEN
    SELECT result INTO _prior FROM public.admin_grants WHERE grant_key = _grant_key;
    -- The trophy is stripped from a replay: the set was completed by the first
    -- call, and a second toast for it would be a lie.
    RETURN COALESCE(_prior, '{}'::jsonb)
      || jsonb_build_object('repeat', true, 'completedCollection', NULL);
  END IF;

  _res := public.grant_secret_card(_participant_id, _secret_card_id, _event_id);
  UPDATE public.admin_grants SET result = _res WHERE grant_key = _grant_key;

  RETURN _res || jsonb_build_object('repeat', false);
END;
$$;

REVOKE ALL ON FUNCTION public.grant_card_copy_once(text, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_card_copy_once(text, uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.grant_secret_card_once(text, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_secret_card_once(text, uuid, uuid, uuid) TO service_role;
