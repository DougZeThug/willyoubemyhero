# Pack page: tighter trio, universal card back for secrets

## 1. Make the three roster cards take less vertical space

On the pack page (`src/routes/players.pack.tsx`), the trio currently renders two-up
(each card spans two of four columns, the third centred underneath), so on a phone
it costs roughly two full card heights before the secret card even starts.

Change it to a compact single row:

- Three columns at every width, with a tighter gap.
- Cap the trio's overall width so cards stay a sensible size and the row does not
  stretch on tablets.
- Shrink the caption block under each card: smaller name/rarity type, single line
  clamp, less vertical gap.
- Drop the `col-start-2` centring logic that only existed for the two-up layout.

The secret slot keeps its current size exactly as-is — it stays the biggest,
most prominent thing on the page, and the trio above it reads as the supporting row.

## 2. Secret cards use the universal deck back

Today a secret card's back is its own uploaded `back_path` art, falling back to the
generated `SecretBackPanel`. Both the pack reveal and the vault sheet should instead
show the same universal deck back every other card uses (the event's uploaded
universal back, already fetched by `useEventCardBack`).

- Pack page: pass the event's universal back URL set into the revealed secret
  `HoloCard` as `backUrl` instead of `card.backUrl`.
- Vault sheet (`src/components/secret-card-sheet.tsx`): fetch the same universal
  back and use it for `backUrl`.
- Keep `SecretBackPanel` as the rendered fallback only when the event has no
  universal back uploaded, so nothing regresses to a blank face.
- No database or upload changes: `secret_cards.back_path` stays in the schema and
  the admin panel keeps working; the pack and vault simply stop reading it for
  display.

## Verification

- `bun run lint` and `bun run typecheck`.
- Preview at 360px: confirm the three cards fit in one row above the fold and the
  secret card is reachable with far less scrolling, and that flipping a secret card
  shows the same back as a roster card.

## Out of scope

- Changing the secret card's front art, rarity foil, or reveal ceremony.
- Removing `back_path` from the database or the admin upload UI.
