-- 20260811224354 re-granted table-wide SELECT on penalties and draft_selections
-- to anon, which silently undid the column-scoped grants from 20260724151735
-- (and 20260724163545 for draft_selections) and put `notes`, `created_by` and
-- `client_key` back within reach of the publishable key. runs was re-narrowed in
-- 20260813185530; these two were missed. Same fix, same reasoning.
--
-- Idempotent: revoking then regranting the same named columns replays safely.
REVOKE SELECT ON public.penalties FROM anon, authenticated;
GRANT SELECT (
  id, run_id, station_id, penalty_ms, reason, created_at
) ON public.penalties TO anon, authenticated;

REVOKE SELECT ON public.draft_selections FROM anon, authenticated;
GRANT SELECT (
  id, event_id, participant_id, selection_order, draft_position, selected_at
) ON public.draft_selections TO anon, authenticated;