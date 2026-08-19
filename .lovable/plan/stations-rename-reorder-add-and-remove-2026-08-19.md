# Stations: rename, reorder, add and remove

## Where things stand

The server side is already built: an admin-guarded save/delete pair exists for stations,
including a sort-order field, short name, description, icon, split toggle, penalty amount
and an active flag. Nothing in the app calls them — the admin screen only renders stations
as split buttons during a live run. So stations currently come from the database and can't
be touched from the app.

## What to build

A **Stations** panel on the admin console, above the run controls:

- List of the event's stations in running order, each row showing its number, name and
  short name.
- Tap a row to open a mobile sheet to edit: name, short name, description, split on/off,
  penalty amount (seconds, stored as ms), active on/off.
- Up/down arrows to reorder, behind a "Rearrange" toggle so the arrows aren't next to the
  tap target during normal use — same pattern already used in the player vault.
- "Add station" button appends a new station at the end.
- Delete on a station, with a confirm. If the station already has splits or penalties
  recorded against it, deleting is blocked and the row offers "deactivate" instead, so
  finished runs keep their history.

## Safety rules

- Editing is only allowed while the event has no recorded runs, or when results are not
  locked. Once runs exist, name and order edits still work (they're display-level), but
  delete is blocked as above — reordering a station after runs exist would reshuffle the
  station ladder on player cards, so show a warning when runs exist.
- Every change goes through the existing admin-guarded endpoints; no new access is opened.

## Technical notes

- New component `src/components/stations-panel.tsx`, rendered from `src/routes/admin.tsx`.
- Uses existing `upsertStation` / `deleteStation` from `src/lib/admin-write.functions.ts`.
- Reorder writes sequential `station_order` values for the affected rows in one pass.
- Add a small server function to report split/penalty counts per station so delete can be
  blocked accurately, or derive it from the already-loaded event bundle if it carries runs.
- Invalidate the event bundle query after each mutation so the split buttons update live.
- Tests: component test for reorder + rename flows, and a server-fn test asserting the
  admin guard rejects an unauthenticated station write.
