# Isaiah's edit did save — the clock is printing it 0.01s low

The edit went through. His run in the database now reads **1:41.32** (course
1:41.32, no penalties), rewritten with all six station times at 2:44pm. Loading
the leaderboard right now shows him at **1:41.31**.

So nothing is stale and nothing failed to save — the app is printing the number
one hundredth low, which reads exactly like "my edit didn't take" when you typed
1:41.32 and the board comes back with 1:41.31.

## Why

`formatTime` in `src/lib/format.ts` builds the hundredths with
`Math.floor((secs - Math.floor(secs)) * 100)`. In floating point, 101320 ms
becomes 101.32 s and the fractional part comes out as 0.31999999999999318, which
floors to 31 instead of 32. Any time whose hundredths land on the wrong side of
a float rounding error prints 0.01s low — most times are fine, which is why it
has gone unnoticed.

It also compounds inside the Edit result sheet: the sheet seeds its boxes from
`formatTime`, so opening a result and saving it can shave 10 ms off a leg each
time. That is the other half of what happened here — his course time moved
1:41.47 → 1:41.32, part typed change and part this drift.

## The fix

1. **`src/lib/format.ts`** — compute the hundredths from integer milliseconds
   instead of a float remainder (round the ms to the nearest 10 ms first, then
   derive minutes / seconds / hundredths with integer division). 1:41.32 then
   prints as 1:41.32 everywhere: leaderboard, results panel, card backs, splits,
   the live clock.
2. **`src/components/edit-result-sheet.tsx`** — round each stored split to the
   nearest 10 ms when seeding the leg boxes, so re-opening and re-saving a
   result is lossless rather than drifting a hundredth at a time.
3. **Isaiah's row** — nothing to repair; once the formatter is right, his time
   reads 1:41.32 as intended.

## Tests

- `src/lib/format.test.ts`: pin the cases the float path gets wrong (101320,
  and a couple of siblings like 1.07 s / 15.35 s), plus a round-trip
  `parseTime(formatTime(ms)) === ms` check for millisecond values on a 10 ms
  grid.
- `src/components/edit-result-sheet.test.tsx`: opening a result and saving it
  untouched sends back the same cumulative splits it was given.
