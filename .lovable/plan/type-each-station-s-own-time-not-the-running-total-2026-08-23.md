# Type each station's own time, not the running total

Today the split boxes hold cumulative clock times (FLIP 15.35, CORNHOLE 58.57,
PONG 1:36.17), which is how the timer records them but not how anyone thinks
about a station. Flip it: the admin types **how long that station took**, and the
app shows the running total.

## New behaviour in the Edit result sheet

Each station row becomes:

```text
FLIP         [ 15.35 ]   at 15.35
CORNHOLE     [ 43.22 ]   at 58.57
BASKETBALL   [ 01.61 ]   at 1:00.18
3PT          [ 18.50 ]   at 1:18.68
FOOTBALL     [ 11.01 ]   at 1:29.70
PONG         [ 06.47 ]   at 1:36.17
CHUG         [   —   ]
```

- The input is the station's own time. The grey `at ...` beside it is the
  cumulative clock, recomputed live from every station above it.
- Change one station and everything below it moves automatically — no more
  editing six boxes to fix one leg, and no "out of order" state to reason about,
  since negative entries simply aren't possible to create by accident (a negative
  or unparseable entry is flagged in red the way bad values are today).
- A blank station means no split recorded there: it contributes nothing and is
  skipped in the running total, exactly as blank does now.
- Course time still auto-fills from the last cumulative total, a typed course
  time still overrides it, and the "from splits" mismatch hint stays.
- Official time = course time + penalties, updating as you type.
- Opening the sheet converts the stored cumulative splits into per-station times
  so an existing result reads naturally; saving converts them back, so nothing
  about the stored data or the rest of the app changes.

## Technical notes

- `src/components/edit-result-sheet.tsx` only. The draft state changes from
  cumulative strings to per-station leg strings (`legTimes`), with:
  - seeding on open: leg = `cumulative − previous non-blank cumulative`;
  - a `cumulatives` memo that runs the legs forward for display and for
    `splitDerivedMs`;
  - `payload()` converting legs back to `cumulative_time_ms` before sending, so
    `updateRunResult` / `createManualRun` are untouched.
- The cascade helper (`setSplitAt`) and its focus-baseline ref are deleted —
  cascading is inherent once the inputs are legs.
- Tests: rewrite `src/components/edit-result-sheet.test.tsx` around leg entry —
  typing a leg updates its cumulative and every later one, editing a middle leg
  moves the total, blanks are skipped, penalties still add on top, and a save
  sends cumulative values.
