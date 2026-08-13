# The vault grid never gets told which finish you hold

## What's wrong

On the players page, the word under the card is right — Danielo reads SILVER — but the
card itself is drawn with no finish at all. The label and the card are fed from two
different places, and only the label was wired up. So no tile in the vault has ever worn
a metal ring: the gold you can see around Daniel's card is his artwork, not the app.

Confirmed on the live page: there are zero finish-frame elements rendered anywhere in
the grid.

The player detail page, the pack stand and the pack summary all pass the finish through
correctly, which is why the ring shows up there and not here.

## The fix

Pass the finish you own into the card in the vault grid, exactly as the detail page
already does. Locked cards stay as they are — an unpulled card's finish is the one thing
that shouldn't be given away.

Nothing else changes: same ring treatment, same colours, same single word underneath.

## Technical notes

- `src/routes/players.index.tsx` (~line 372): the roster `<HoloCard>` is missing the
  `edition` prop. Add `edition={toEdition(collected[p.id]?.edition)}` — the same
  expression already computed one line above for `tileBadge`. `toEdition` is imported.
- No other render site is affected; `rg 'edition='` shows the detail page, pack stand and
  pack summary already pass it.
- No CSS, database or server changes.
