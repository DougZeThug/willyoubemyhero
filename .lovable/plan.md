# Show the actual colours when picking foils

On a phone, both the per-card foil/border controls and the whole-set "Set look"
row fall back to native dropdowns. Android renders those as a plain OS list of
names — "Foil · Nebula", "Foil · Aurora" — so an admin picks a look blind. Only
the desktop-width layout shows the swatch strips.

## What changes

- Use the same swatch strips on phones as on desktop: a wrapping row of round
  foil chips painted with each foil's own gradient, and a row of real prism-ring
  chips for the border effect. Tap a chip to apply it; the current one is
  ringed with a tick, and its name is printed above the strip so the vocabulary
  survives.
- Drop the phone-only native dropdowns for foil and border on card tiles.
  Thirteen 28px chips wrap to two or three tidy rows at 360px, which is
  acceptable for a control this visual — and it's the only way the colour is on
  screen at the moment of choosing.
- The whole-set "Set look" row gets the same treatment: swatch strips instead of
  selects, with a "Mixed" caption when the cards in the set disagree and no chip
  pre-selected until the admin picks one.
- Everything else is untouched: same server calls, same toasts, same saving
  spinners, same per-card override behaviour.

## Technical notes

- `src/components/secret-card-tile.tsx`: remove the `sm:hidden`
  `CompactLookSelect` blocks and render `FoilPicker` / `BorderFxPicker` at all
  widths.
- `src/components/secret-look-picker.tsx`: allow the strips to render a
  "Mixed"/unset state (no chip checked) and a compact size variant for tighter
  rows; keep the native-radio implementation so arrow keys and the "3 of 13"
  announcement still work. `CompactLookSelect` / `FoilSwatch` stay exported only
  if still used elsewhere, otherwise they are removed.
- `src/components/secret-cards-panel.tsx`: `SetLookRow` swaps its two `<select>`
  elements for the strips, keeping the `saving` disabled state and spinner.
- Keep the `animate` guard on border previews off except for the row being
  touched, per the note in `styles.css` about permanently animating layers.
- Verify with `bun run format`, `bun run lint`, `bun run typecheck`,
  `bun run test`, and a 360px pass over the admin Secret Cards panel.
