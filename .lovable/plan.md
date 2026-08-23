# Bulk station renaming + live time preview from splits

Two admin improvements: rename all course categories in one pass, and make the
Edit result sheet's total follow the split times as you type them.

## 1. Bulk rename stations

In the Admin tab's Stations panel, add a **Rename all** mode next to the existing
Rearrange toggle.

- Shows every station as a row with two inputs: full name (e.g. "Cornhole") and
  short label (e.g. "CORN") — the short label is what appears on the card back,
  the field ladder and the timing buttons.
- One **Save all names** button writes every changed row; unchanged rows are
  skipped. A failure names the station that didn't save and leaves the rest saved.
- Blank full name blocks the save with a message; blank short label is allowed
  (falls back to the full name, as today).
- Renaming is safe for finished results — no times, splits or penalties move.

## 2. Live official-time preview from the splits

In the Edit result sheet:

- The last leg entered becomes the course time. As splits are typed, the
  **Course time (before penalties)** box auto-fills from them, and the
  **Official time** panel updates to that value plus any penalties.
- Auto-fill stops as soon as you type in the course time box yourself — an
  override wins, and a small "from splits: 1:36.17" hint appears underneath if
  the two disagree, so a mismatch is visible rather than silent.
- A per-station **leg** time (the gap from the previous station) is shown next to
  each split field, so an obviously wrong leg is easy to spot.
- Everything stays live: typing, adding or clearing a split, or adding/removing a
  penalty immediately re-renders the total. Nothing is saved until Save result.

## Technical notes

- Split fields hold **cumulative** times (FLIP 15.35 → PONG 1:36.17), which is
  how they are stored and how they were entered here. Adding the legs together
  therefore equals the final cumulative split, so the derived course time is the
  largest cumulative split present, and each row's displayed leg is
  `cumulative − previous cumulative`. Legs that come out negative are flagged in
  red as an out-of-order split.
- `src/components/edit-result-sheet.tsx`: derived `splitDerivedMs`, a
  `courseTouched` flag to stop auto-fill after manual entry, leg computation in a
  memo, and the existing Official time panel switched to
  `(override ?? splitDerivedMs) + penaltyMs`.
- `src/components/stations-panel.tsx`: a `renaming` mode holding a draft map of
  `{ id: { name, short_name } }`, saving through the existing `upsertStation`
  server function per changed row (no new server function, no migration).
- Tests: extend `src/components/edit-result-sheet.test.tsx` (or add it) for
  auto-fill, override and leg math; add a stations-panel test for bulk save
  writing only the changed rows.
