# Trading Post: secrets first, then base cards, both rarest-first

Right now the spare picker on the Trading Post lists every roster copy first and
dumps the secrets on the end, sorted only by player id. On a phone that means
scrolling past a dozen base cards to reach the cards people actually want.

## What changes

For both panels (your spares and theirs), the horizontal strip becomes:

1. **Secret cards first**, rarest copy first: Mythic, Legendary, Epic, Rare,
   Common. Ties broken by card name so the same card's copies sit together.
2. **Base/roster cards after**, ordered by the card's earned tier — champion,
   podium, station king, penalty box, DNF, base — then by finish (platinum,
   gold, silver, bronze, standard), then grouped by player so duplicate copies
   of one card stay adjacent.

Nothing about what is tradeable changes: secrets are still all tradeable
including last copies, roster cards are still spares-only.

## Technical notes

- `SparePicker` in `src/routes/players.trade.tsx` builds the `items` array —
  swap the two spreads and replace the sort comparators.
- Secret ordering uses the existing `secretTierRank` from
  `src/lib/secret-rarity.ts`.
- Roster ordering needs a tier rank; `src/lib/card-rarity.ts` has no exported
  order today, so add a `RARITY_ORDER` const plus a `rarityRank(tier)` helper
  there (rarest first) and read each copy's tier through the existing `lookup`
  the picker already receives. Finish order keeps using `editionRank`.
- Presentation only — no server function, RPC or schema changes.
