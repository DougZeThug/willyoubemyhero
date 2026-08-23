# Re-opening a result adds a hundredth to the final time

His stored run is 1:41.32. Re-open the edit sheet and the legs add up to
1:41.33, and the course-time box follows the legs instead of the saved time —
so a save that changes nothing pushes his time up by 0.01s.

## Why

Each station box is seeded by differencing the stored cumulative splits and
then rounding that gap to the nearest hundredth. Stored splits are not on a
hundredth grid, so several legs round up and the rounding error accumulates:
15.35 + 38.21 + 6.61 + 18.68 + 14.01 + 8.47 = 1:41.33, one hundredth above the
1:41.32 the run actually holds.

The course-time box then makes it stick: it auto-fills from the sum of the legs
until the admin types in it, so the saved 1:41.32 is replaced by the drifted
1:41.33 the moment the sheet opens.

## The fix

1. **Seed legs from rounded cumulatives, not rounded gaps** — round each stored
   cumulative split to the nearest hundredth first, then take the differences.
   The legs then always sum exactly to the rounded final cumulative, so no error
   accumulates no matter how many stations there are.
2. **Don't let auto-fill overwrite a saved course time** — when the sheet opens
   on an existing run, seed the course-time box from the stored `raw_time_ms`
   and only auto-fill from the legs after the admin actually edits a station
   time (or when adding a brand-new result). Editing a leg still updates the
   course time live, as it does now.

Net effect: open Isaiah's result and it reads 1:41.32 with legs that sum to
1:41.32; save it untouched and the stored value is unchanged.

## Tests

- `src/components/edit-result-sheet.test.tsx`
  - opening a run whose cumulative splits are off the hundredth grid seeds legs
    that sum to the displayed course time, and saving untouched sends back the
    original `raw_time_ms` and cumulative splits;
  - editing one station still cascades the running clock and updates the course
    time preview.
