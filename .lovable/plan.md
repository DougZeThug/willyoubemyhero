# Show the odds on the daily secret pull

The draw is already fair — a flat random pick among the cards you don't own yet,
with the rarity tier rolled separately. Nothing about the selection changes. What
changes is that the pull screen stops being silent about the pool, so the overlap
everyone is noticing reads as "we've all nearly swept a small set" rather than
"this thing is rigged".

## What you'll see

On the pack / secret screen, under the daily card:

- **Collected 19 of 39** — how much of the league catalogue you hold.
- **20 left to find** — and when that hits zero, a line saying every future pull
  is a duplicate (which is already what happens, just never explained).
- **Tier odds** for the rarity roll, printed as the real numbers:
  Mythic 0.5% · Legendary 3.5% · Epic 8% · Rare 18% · Common 70%.
- A one-line note that the next card is picked evenly from what you're missing —
  so newly added cards are no rarer than old ones, they've just had fewer days.

Nothing names an unpulled card. You see counts and odds only, never the
catalogue.

## Technical notes

- `SecretDayStatus` in `src/lib/secret-cards.ts` gains `total` (count of active,
  pullable cards) and `remaining`. That is a deliberate relaxation of the current
  "never how many exist" comment on `pulled` — a count is not an identity, and
  the comment gets rewritten to say exactly where the new line is drawn.
- `secret_pull_status` already runs server-side with the full catalogue in
  reach; the two counts come from the same predicate `pull_secret_card` uses
  (`active AND art_path IS NOT NULL AND weight > 0`) so the number on screen is
  the number actually drawn from. Done in the RPC via migration, keeping the
  existing shape and idempotency (`CREATE OR REPLACE`).
- Odds come from the existing tier table in `src/lib/secret-rarity.ts` —
  rendered from `SECRET_TIER_ORDER` and its basis points, never hardcoded in the
  component, so the ladder and the printed odds can't drift.
- New presentational piece `src/components/secret-odds.tsx`, rendered on
  `src/routes/players.pack.tsx` near the secret slot and on the secrets shelf
  header in `src/routes/players.index.tsx`.
- Tests: extend `src/lib/secret-cards.functions.test.ts` for the new status
  fields, a unit test asserting the printed odds sum to 100%, and a `tests/db`
  assertion that the status counts match the pull predicate.
