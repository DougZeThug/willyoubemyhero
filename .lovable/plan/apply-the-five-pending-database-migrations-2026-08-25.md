# Apply the five pending database migrations

All five files are present in `supabase/migrations/` and will be applied byte-for-byte, in filename order, with no edits, no reformatting, no new migration files, and no application code changes.

## Order

1. `20260826120000_server_rolled_editions.sql` — adds `card_copies.edition_asserted_by` (default `'client'`), adds `roll_card_edition`, replaces `record_card_pulls`, `pull_secret_card`, `pull_bonus_secret_card`.
2. `20260826130000_dust_ledger.sql` — adds `dust_ledger` (server-only), `dust_enabled`, `dust_balance`, `mill_value`, `mill_card_copy`, `buy_bonus_secret_pull`, `reroll_copy_edition`.
3. `20260827120000_card_mints.sql` — adds `card_mints` (server-only) plus the one-time backfill from `card_copies`.
4. `20260827130000_name_traded_secrets.sql` — adds `trade_summary`, replaces `accept_trade_offer`.
5. `20260828120000_dust_switch.sql` — adds `events.dust_enabled` (default `false`), recreates `events_public` to expose it, re-replaces the dust functions.

Each goes through the migration approval card as its own step, in this order — file 5 depends on 2, file 3 on 1, file 2 on 1, so they cannot be applied out of order or on their own.

## Verification

After the last one applies, I run the seven supplied checks and report each result verbatim:

1. `dust_ledger` and `card_mints` exist (2 rows)
2. `card_copies.edition_asserted_by` = `'client'`, `events.dust_enabled` = `false` (2 rows)
3. `events_public` exposes `dust_enabled` (1 row)
4. all eight new functions present (8 rows)
5. exactly one `record_card_pulls`, returning `jsonb` (1 row)
6. the active event has `dust_enabled = false`
7. no `anon` / `authenticated` grants on the two new tables (0 rows)

If any check comes back wrong I stop and report it rather than writing corrective SQL.

## Out of scope

No TypeScript, component, or config changes. The code on this branch already matches these migrations.
