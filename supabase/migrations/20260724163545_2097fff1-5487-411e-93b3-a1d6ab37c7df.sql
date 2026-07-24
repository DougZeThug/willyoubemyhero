
-- event_secrets: service_role only (PIN hash/salt must never reach anon/authenticated)
REVOKE ALL ON public.event_secrets FROM anon, authenticated, PUBLIC;

-- audit_logs: service_role only
REVOKE ALL ON public.audit_logs FROM anon, authenticated, PUBLIC;

-- running_order_randomizations: service_role only (seeds must stay private)
REVOKE ALL ON public.running_order_randomizations FROM anon, authenticated, PUBLIC;

-- draft_selections: keep public read for the leaderboard, but hide created_by
REVOKE ALL ON public.draft_selections FROM anon, authenticated, PUBLIC;
GRANT SELECT (id, event_id, participant_id, selection_order, draft_position, selected_at)
  ON public.draft_selections TO anon, authenticated;
GRANT ALL ON public.draft_selections TO service_role;
