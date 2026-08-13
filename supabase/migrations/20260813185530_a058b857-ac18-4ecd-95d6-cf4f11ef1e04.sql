-- 20260811224354 re-granted table-wide SELECT on runs to anon, which silently
-- undid the column-scoped grant from 20260724151735 and put `notes` and
-- `client_key` back within reach of the publishable key. Re-narrow it.
--
-- Idempotent: revoking then regranting the same named columns is safe to replay,
-- and tests/db/rls.test.ts asserts the end state in both directions.
REVOKE SELECT ON public.runs FROM anon, authenticated;
GRANT SELECT (
  id, event_id, participant_id, attempt_number, started_at, finished_at,
  raw_time_ms, paused_duration_ms, penalty_ms, official_time_ms, status,
  is_official, created_at, updated_at
) ON public.runs TO anon, authenticated;