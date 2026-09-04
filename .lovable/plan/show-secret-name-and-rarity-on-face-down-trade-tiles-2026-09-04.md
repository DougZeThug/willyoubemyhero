# Show secret name and rarity on face-down trade tiles

Counterparty secret cards you do not own currently render as "Secret card" with no art. The art should stay hidden, but the card's actual name and tier/rarity should remain readable so users can judge an offer.

## What changes

1. **Fix `hydrateSecrets` in `src/lib/trades.functions.ts`.**
   - Always fetch `secret_cards.name` for every row being hydrated, regardless of the `concealUnowned` flag.
   - Only suppress the **art**: set `artUrl` to `null` (and skip signing) when `concealUnowned` is on and the viewer does not own the card.
   - Keep `tier` from the pull row — it is already exposed and drives the rarity label/pips.
   - Preserve the existing `"Secret card"` fallback only for genuinely retired cards whose `secret_cards` row no longer exists.

2. **Update tests in `src/lib/trades.functions.test.ts`.**
   - Rewrite the existing test that asserts an unowned counterparty secret returns `name: "Secret card"` so it now expects the real name with `artUrl: null` and `viewerOwns: false`.
   - Add or tighten an offer-view test verifying that a staked secret you do not own still carries its name and tier while its art is hidden.

3. **Confirm the tile UI needs no change.**
   - `TradeItemTile` already renders `name` and `tier`/`LevelPips` independently of the `concealed` prop, and adds the "Not yours yet" hint only when `concealed` is true. No component change is required.

## Verification

- `bun run format`
- `bun run lint`
- `bun run typecheck`
- `bun run test` (focused on `src/lib/trades.functions.test.ts` first, then full suite)

## Out of scope

- No migration or dependency changes.
- No change to roster-card concealment (roster cards are public and remain face-up).
- No change to which cards are tradeable or to the public trade feed redaction.
