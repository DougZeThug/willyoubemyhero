# Editing one split should move every split after it

Right now each split box holds a **cumulative** time. Changing CORNHOLE from
43.21 to 58.57 only changes that one box — BASKETBALL through PONG keep their old
cumulative values, so the derived course time (the last split) never moves and
the Official time preview looks unchanged.

## New behaviour

When an admin edits one station's split, the app keeps every following station's
**leg** (its own segment time) intact and shifts its cumulative time by the same
delta.

Example, editing CORNHOLE +15.36:

```text
before                 after
FLIP        15.35      15.35    (unchanged, it is before the edit)
CORNHOLE    43.21  ->  58.57    (edited)
BASKETBALL  44.82      60.18
3PT         1:03.32    1:18.68
FOOTBALL    1:14.33    1:29.70
PONG        1:20.79    1:36.17
CHUG        —          —        (blank stays blank)
```

The Course time box and the Official time panel then follow the new last split
immediately, so the preview reflects the edit as it is typed.

Details:
- Stations before the edited one never move.
- Blank stations stay blank and don't break the chain — the shift skips them.
- If the typed value can't be parsed yet (mid-typing, e.g. "1:"), nothing shifts;
  the cascade applies once the value is a valid time.
- Clearing a station's box removes only that split; the others keep their times.
- Leg labels and the red "out of order" flag keep working as they do now — after
  a cascade the following legs are unchanged, so they stay valid by construction.
- Course time auto-fill and the manual-override rule are unchanged: a typed
  course time still wins and still shows the "from splits" mismatch hint.
- Nothing is written until Save result.

## Technical notes

- `src/components/edit-result-sheet.tsx`: the split `onChange` becomes a
  `setSplitAt(stationId, value)` helper that computes
  `delta = newMs - previousMs` from the current draft and adds `delta` to every
  parseable split belonging to a station later in `station_order`. The rest of
  the file (legs memo, `splitDerivedMs`, `courseTouched`) stays as is and picks
  up the new values.
- The delta is only applied when both the old and new values parse; otherwise the
  edited field updates alone.
- Tests: extend `src/components/edit-result-sheet.test.tsx` with a cascade case
  (edit a middle split, assert later fields and Official time moved by the delta,
  earlier ones did not) and a blank/unparseable case.
