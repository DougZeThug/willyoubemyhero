# Apply the card editions migration to the live database

The migration file `supabase/migrations/20260813120000_card_pull_editions.sql` is already in the repo, but the live database has not run it: `card_pulls` has no `edition` column and `record_card_pulls` is still the two-argument version.

## What will happen

- Apply the migration file byte-for-byte, exactly as written — no edits, no extra constraints.
- It adds a `edition` column to the card pull records (defaulting every existing row to "standard"), adds the ranking helper that decides which finish is better, and replaces the pull-recording routine with one that accepts finishes.
- A better finish upgrades the copy you already own; a worse one is just a duplicate. Nobody gains an extra card row from a re-pull, so the public "packed by" counts stay honest.
- Access stays locked down: only the server role can run either routine.

## Verification after applying

Run the five checks from the prompt:

1. `edition` exists, NOT NULL, defaults to `standard`.
2. Exactly one `record_card_pulls`, with the three-argument signature.
3. `card_edition_rank` returns 1,2,3,4,5,99,99.
4. Primary key still `(participant_id, event_participant_id)`.
5. Zero rows for anon/authenticated EXECUTE privileges.

## Technical notes

- Applied in one script, top to bottom: column → `card_edition_rank` → `DROP FUNCTION public.record_card_pulls(uuid, uuid[])` → three-arg `CREATE OR REPLACE` → REVOKE/GRANT.
- The DROP is mandatory; skipping it leaves an ambiguous overload.
- No CHECK constraint on `edition`, no primary-key change, `SET timezone = 'America/New_York'` and the `pull_count` CASE preserved unchanged.
- `supabase/migrations/20260813120000_card_pull_editions.sql` is passed through as-is so the repo file and the applied migration are identical.
- Afterwards the Supabase types file is regenerated automatically; no hand edits to it.

No application code changes are part of this step.
