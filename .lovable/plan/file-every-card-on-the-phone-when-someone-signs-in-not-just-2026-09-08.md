# File every card on the phone when someone signs in, not just the first 64

A guest's packed player cards live only on the handset until the moment they sign in or
redeem a code — that transition is where they get filed against the account. Today the
filing call sends at most 64 cards, but the handset's store keeps every card from every
combine it has ever played and is never emptied. A long-standing player therefore has
some cards left unfiled, and the clean-up that runs straight afterwards deletes exactly
those — permanently, at the moment they were trying to secure them.

## Fix

Send the whole store, in batches, instead of truncating it.

### `src/lib/adopt-collection.ts`

- `adoptableIds(snapshot)` returns **all** ids in the snapshot; the `.slice(0, 64)`
  goes. Its doc comment gains the reason the cap was wrong: the store is multi-event
  and never cleared, so "64 is a whole roster" was never true here.
- `adoptLocalCollection` splits the ids into chunks of 64 (the server's per-call limit
  stays as it is — no schema or migration change) and awaits them **in sequence**,
  summing `adopted`. Sequential rather than parallel: each call is a service-role write
  through the same RPC, and a burst from one phone at the sign-in transition buys
  nothing.
- If a chunk throws, the error propagates as today, so the existing retry-then-abandon
  handling in `use-account.ts` and `claim.tsx` is unchanged. Earlier chunks stay filed,
  which is strictly better than the current behaviour — filing is idempotent, so the
  retry re-sends everything harmlessly.

Nothing else changes: `use-account.ts`, `claim.tsx`, `players.pack.tsx` and
`collector-signup.tsx` keep calling the same two functions, and the pack-carry skip
list now covers every id the filing actually attempted rather than the first 64.

### Tests

`src/lib/adopt-collection.test.ts` (new, or extending the existing collection tests):

- a snapshot of 150 cards is filed in three calls of 64/64/22, and every id appears
  exactly once across them;
- the returned count is the sum of the calls;
- an empty snapshot makes no call;
- `adoptableIds` returns every id in the snapshot, including past the 64th.

Existing tests in `src/hooks/use-account.test.ts` and the claim tests are checked and
adjusted only where they assert the old cap.

## Verification

`bun run format`, then `bun run lint`, `bun run typecheck`, `bun run test`. No new
dependencies, no server function, RPC or migration changes.
