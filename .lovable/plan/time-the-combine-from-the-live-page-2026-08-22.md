# Time the combine from the Live page

Today the clock lives only on the Admin console, so whoever is timing has to
stand on the Admin tab while everyone else watches Live. This puts a compact
timing bar on the Live page for signed-in admins — start an athlete, hit
splits as they clear each station, pause and finish — without leaving the
broadcast view.

## What changes

**1. Admin control bar on Live (admins only)**

Nobody without a valid admin session sees any of it; the page looks exactly as
it does today for spectators.

Docked directly under the big circular timer:

- **No run in progress:** athlete picker defaulting to the next person in
  running order, a **Start** button, and the existing **On the clock** action
  so the crowd screen can show who is stepping up before the timer runs.
- **Run in progress:** **Pause / Resume**, **Finish**, and a horizontally
  scrollable row of station buttons — one tap each records a split with its
  cumulative time, tapped stations show their time and go inactive. Plus
  **Undo split**.
- Finishing saves the run exactly as the Admin console does (same offline
  backup, same retry on failure) and the bar returns to the picker with the
  next athlete preselected.

**2. The big timer shows the real run clock**

While an admin is timing, the circular timer counts the actual run time and
reads **Running** (or **Paused**), instead of the unofficial on-clock counter.
With no admin run active it behaves exactly as it does now.

**3. Admin console is unchanged**

The full console keeps penalties, cancel, athlete management and everything
else. Both screens drive the same single active run, so a run started on Live
can be finished on Admin and vice versa.

## Technical notes

- Extract the run state currently inline in `TimingConsole`
  (`src/routes/admin.tsx`) into a new `src/hooks/use-run-console.ts`:
  active-run hydrate/persist via `src/lib/active-run.ts`, `startRun`,
  `togglePause`, `recordSplit`, `undoLastSplit`, `addPenalty`, `cancelRun`,
  `setOnClock`, and `useFinishSave` wiring. `TimingConsole` is refactored to
  consume the hook so there is exactly one implementation; no behaviour change
  there.
- New `src/components/live-timing-bar.tsx` renders the compact controls from
  that hook, gated on `useAdminSession()` matching the active event id.
- `src/routes/live.tsx`: render the bar under `HudTimer`, and when the hook
  reports an active run, feed `HudTimer` the run's elapsed ms and
  `paused={run.status !== "running"}` with status `Running` / `Paused`,
  falling back to the current `onClockElapsedMs` path otherwise. A 100ms tick
  drives the display only while a run is active.
- Split recording stays client-side in the active-run record and is written on
  finish, matching the console — no new server function is needed.
- Tests: unit tests for `use-run-console` (start → split → pause → finish
  ordering, duplicate split rejected while paused) and a render test that the
  bar is absent without an admin session.
