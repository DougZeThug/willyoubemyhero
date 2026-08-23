# Let station times go over a minute on a phone keypad

The station boxes open the numeric keypad, which has no `:` key, so `1:38.25`
can't be typed. What people actually type is `1.38.25` — and the parser rejects
it, so the box turns red and the time never lands. Typing a big seconds value
(`98.25`) works today, but only up to two digits, so `138.25` also fails.

## New behaviour

`parseTime` accepts, in addition to what it takes now:

- `1.38.25` / `2.05.7` — minute, seconds, fraction separated by dots. Two dots
  means the first group is minutes; seconds must still be under 60.
- `98.25`, `138.25` — any number of whole seconds, converted to minutes on
  display (`138.25` → `2:18.25`).
- `1:38.25` keeps working exactly as now.

That covers the course time field, the station leg boxes and the penalty boxes,
since they all share the one parser. Invalid entries (`1.75.00`, letters,
extra dots) still go red rather than silently saving a wrong number.

## Technical notes

- `src/lib/format.ts` only: widen the `parseTime` regex to allow a three-group
  dotted form and to drop the 2-digit cap on a colon-less seconds value, keeping
  the `seconds >= 60` rejection for the forms that carry an explicit minutes
  part.
- Round-trip stays exact — still integer milliseconds via
  `Math.round((minutes * 60 + seconds) * 1000)`.
- Tests: add cases to `src/lib/format.test.ts` for `1.38.25`, `138.25`,
  `2.05.7`, and rejection of `1.75.00` and `1.2.3.4`.
