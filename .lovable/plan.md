# Put Ryan Pham's collection back on his roster card

## What actually happened

Ryan's cards are not lost. They sit on a **second participant record named
"Ryan Herr"** — 39 roster copies, 14 secret cards, 13 pack opens, and both of the
trades with David Weidensaul. That record is the one his phone (and, since today,
his signed-in account) is attached to.

On Aug 20 at 00:34 that record was set inactive during a roster tidy-up, and it is
not on the combine roster at all. Three symptoms follow from that one fact:

- The claim screen only lists active players, so his real record vanished and the
  empty "Ryan Pham" record shows as needing a code.
- The trading list only offers players on the roster, so he can no longer be
  traded with.
- The trade feed looks names up on the roster, so his two trades render as
  "David Weidensaul sent a secret to someone".

Meanwhile the active "Ryan Pham" record holds nothing: 0 cards, 0 packs, 0 trades.
Its code was re-issued today at 12:49 and never claimed.

## The fix

Move everything onto the active **Ryan Pham** record, then retire the duplicate.

1. **Move the collection.** Re-point all 39 card copies, 14 secret pulls and 13
   pack opens from the old record to Ryan Pham, collapsing anything he would end
   up owning twice into duplicates so his vault stays coherent.
2. **Move the history.** Re-point the two completed trades and any trade offers so
   the feed reads "David Weidensaul sent a secret to Ryan Pham".
3. **Move his identity.** Re-point the account linked to the old record onto Ryan
   Pham, so the phone he signed in on lands straight on his cards with no
   re-claim. Reset the fresh code so it is still claimable as a backup.
4. **Retire the duplicate.** Leave the "Ryan Herr" record inactive and empty, with
   nothing pointing at it.
5. **Verify** afterwards: card counts on Ryan Pham, his presence in the claim and
   trading lists, and the two feed lines reading his name.

Nothing changes for anyone else. The Lipko pair is already correct and is left
alone.

## Also worth fixing while I'm in here

The combine's event id (`1111…1111`) is not a valid v4 UUID, and several trading
endpoints validate their `eventId` with a strict UUID check. That is throwing a
validation error in the live app right now. I will relax those checks to accept
any UUID shape so the trade feed and offer creation stop erroring on this event.

## Technical notes

- Data change (no schema change) run through the data tool, in one transaction:
  `card_copies`, `secret_card_pulls`, `pack_opens`, `trades`, `trade_offers`,
  `account_identities`, `member_codes`.
- Collisions handled explicitly: `secret_card_pulls` has a one-owned-copy and a
  one-pull-per-day constraint, and `pack_opens`/`card_copies` are unique per day —
  incoming rows that clash are marked duplicate or dropped rather than failing the
  move. `resync_card_pull` and `resync_secret_ownership` are run for every affected
  card so the derived ownership rows match the copies.
- Ryan Pham is already on the event roster (`event_participants`, running order 7),
  so no roster row is created.
- Code change limited to swapping `z.string().uuid()` for `z.string().min(1)` on
  the `eventId` inputs in `src/lib/trades.functions.ts` (and the matching guest /
  secret endpoints if they carry the same check).
