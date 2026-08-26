# Hide the art on cards you don't own yet

In the Trading Post, another person's cards currently show their full front art —
so scrolling their spares, or reading an incoming offer, spoils art you have never
pulled. Fix: any card on the other side that you do not already own renders
face-down using the universal deck back, with its name and rarity/tier still
readable underneath.

## What changes on screen

- **Make an offer → their spares strip**: cards you already own look exactly as they
  do today. Cards you don't own show the universal back, with the name, rarity or
  secret tier, and any finish label still shown in the caption. They stay fully
  selectable.
- **Offer cards (inbox, outbox, and the settled receipts)**: the "You get" side
  follows the same rule. Your own "You give" side is always face-up — they're your
  cards.
- **Your own spares and your "can't be traded" cards** are unchanged.
- The one-line summary ("Lauren Hoffman for Dragon") is unchanged: names were
  already public, only the art is protected.

## Technical notes

Ownership can't be worked out on the phone for secrets — `SecretSpare`
deliberately carries no `secretCardId` — so the server decides.

- `src/lib/trades.ts`: add `viewerOwns: boolean` to `SecretSpare` and to the roster
  spare type, and to the item shapes inside `TradeOfferView`.
- `src/lib/trades.functions.ts`: in `getTradeSpares` and `getMyTradeOffers`, load
  the caller's own holdings once (their `card_pulls` participant ids and their
  `secret_card_pulls` card ids) and stamp `viewerOwns` on every hydrated item.
  Ids are derived server-side from rows the caller is entitled to see — no card id
  ever comes in off a request, keeping the existing invariant intact.
- `src/components/trade-offer-card.tsx`: `TradeItemTile` gains a `concealed` prop.
  When set, it renders `HoloCard` face-down against the event's universal back
  (`useEventCardBack`, same source the vault and pack use, falling back to the
  existing `SealedBack`) instead of the front art, keeps the caption block, and
  adds a small "not yours yet" hint. Selection, blocked labels and sizing behave
  as they do now.
- `src/routes/players.trade.tsx`: pass `concealed` from `viewerOwns` for the
  counterparty picker; `TradeOfferCard` applies it to the "you get" strip only.

## Verification

- `bun run format`, `bun run lint`, `bun run typecheck`, `bun run test`.
- Preview at 360px: a counterparty card you don't hold shows the deck back with
  its name and tier; one you already hold shows its art.

## Out of scope

- Changing which cards are tradeable, or hiding names/tiers.
- Any change to the pack, vault, or league feed.
