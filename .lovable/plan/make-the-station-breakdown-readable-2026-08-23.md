# Make the station breakdown readable

## What those numbers mean today

The right-hand column is the gap between that player's split and the **field
median** at that station. Cyan `▼` means faster than the median by that amount;
amber `▲` means slower by that amount. So Doug's `CORN 14.36 ▼13.93` reads
"he did cornhole 13.93 seconds faster than the typical guy". Nothing on the row
tells you where that actually placed him, which is why it's hard to interpret.

## The change

Add a per-station place, and label the gap so it explains itself.

Each row becomes:

```text
CORN   ▓▓▓▓▓▓▓▓░░   14.36   2nd/16   13.93 faster
CLOSE  ▓▓▓▓░░░░░░   07.57   11th/16   6.88 slower
```

- **Place per station** — computed the same way the overall rank is: count how
  many players in the field had a faster best split at that station, +1. Shown
  as `2nd/16`. A station win (`1st`) renders in the card's tier colour, matching
  the existing "stations won" highlight.
- **Gap gets a word** — `faster` / `slower` instead of a bare triangle, keeping
  the cyan/amber colours. A small "vs. field median" caption under the section
  heading says what it's measured against, once, instead of per row.
- Rows where the player has no split still show `—`.

On a 360px phone the row gets tight, so the bar shrinks and the place sits
directly under the time on narrow screens rather than adding a fourth column.

## Technical notes

- `src/lib/card-stats.ts`: add `place: number | null` and `fieldCount: number`
  to `LadderRow`, derived from the `perParticipant` map already built for the
  median (one best split per participant, so a re-run can't distort it). Ties
  share a place, matching overall rank behaviour.
- `src/components/field-comparison.tsx`: render place + labelled gap, adjust the
  row grid for small screens.
- Extend `src/components/field-comparison.test.tsx` and the card-stats tests to
  cover placing, ties, and missing splits.
- The generated card back reads the same ladder rows; it keeps its current
  compact look unless you want the place added there too.
