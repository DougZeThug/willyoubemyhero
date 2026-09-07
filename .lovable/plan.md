# Mythic at 60 days, and the streak restarts there

## What changes

1. **The guaranteed mythic rung moves from 100 days to 60.** The ladder becomes 3 (no floor), 7 (rare), 14 (epic), 30 (legendary), 60 (mythic). Nobody has ever claimed the 100-day rung (checked: only 3, 7, 14 and 30 have been claimed), so nothing already paid out is affected — the 100 rung is simply removed and 60 added.
2. **Claiming the 60-day reward restarts the streak.** Once the mythic is collected, the run resets and the day of the claim counts as Day 1 of a fresh run, so the whole ladder — three days, a week, a fortnight, a month, sixty — is there to climb again. This is the only rung that resets; the others leave the run running.

## How the reset works

The streak is not stored anywhere: it is counted by walking the days somebody opened a pack. So the reset is a cut-off rather than a wipe — no pack history is deleted, and the vault is untouched.

- The day a 60-day reward is claimed becomes the earliest day the walk will count for that person.
- Both places that count a streak — the screen's counter and the payout check in the database — apply the same cut-off, so the button and the reward can never disagree.
- The cut-off travels with a guest's history when they claim a player, exactly like their pack days and milestone claims already do.

## Technical detail

- New migration (idempotent, replays from empty):
  - `streak_runs(_participant_id, _guest_id)` gains a cut-off: days on or before the latest `streak_milestone_claims.claimed_on` where `milestone = 60` are excluded from the walk, except the claim day itself, which starts the new run.
  - `claim_streak_milestone` ladder list changes from `IN (3, 7, 14, 30, 100)` to `IN (3, 7, 14, 30, 60)`, and the `CASE` floor maps 60 to `mythic`. Order of the existing body is preserved; comments explaining the ladder-is-append-only contract updated to record why 100 could be dropped.
  - No table, column, grant, policy or realtime change; no tier, edition or award id renamed.
- `src/lib/streaks.ts`: `STREAK_MILESTONES` last rung becomes `days: 60`, label "Sixty Days", blurb reworded; `walkStreak` gains an optional `since` cut-off day and stops the backwards walk at it.
- `src/lib/streaks.functions.ts`: reads the person's 60-day claims alongside the existing claim query and passes the cut-off into `walkStreak`; milestone `claimed` flags unchanged in shape.
- `src/hooks/use-milestone-claim.ts` already invalidates the streak query after a claim, so the reset appears immediately.
- Tests: unit tests for the cut-off in `walkStreak` and the new rung; database tests in `tests/db/streaks.test.ts` for the 60 rung paying a mythic floor, 100 now being rejected as unknown, and the walk restarting after a 60 claim; the existing test that pins the SQL ladder against `STREAK_MILESTONES` updated.
- Verification: `bun run format`, `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:db`.
