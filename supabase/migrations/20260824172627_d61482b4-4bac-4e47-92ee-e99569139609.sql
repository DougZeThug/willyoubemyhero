-- guest_key is a device identity: whoever holds it can act as that guest.
-- The public read policy exposed it alongside comment bodies, so we drop it
-- from the column-level grants instead of widening the policy.
REVOKE SELECT ON public.card_comments FROM anon, authenticated;
REVOKE SELECT ON public.card_reactions FROM anon, authenticated;

GRANT SELECT (id, event_participant_id, participant_id, body, guest_name, created_at)
  ON public.card_comments TO anon, authenticated;
GRANT SELECT (id, event_participant_id, participant_id, emoji, guest_name, created_at)
  ON public.card_reactions TO anon, authenticated;

GRANT ALL ON public.card_comments TO service_role;
GRANT ALL ON public.card_reactions TO service_role;
