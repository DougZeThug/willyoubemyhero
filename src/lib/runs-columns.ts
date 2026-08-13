/**
 * The columns of `public.runs` that anon and authenticated may select.
 *
 * Kept as a list rather than `*` because the grant on runs is column-scoped —
 * `notes` and `client_key` are deliberately withheld — and PostgREST refuses a
 * star expansion the moment one column in it is not granted. This string is the
 * client-side mirror of the GRANT in
 * supabase/migrations/20260813190000_runs_private_columns.sql.
 */
export const RUNS_PUBLIC_COLUMNS =
  "id, event_id, participant_id, attempt_number, started_at, finished_at, raw_time_ms, paused_duration_ms, penalty_ms, official_time_ms, status, is_official, created_at, updated_at";
