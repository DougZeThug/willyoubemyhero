# Name the secret cards in the trade feed

Right now the league feed says "David Weidensaul sent a secret to Ryan Pham for a secret". Secret card identities are deliberately stripped when a trade settles, so the name simply is not stored anywhere the feed can read. This adds the name — visible to everyone — and recovers names for trades that already happened.

## What changes

- A settled trade records the name of each secret that moved, alongside the roster cards it already records.
- The feed reads: "DAVID WEIDENSAUL sent DRAGON to RYAN PHAM for ROCKY". Mixed sides read "1 card + TUCKER".
- Existing trades are backfilled from the stored offer items, so the whole feed reads the same way — no "a secret" leftovers.
- The offer cards ("Recently settled", incoming/outgoing) already show card names and are unchanged.

## Privacy note

The trades table is readable by everyone in the app, so this makes every traded secret's name public. Card art and the rest of the secret catalogue stay server-only — only names of cards that were actually traded become visible. This is the trade-off you chose; flagging it once so it isn't a surprise later.

## Technical detail

Database migration:

- `accept_trade_offer`: change the two summary aggregates so a secret item builds `{"kind":"secret","secretCardId":…,"name":…}` instead of `{"kind":"secret"}`, joining `trade_offer_items` → `secret_card_pulls` → `secret_cards`.
- Update the `COMMENT ON COLUMN public.trades.proposer_gave` redaction note to describe the new, intentionally wider shape.
- One-time backfill `UPDATE` over `public.trades`, rebuilding both summary columns from `trade_offer_items` for rows whose `offer_id` is still present; rows without recoverable items keep their current shape.
- Idempotent (`CREATE OR REPLACE`, backfill guarded on the item join) so the db test suite replays it cleanly.

Client:

- `src/lib/trades.ts`: widen `TradeSummaryItem`'s secret variant with optional `secretCardId` and `name`; `tradeSummaryLabel` lists named secrets by name and falls back to the existing "a secret" / "2 secrets" wording when a name is absent (older rows, unknown data).
- `src/routes/players.trade.tsx`: no structural change — it renders `tradeSummaryLabel`; update the comment above the feed that currently states secrets are unnameable.
- `src/lib/trades-db.server.ts` row type follows the widened type.
- Extend the existing `tradeSummaryLabel` unit tests to cover named, unnamed and mixed sides.
