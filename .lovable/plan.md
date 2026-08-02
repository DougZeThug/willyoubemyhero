# Fix the flaky "skip cuts the ceremony short" e2e test

## What is failing

`e2e/journeys.spec.ts:306` presses Enter to tear the pack, waits 300ms, clicks
Skip, waits for the reveal stand, and then asserts that the *wall-clock* time
since before the keypress is under `CEREMONY_MS` (2240ms).

That budget is measured with the test runner's clock, so it includes Playwright
overhead the ceremony has nothing to do with: the Enter keypress actionability
check, the Skip click's actionability check against a moving/animating button,
and the stand mount. On a loaded CI runner with the mobile and desktop projects
running together, that overhead can eat the ~1.9s of slack and fail the test
even when Skip worked perfectly. The other 97 specs pass, and nothing in the
skip path changed.

## The fix: make the test control the clock

Use Playwright's clock API so the assertion no longer depends on machine speed:

- Install a fake clock before navigating (`page.clock.install()`), so the
  ceremony's `setTimeout` chain and its `performance.now()` dead-zone check both
  run on a clock the test owns.
- Tear the pack, then `page.clock.runFor(300)` to pass the 140ms skip dead zone
  — the same intent as today's `waitForTimeout`, but instant and exact.
- Click Skip and assert the stand ("card 1 of 3") is visible.
- The real assertion becomes structural rather than statistical: the fake clock
  has only advanced ~300ms of the 2240ms ceremony, so the ceremony's own
  handover timer cannot possibly have fired. Reaching the stand proves the Skip
  button did it. This is strictly stronger than the current timing check, and it
  cannot flake on a slow runner.

Keep the explanatory comment in the test, updated to describe the clock-based
reasoning instead of the wall-clock one.

## Notes

- No application code changes. `pack-opening.tsx` and `pack-ceremony.ts` behave
  correctly; only the test's measurement is wrong.
- Check the two neighbouring specs ("plays the opening ceremony over the torn
  pack" and "gets to the stand on its own if the ceremony is left to finish").
  The latter relies on real timers to elapse; if the fake clock is installed
  per-test rather than globally, it stays untouched. Install it only inside the
  skip test.
- Verify by running the pack-opening specs in both Playwright projects
  (`bun run test:e2e -g "pack"`), plus `bun run lint`.
