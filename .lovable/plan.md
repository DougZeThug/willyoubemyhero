# Clear the fake results, put a real athlete on the clock

Right now the combine looks half-run before it has started: seven finished
times and a scattering of finished / on-deck / up-next flags are leftover
demo data, and the Live timer says STANDBY because nothing is flagged as
actively running.

## What changes

**1. Wipe the demo results**

- Delete the 7 seeded official runs (Ryan Herr, Daniel Weidensaul, Robert
  Wolgemuth, Jordan Bowers, AJ Dewalt, David Weidensaul, Stephen Lipko).
- Reset every roster entry to `waiting`, so nothing reads as finished,
  on deck or up next.
- Remove Alex Manning and the duplicate Lipko entry from this event's roster
  (the person records stay; only the event entries go).

**2. Admin picks who's actually competing**

A new **Combine roster** section in the admin console lists everyone on the
event with a simple in/out toggle:

- Out = marked `scratched`. They keep their card and their page, but they are
  skipped by the randomizer, don't count toward "x/y done", and never appear
  on the Live timer.
- Also on the same panel: add a person to the event, and drop them entirely.

**3. Admin controls the clock**

In the run screen, an explicit **On the clock** control:

- Put the selected athlete on the clock (status `running`) without starting
  the timer, so the crowd screen shows who is stepping up.
- Clear the clock back to standby.
- Starting the timer already sets `running`; finishing sets `finished`.
- A **Reset combine** button (with confirm) that deletes this event's runs and
  puts everyone back to `waiting` — so the same clean-up is repeatable next
  year without touching the database.

**4. Live and TV follow the running order**

- If an admin has put someone on the clock, that person is shown (as today).
- Otherwise the Live and TV pages show the first non-scratched, non-finished
  athlete in running order, labelled **Up Next** instead of Standby.
- Because that is derived from `running_order`, a re-randomize on the Order
  page immediately moves the new #1 into the Live position.
- The "x/y done" count only counts non-scratched athletes.

## Technical notes

- Data clean-up runs as a one-off data operation (delete from `runs` for the
  active event; reset `event_participants.participation_status`; delete the
  two roster rows).
- New server function `resetCombine({ eventId })` in
  `src/lib/admin-write.functions.ts`, guarded by `requireAdmin`, doing the
  same delete + reset. Existing `setParticipantStatus`,
  `addParticipantToEvent` and `removeParticipantFromEvent` cover the rest.
- `src/routes/order.tsx`: the shuffle pool excludes `scratched` entries and
  keeps them at the tail of the order.
- `src/routes/live.tsx` and `src/routes/tv.tsx`: shared `currentAthlete`
  helper (new `src/lib/current-athlete.ts`, unit-tested) — prefer `running`,
  else first queued in running order.
- `src/routes/admin.tsx`: new roster panel plus the on-the-clock / reset
  controls; `StartCard`'s queue already filters scratched and finished.
