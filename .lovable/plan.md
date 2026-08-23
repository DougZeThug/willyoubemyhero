# Edit a finished run: times, splits and penalties

## Where things stand today

- **Field/station names**: yes, already editable. Admin tab → **Stations** panel renames,
  reorders, adds and retires stations (`upsertStation` / `deleteStation`).
- **Split times**: no. Splits can only be captured live while a run is on the clock, and
  the "Undo split" button only works before the run is saved. Once a run is saved the only
  admin options are **Reset** (wipes that athlete's run, splits and penalties) or delete —
  there is no way to correct a single number.

This adds that correction path.

## What changes for you

A new **Edit result** action next to each finished athlete in the admin results list (and
from the Live commissioner bar's finished-athlete list). It opens a sheet showing:

- **Total time** — editable as `mm:ss.hh`, with the raw/penalty split shown underneath.
- **One row per station** — cumulative time for each split, editable in the same format.
  A station with no split shows "Add split"; an existing split has a remove control.
  Segment times are recalculated from the cumulative values, so you only type one number.
- **Penalties** — existing penalties listed with their amount and reason, each removable,
  plus "Add penalty" (station optional, amount in seconds, reason free text).
- Live-updating **official time** preview (raw + penalties) so you can see the leaderboard
  result before saving.
- Save writes everything at once; Cancel discards. Every edit is written to `audit_logs`
  with the previous and new values, so a wrong correction is traceable.

Guard rails kept: results still can't be edited while the event is results-locked, and
splits must stay in ascending order and within the total time — the sheet blocks saving
with a clear message rather than writing a nonsensical run.

## How it works

- `src/lib/admin-write.functions.ts`: new `updateRunResult` server function, `requireAdmin(eventId)`
  as its first line. Input: `runId`, optional `raw_time_ms`, an array of
  `{ stationId, cumulative_time_ms }` splits (the full desired set — missing stations are
  deleted), and an array of penalties. It recomputes `segment_time_ms` per split,
  `penalty_ms` as the penalty sum, `official_time_ms` as raw + penalties, replaces the
  run's splits/penalties rows (`entry_method: "admin_edit"`), and writes an `audit_logs` row.
  Rejects when the event is `results_locked`.
- New `src/components/edit-result-sheet.tsx`: the sheet UI, built from existing shadcn
  `Sheet` + `Input` and the app's HUD tokens. Time parsing/formatting reuses `formatTime`
  from `src/lib/format.ts` plus a new `parseTime` helper there (`mm:ss.hh` → ms).
- Wired into the admin results list in `src/routes/admin.tsx` and the finished-athlete rows
  in `src/components/live-timing-bar.tsx`; both invalidate the event bundle on success so
  the leaderboard, cards and stats update immediately.
- No schema change — `splits`, `penalties` and `runs` already carry every field needed.
- Tests: `src/lib/admin-write.functions.test.ts` (auth guard, segment recalculation,
  official time, results-locked rejection, split removal) and `src/lib/format.test.ts`
  (`parseTime` round-trip). Verify with `bun run format`, `lint`, `typecheck`, `test`, and
  a 360px pass over the admin and live pages.
