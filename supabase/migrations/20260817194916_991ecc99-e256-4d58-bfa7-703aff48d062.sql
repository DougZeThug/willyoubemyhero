CREATE TABLE IF NOT EXISTS public.account_identities (
  user_id uuid PRIMARY KEY,
  participant_id uuid REFERENCES public.participants(id) ON DELETE SET NULL,
  guest_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Exactly one identity per account: a member token and a guest token are two
  -- different collections, and an account that held both would have to choose one
  -- on every sign-in.
  CONSTRAINT account_identities_one_kind CHECK (
    (participant_id IS NOT NULL AND guest_id IS NULL)
    OR (participant_id IS NULL AND guest_id IS NOT NULL)
  )
);

-- Deny-all, like every other private table here. All access is through server
-- functions running as service_role behind requireSupabaseAuth.
GRANT ALL ON public.account_identities TO service_role;
ALTER TABLE public.account_identities ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS account_identities_participant_idx
  ON public.account_identities (participant_id) WHERE participant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS account_identities_guest_idx
  ON public.account_identities (guest_id) WHERE guest_id IS NOT NULL;

DROP TRIGGER IF EXISTS account_identities_set_updated_at ON public.account_identities;
CREATE TRIGGER account_identities_set_updated_at
  BEFORE UPDATE ON public.account_identities
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Guest-to-guest twin of claim_guest_secrets. Same three rules: today's unspent
-- pull on the destination wins (so a merge cannot hand somebody a second daily
-- pull), a better tier is carried across before the losing copy is demoted, and
-- an already-owned card arrives as a duplicate rather than a second ownership row.
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

  DELETE FROM public.secret_card_pulls g
   WHERE g.guest_id = _from_guest
     AND EXISTS (SELECT 1 FROM public.secret_card_pulls m
                  WHERE m.guest_id = _into_guest
                    AND m.pulled_on = g.pulled_on
                    AND NOT m.granted);

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
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_guest_pulls(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_guest_pulls(uuid, uuid) TO service_role;