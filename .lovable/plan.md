# Restore column-level privacy on public run data

The failing assertion is caused by `20260811224354_d26051b2-f15a-4650-a564-42112f5d4d02.sql`: its broad `GRANT SELECT ON public.runs TO anon` runs after the earlier column-scoped grant and restores access to every column, including `client_key`. The live database confirms anon currently has `SELECT` on `runs.client_key`; authenticated does not.

## Changes

- Add a new idempotent migration after the existing migrations.
- Revoke table-wide `SELECT` on `public.runs` from both `anon` and `authenticated`.
- Regrant only the existing public leaderboard columns to both roles:
  `id`, `event_id`, `participant_id`, `attempt_number`, `started_at`, `finished_at`, `raw_time_ms`, `paused_duration_ms`, `penalty_ms`, `official_time_ms`, `status`, `is_official`, `created_at`, and `updated_at`.
- Keep `notes` and `client_key` inaccessible; do not alter RLS policies or write permissions.
- Apply the identical migration to the live database so repository replay and production permissions match.

## Verification

- Run `bun run test:db` and confirm all database tests pass, including the private-column assertion.
- Query live column privileges to confirm anon/authenticated can read public timing fields but cannot read `client_key` or `notes`.
- Run the database security linter and ensure this change introduces no new warnings.
