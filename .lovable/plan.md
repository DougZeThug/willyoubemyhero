# Full admin editability: stations and results

## Where things stand today

Stations are already fully editable, but only from the Admin tab: the Stations panel
lets you rename a station, change its short name, description, penalty amount and
split toggle, add a new station, reorder them (with a warning once runs exist), and
retire one with an Active switch. Deleting is blocked only for a station that already
carries splits or penalties from a finished run, because that would orphan those runs.

Results are the gap. The new **Edit result** sheet (course time, per-station splits,
penalties) exists only on the Live commissioner bar, and it can only edit a run that
already exists. There is no way to:

- type a result in for someone who was never timed,
- delete one result without wiping the athlete back to the queue,
- reach any of this from the Admin tab.

## What gets built

**1. Results panel in the Admin tab**

A new "Results" section next to Stations, listing every athlete in running order with
their official time. Each row gets:

- **Edit** — opens the same Edit result sheet.
- **Add time** — for anyone with no result yet, opens the same sheet in blank/manual mode.
- **Delete** — removes that result (with confirm) and puts the athlete back in the queue.

**2. Manual entry in the Edit result sheet**

When the athlete has no saved run, the sheet no longer says "time them first". It opens
empty, and saving writes a fresh result: course time, whichever splits were filled in,
any penalties, and the athlete marked finished. Stamped as a manual entry so the audit
trail shows it was typed rather than timed.

**3. Delete a result from the sheet**

A "Delete this result" action at the bottom of the sheet, for when the fix is "this run
should never have happened". If the athlete has more than one attempt, only the one being
edited goes.

**4. Station panel reachable from Live**

Stations stay where they are, but the Live commissioner bar gets a link across to the
Admin tab's Stations section so renaming mid-combine is one tap rather than a hunt.

## Technical notes

- New `createManualRun` server function in `src/lib/admin-write.functions.ts`, guarded by
  `requireAdmin` like every other write: inserts the run with synthesised
  `started_at`/`finished_at` from the entered course time, inserts splits with derived
  segment times and penalties, marks the participant finished, and writes an
  `audit_logs` row with `action: "manual_run_entry"`. `official_time_ms` stays generated.
- New `deleteRunResult` server function wrapping the existing `deleteRun` behaviour plus
  the participant-status reset that `deleteRun` currently skips, so a deleted result does
  not leave someone stuck in `finished` with no time.
- Both endpoints get entries in the auth sweep in
  `src/lib/admin-write.functions.test.ts` (that test fails on any exported handler it
  does not know about).
- `src/components/edit-result-sheet.tsx` gains a `mode: "edit" | "create"` branch chosen
  from whether a run exists; the field layout, `parseTime` validation and official-time
  preview are shared between the two.
- New `src/components/results-admin-panel.tsx` using `AdminSection` for consistency with
  the other Admin panels, mounted in `src/routes/admin.tsx` beside `StationsPanel`.
- Every mutation invalidates `["event-bundle", eventId]` so Live, the leaderboard and the
  cards update without a refresh.
