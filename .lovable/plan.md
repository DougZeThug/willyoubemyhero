# Apply the streak milestones migration

Run `supabase/migrations/20260824130000_streak_milestones.sql` against the connected database exactly as written — byte-for-byte, no reformatting, no splitting, no added policies or grants.

## What gets applied

- Table `streak_milestone_claims` with its two partial unique indexes (`streak_milestone_claims_once`, `streak_milestone_claims_guest_once`)
- Functions `streak_runs`, `pull_bonus_secret_card`, `claim_streak_milestone`, `claim_guest_streak_milestones`, `merge_guest_streak_milestones`
- RLS enabled with zero policies; `REVOKE ALL ... FROM PUBLIC, anon, authenticated`; `service_role` only
- No realtime publication entry, no foreign key on `reward_ref`

Nothing else changes: no app code, no `types.ts`, no other migration, no dependencies.

## Verification afterwards

Read-only queries to confirm and report:

1. Table plus both partial unique indexes present, with the expected predicates.
2. `pg_class.relrowsecurity` true and `pg_policies` empty for the table.
3. All five functions present with the stated signatures; `proconfig` on `pull_bonus_secret_card` and `claim_streak_milestone` shows `search_path=public` and `TimeZone=America/New_York`.
4. `anon` and `authenticated` hold no table privileges and no EXECUTE on any of the five functions.
5. `streak_milestone_claims` absent from `pg_publication_tables` for `supabase_realtime`.

If the file fails to apply, I stop and report the exact Postgres error instead of editing the SQL.
