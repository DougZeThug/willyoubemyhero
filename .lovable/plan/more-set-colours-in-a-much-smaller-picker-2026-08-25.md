# More set colours, in a much smaller picker

Two changes to the admin Sets list.

## More colours

Grow the set-accent palette from 10 to 20, walking the hue wheel so neighbours stay tellable apart at swatch size:

Cyan · Teal · Mint · Green · Lime · Gold · Amber · Orange · Ember · Red · Crimson · Rose · Pink · Magenta · Purple · Violet · Indigo · Blue · Azure · Slate

All new ids are add-only, so every set already themed keeps its colour.

## Smaller picker

Today each set spends two wrapped rows on a "COLOUR" label plus eleven 24px circles — with 20 colours that would be worse. Replace it with a single compact control on the same row as the set name:

- One small round swatch button showing the set's current colour (a dashed outline ring when untinted).
- Tapping it opens a popover with the full palette as a tight grid of swatches plus a "No colour" option. Picking one saves immediately and closes the popover.
- The popover grid is finger-sized (28px targets) even though the collapsed trigger is tiny, so it stays usable one-handed in a garden.

Net effect: each set row shrinks by roughly one and a half rows of height, and the list of sets is scannable without scrolling past colour strips.

## Technical notes

- Palette entries go in `SET_ACCENTS` in `src/lib/secret-cards.ts`; `setAccentColor` and the stored-id contract are unchanged, and no migration is needed since `secret_collections.accent` is a free text column validated against the list.
- The picker becomes a small `SetAccentPicker` component (shadcn `Popover` + swatch grid) used by the Sets row in `src/components/secret-cards-panel.tsx`, replacing the inline strip. It keeps the same `runSetEdit` save path, busy-state disabling and `aria-pressed`/`aria-label` wiring so existing admin tests keep passing.
- If any test asserts on the inline swatch strip, it gets updated to open the popover first.
