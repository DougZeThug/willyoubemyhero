# Make burn values match the printed ladder

## What's wrong

The shop advertises Platinum 100 / Gold 40 / Silver 20 / Bronze 10 / Standard 5,
but almost every card in the app burns for 5. That is not a display bug — the
payout really is 5.

Cards carry a flag saying who decided their finish. Only finishes the server
rolled itself pay by the ladder; anything a phone claimed pays the flat floor of
5, so a forged Platinum can't be farmed. The app only started rolling finishes
itself on 26 August. Everything from before that — 322 of the roughly 409 copies
in the app, including the whole 17 August backfill and every adopted collection —
is flagged as phone-claimed, so it pays 5 whatever finish it shows.

## The fix

Grandfather in every copy that exists today: mark them all as server-decided, so
their printed finish is the one they get paid for. Gold burns for 40, Silver 20,
Bronze 10, exactly as the shop says.

The trust rule itself stays in place for anything created from now on, so a
finish claimed by a device in future still pays the floor rather than the top of
the ladder.

## Effect

- Roughly 322 copies start paying their real ladder value.
- A one-off increase in how much dust the league can mint from spares — about
  2,900 dust in total across thirteen people, which is roughly nineteen bonus
  pulls spread over everyone.
- Nothing already spent or earned changes; no balances are edited.

## Technical notes

- One idempotent migration under `supabase/migrations/`, dated after the
  marketplace one: `UPDATE public.card_copies SET edition_asserted_by = 'server'
  WHERE edition_asserted_by <> 'server'`, with a comment recording that this is a
  one-time grandfathering of the pre-26-August fleet.
- No change to `mill_value`, `mill_card_copy`, `MILL_BY_EDITION`,
  `MILL_CLIENT_FLAT` or `millValue` — the ladder and the trust rule are already
  correct, only the data is stale.
- `adopt_card_copies` keeps writing `'client'`, so adopted collections after this
  migration still mill at the floor. Left alone deliberately: that path takes the
  finish from the device.
- Existing tests in `src/lib/dust.test.ts` and `tests/db/dust.test.ts` continue to
  pass unchanged, since neither the ladder nor the untrusted-pays-floor behaviour
  moves.
