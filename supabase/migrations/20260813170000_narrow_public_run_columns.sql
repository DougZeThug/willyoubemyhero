-- Put the public grants on runs, penalties and draft_selections back to the
-- named columns 20260724151735 chose.
--
-- 20260811224354 replaced those column-level grants with three table-wide ones:
--
--   GRANT SELECT ON public.runs TO anon;
--   GRANT SELECT ON public.penalties TO anon;
--   GRANT SELECT ON public.draft_selections TO anon;
--
-- A table-level grant supersedes the column-level ones, so that handed anon back
-- every column on all three: the private notes, the internal `created_by` actor
-- labels, and the client idempotency keys. tests/db/rls.test.ts has been failing
-- on exactly that ever since.
--
-- It was almost certainly done to unbreak the event bundle rather than to widen
-- access. `getEventBundle` read these tables with `select("*")` through the anon
-- key, and `*` asks for every column — which Postgres refuses outright when one
-- of them is not granted. Those reads now name their columns (see
-- PUBLIC_RUN_COLUMNS and friends in src/lib/event.functions.ts), so the grants
-- can go back to being narrow without taking the bundle down with them.
--
-- The column lists below and the constants in event.functions.ts have to stay in
-- step. Adding a column to one without the other either leaks it or breaks the
-- read, so change them together.
--
-- `splits` is deliberately untouched. It carries a client_key too and has never
-- been narrowed, which is worth doing — but it is a separate change from putting
-- back something that was taken away, and this migration is only the latter.

REVOKE SELECT ON public.runs FROM anon, authenticated;
GRANT SELECT (
  id, event_id, participant_id, attempt_number, started_at, finished_at,
  raw_time_ms, paused_duration_ms, penalty_ms, official_time_ms, status,
  is_official, created_at, updated_at
) ON public.runs TO anon, authenticated;

REVOKE SELECT ON public.penalties FROM anon, authenticated;
GRANT SELECT (
  id, run_id, station_id, penalty_ms, reason, created_at
) ON public.penalties TO anon, authenticated;

REVOKE SELECT ON public.draft_selections FROM anon, authenticated;
GRANT SELECT (
  id, event_id, participant_id, selection_order, draft_position, selected_at
) ON public.draft_selections TO anon, authenticated;
