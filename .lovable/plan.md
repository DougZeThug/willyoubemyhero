## Goal

Apply two database migrations that add the secret-cards catalogue/ledger and the player-card pull counter, exactly as specified in the pasted prompt. No app code changes.

## What to apply

Run as two separate migrations, in order:

1. **`20260728143000_secret_holo_cards.sql`** — creates `public.secret_cards` and `public.secret_card_pulls` (RLS on, zero policies, no grants to anon/authenticated), the `events_one_active` partial unique index, and the `SECURITY DEFINER` functions `pull_secret_card(uuid, uuid)` and `secret_pull_status(uuid)` with `SET timezone = 'America/New_York'` and `REVOKE ... FROM PUBLIC` / `GRANT EXECUTE ... TO service_role`.

2. **`20260728160000_player_card_pulls.sql`** — creates `public.card_pulls` (composite PK `(participant_id, event_participant_id)`, RLS on, zero policies, no grants to anon/authenticated) plus `card_pulls_card_idx`, and the `SECURITY DEFINER` function `record_card_pulls(uuid, uuid[])` with `REVOKE ... FROM PUBLIC` / `GRANT EXECUTE ... TO service_role`.

Both migrations use `IF NOT EXISTS` / `CREATE OR REPLACE` throughout so re-runs are safe.

## Hard rules (from the prompt)

- Do NOT add any RLS policy to `secret_cards`, `secret_card_pulls`, or `card_pulls`. RLS-on-with-zero-policies is the intended state.
- Do NOT grant anything on these tables to `anon`, `authenticated`, or `PUBLIC`.
- Do NOT add them to the `supabase_realtime` publication.
- Do NOT change `SECURITY DEFINER` → `SECURITY INVOKER`, and do NOT drop the `REVOKE ... FROM PUBLIC` lines on the two RPCs.
- Do NOT change the `SET timezone = 'America/New_York'` on either RPC.
- Do NOT edit any application code (TS side arrives via git; `secret-cards-db.server.ts` stays until types are regenerated).

## Verification

After each migration is approved and applied, run the four verification queries from section 3 of the prompt via `supabase--read_query`:

1. Three tables present, `rls_enabled = t`, `policy_count = 0`.
2. Zero rows of grants to anon/authenticated/PUBLIC on those tables.
3. Zero project functions executable by anon/authenticated.
4. Zero of the three tables in the `supabase_realtime` publication.

If any check fails, do not proceed — re-apply the DDL exactly as written.

## Out of scope

- No TypeScript changes, no regenerated `types.ts`, no deletion of `secret-cards-db.server.ts` in this pass.
- Storage bucket privacy (`participant-photos`) is dashboard state; not touched by migrations.
