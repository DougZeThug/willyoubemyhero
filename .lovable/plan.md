# Vault: roster last, and arrows out of the way

Two changes on the players page (the vault), both presentation-only.

## 1. Roster sits at the bottom by default

Today the default order is Favourites, Roster, then each secret set. The default
becomes Favourites, secret sets, then Roster last. It stays movable like any
other shelf, and any device that has already rearranged its shelves keeps the
order it chose — the change only affects the default.

## 2. Up/down arrows stop competing with the collapse header

Right now each shelf header is a tap target that rolls the section open, with two
small arrow buttons immediately to its right. On a phone the two live within a
thumb's width of each other, which is exactly the mistap the request describes.

The arrows move behind an explicit mode:

- A single small "Rearrange" toggle sits once at the top of the vault.
- With it off (the default), headers show only the title, count and chevron —
  the whole row is collapse, nothing else.
- With it on, each header grows its two arrow buttons, visually separated from
  the title by a divider and a gap, and the header no longer toggles collapse
  while rearranging, so a stray tap can't roll a shelf up mid-move.

## Technical notes

- `src/routes/players.index.tsx`: move the roster entry after the secret groups
  in the `sections` array; add the rearrange-mode state and the toggle control.
- `src/components/vault-section.tsx`: accept a `rearranging` prop; render the
  move buttons only when set, add the separator/gap, and suppress the collapse
  trigger while it is on.
- `src/components/vault-section.test.tsx` gets a case for each mode.
- No storage-shape change: `wwbh:vault-layout` keeps `{ order, collapsed }`, so
  existing saved layouts still apply.
