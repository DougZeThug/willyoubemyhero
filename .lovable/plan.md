## What's actually happening

Every player card reads "Packed by 1" because that's literally what the database says — and it's misleading. Only one member (Doug) has claimed a code and opened a pack, but on the very first tear his device backfilled every card he'd ever seen as a guest. That single tear wrote one `card_pulls` row for **all 18** roster cards at once, so the count came out uniform.

Confirmed by query:
- `card_pulls`: 18 rows, 1 distinct member, 18 distinct cards.
- Claimed members: 1 (Doug Weidensaul).

The backfill is intentional (see the comment on `recordCardPulls` in `src/lib/card-pulls.functions.ts` and the effect at `players.pack.tsx:552`) — it was meant to seed counts on day one. In practice it makes the counter meaningless: the first person to claim always paints every card they've ever revealed with "Packed by 1", and the number will never distinguish which cards were actually dealt in their packs.

## The fix

**1. Stop backfilling.** In `src/routes/players.pack.tsx`, drop the `loadCollection()` merge in the `recordedForRef` effect and send only `dealtIds` (today's three cards). Update the comment so the next reader doesn't reintroduce it.

**2. Reset the inflated rows.** Run a migration that truncates `card_pulls`. This wipes the 18 backfilled rows so counts start from real pack tears going forward. Doug re-opening today's pack will re-record his three real cards; nobody else has any rows to lose.

**3. Soften the "Packed by 0" / "Packed by 1" cases in the UI.** In `src/lib/card-pulls.ts`, keep "Not yet packed" for 0 but change 1 to read "Packed by 1 so far" (or similar) so a lone pull looks like early-days data rather than a stuck counter. Update `src/lib/card-pulls.test.ts` to match.

## Out of scope

- No schema changes beyond the truncate; the `record_card_pulls` RPC and the composite primary key stay as-is.
- No changes to the secret-cards pull flow.
- No change to `getCardPullCounts` server function — the aggregate stays public.

## Technical notes

- Files touched: `src/routes/players.pack.tsx` (remove backfill, update comments), `src/lib/card-pulls.ts` + `src/lib/card-pulls.test.ts` (label tweak), one new migration under `supabase/migrations/` that runs `TRUNCATE TABLE public.card_pulls;` and is idempotent.
- `recordedForRef` guard and the fire-and-forget error handling stay untouched.
- E2E and unit tests that assert on "Packed by 1" copy get updated in the same change.
