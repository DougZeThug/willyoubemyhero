/**
 * The columns of `public.penalties` that anon and authenticated may select.
 *
 * Kept as a list rather than `*` for the same reason as RUNS_PUBLIC_COLUMNS:
 * the grant is column-scoped — `notes`, `created_by` and `client_key` are
 * deliberately withheld — and PostgREST refuses a star expansion the moment one
 * column in it is not granted. Mirrors the GRANT in
 * supabase/migrations/20260918153003_cff5743c-04d7-4c02-85ee-504fc84662a8.sql.
 */
export const PENALTIES_PUBLIC_COLUMNS = "id, run_id, station_id, penalty_ms, reason, created_at";

/**
 * The columns of `public.draft_selections` that anon and authenticated may
 * select. `created_by` is the internal actor label and is withheld.
 */
export const DRAFT_SELECTIONS_PUBLIC_COLUMNS =
  "id, event_id, participant_id, selection_order, draft_position, selected_at";
