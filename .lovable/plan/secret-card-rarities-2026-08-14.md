# Secret card rarities

Every secret card copy gets its own rarity level, rolled when you pull it — the
same idea as the metal finishes on player cards, but with its own vocabulary so
the two can never be confused. The card's look (Ember, Jade, Onyx, the prism
edge) is untouched; the rarity is printed as a label under the card.

## The ladder

Five tiers, each with its own colour and its real pull chance printed beside it:

| Tier      | Odds  |
| --------- | ----- |
| Mythic    | 0.5%  |
| Legendary | 3.5%  |
| Epic      | 8%    |
| Rare      | 18%   |
| Common    | 70%   |

Label under a card reads e.g. `MYTHIC · 0.5% pull`, in that tier's colour.
Common shows too (so every secret says something), just in muted type.

## What changes

- Pulling a secret rolls a tier, stored on your copy of that card. Pulling a
  duplicate keeps the better tier, never downgrades.
- The tier shows under the card everywhere a secret appears: the pull reveal,
  the enlarged card sheet, and the secrets shelves in the vault.
- Rarer tiers get a slightly stronger bloom on reveal, and Legendary/Mythic fire
  the celebration burst.
- Nothing about the existing foils, prism edge, border effects, or the
  admin-set pull weight changes — weight still decides *which* card you get,
  the new tier decides *how good your copy is*.

## Technical notes

- New `src/lib/secret-rarity.ts`: `SecretTier` union, rarest-first order,
  basis-point weight table summing to 10,000, `rollSecretTier(seed)`,
  `bestSecretTier(a, b)`, `secretTierLabel`, `secretTierOddsLabel`, tier accent
  colours — mirroring the structure of `card-edition.ts` so the two ladders stay
  legible side by side but share no strings.
- Migration: add `tier text not null default 'common'` to `secret_card_pulls`
  plus a `secret_tier_rank()` SQL helper, and update `pull_secret_card` /
  `grant_secret_card` / `claim_guest_secrets` to roll and keep-best the tier
  server-side (the roll must be authoritative, same reason the pull itself is).
  Idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`) so `test:db` replays clean.
- `SecretCardRow` / `OwnedSecret` in `src/lib/secret-cards.ts` and
  `secret-cards-db.server.ts` carry the tier through; `getMySecrets` selects it.
- Render sites: `secret-card-sheet.tsx`, `secret-card-tile.tsx` (vault-facing
  usage), the secrets shelves in `players.index.tsx`, and the fourth-slot reveal
  in `pack-stand.tsx` / `pack-summary.tsx`.
- Tests: unit tests for the weight table summing to 10,000, deterministic roll,
  keep-best; a `tests/db` test pinning the SQL rank order against
  `SECRET_TIER_ORDER`; update existing secret fixtures and mocks.
