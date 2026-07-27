## Goal

Fix the 79 stale-type errors at the root by regenerating `src/integrations/supabase/types.ts` from the current DB schema, then re-enable the Typecheck step in CI so future drift fails the build.

## Steps

1. **Regenerate `src/integrations/supabase/types.ts`** from the live schema so it includes:
   - `events.awards_locked`
   - `event_participants.card_back_path`
   - Tables `award_votes`, `card_reactions`, `card_comments`, `member_codes`, `event_secrets`
   - RPC signatures for `cast_award_vote`, `close_award_voting`, `reopen_award_voting`
2. **Run `bun run typecheck`** locally to confirm all 79 errors clear. If any residual errors remain (real code bugs, not codegen drift), fix them in the same pass.
3. **Re-enable the Typecheck step** in `.github/workflows/ci.yml`: uncomment the step and delete the explanatory comment block above it so CI gates type errors going forward.

## Notes

- `types.ts` is auto-generated and normally untouched by hand; regeneration is the correct fix, not editing it.
- No app behavior changes — types-only.
- No DB migration needed; schema is already correct, only the generated file is stale.
