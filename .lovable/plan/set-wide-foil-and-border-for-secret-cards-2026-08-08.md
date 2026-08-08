# Set-wide foil and border for secret cards

An admin can set the foil and border once for a whole collection instead of
touching every card in it.

## What the admin sees

Each collapsible set section gets a small **Set look** row directly under the
header, visible only when the section is open:

- A foil swatch picker and a border picker, styled exactly like the ones on an
  individual card tile.
- Both start blank ("Mixed" when the cards in the set disagree, otherwise the
  shared value), so nothing is applied until the admin picks something.
- Picking a value applies it to every card in that set immediately, with the
  same toast pattern already used per card ("Applying to WAGs…" → "WAGs now
  Ultraviolet"), and the section shows a spinner while it saves.
- Per-card foil and border controls stay exactly as they are; a card can still
  be overridden afterwards.

The Unsorted group gets the same control, applying to unsorted cards only.

## Technical notes

- New server function `updateSecretCollectionLook` in
  `src/lib/secret-cards.functions.ts`: `requireAdmin` first line, input
  `{ collection: string | null, foil?: string, borderFx?: string }` validated
  against the existing foil/border id enums, one `update ... eq/is collection`
  through `secretsDb()` so a set of any size is a single write. Returns the
  number of rows touched.
- `src/components/secret-cards-panel.tsx`: a `SetLookRow` (kept in the same
  file, next to the section render) wired to the new function, with a
  `savingSetIds` set mirroring the existing `savingLookIds` pattern, and
  `list.refetch()` on success so tiles repaint.
- Shared foil/border option lists and the `CompactLookSelect` styling come from
  the existing `src/lib/secret-cards.ts` exports and
  `src/components/secret-card-tile.tsx` — no new vocabulary, no migration.
- Tests: extend `src/lib/secret-cards.functions.test.ts` for the new handler
  (admin required, unknown foil rejected, null collection targets unsorted).
- Verify with `bun run format`, `lint`, `typecheck`, `test`, and a 360px pass
  over the admin console.
