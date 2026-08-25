# Set panels: solid hue instead of gradient

The themed collection panels currently paint a radial gradient wash over the bezel
gradient. Replace that with a flat, solid tint of the set's colour.

## What you'll see

- Each themed vault shelf and admin set section fills with one even colour — a
  low-opacity solid tint of the set's hue, edge to edge, no fade from the top.
- Border stays the same coloured hairline; the open-state outer glow stays, since
  that's the panel edge rather than the fill.
- Untinted sets (and Roster / Favourites / Unsorted) keep the plain panel.

## Technical notes

- `src/components/vault-section.tsx`: swap the `radial-gradient(...) , var(--gradient-bezel)`
  background for a single `color-mix(in oklab, <accent> 10%, var(--card))` solid fill.
- `src/components/secret-cards-panel.tsx` (line ~955): same substitution so the admin
  set sections match the vault.
- No token, migration, or server-function changes; `accent` values and the swatch
  picker stay as they are.
- Verify with `bun run format`, `lint`, `typecheck`, `test`, plus a 360px look at the
  vault and admin console.
