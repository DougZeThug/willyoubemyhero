# Why Ryan can't see that Ashley Marquart card

## What the data actually says

I traced every copy of the Ashley Marquart secret card. Eight copies exist. The
player records holding one are **Doug Weidensaul**, Steven Lipko and AJ Dewalt —
plus four copies still sitting on anonymous guest devices. The claimed player
record named **David Weidensaul** holds exactly one secret card, "Leo & Mr. Big",
and no Ashley copy at all.

So it is Doug Weidensaul's record that holds the card, and Doug is the one person
in the league who has signed into an account (his account is linked to that player
record) but has **never claimed a paper code** — his `claimed_at` is empty.

That is the bug. Two places in the app treat "has claimed a paper code" as the
only proof a person has a device that can answer an offer:

- the counterparty picker on the Trading Post filters the roster down to claimed
  players, so Doug never appears as somebody to trade with;
- the database's `create_trade_offer` refuses any recipient with no claim
  timestamp, so even a hand-built offer to him would be rejected.

Signing into an account is equally good proof — arguably better, since it follows
him between phones. Nothing else about the trade rules is wrong: single copies of
secret cards are already tradeable (the "you must keep one" rule applies only to
roster cards), and the picker already lists every copy individually.

## The fix

1. **Treat an account-linked player as reachable.** Extend the "can be traded
   with" test to mean *claimed a code OR linked to a signed-in account*. Applies
   in two places, and they must agree:
   - `getClaimRoster` gains a `reachable` flag derived from both facts, and
     `src/routes/players.trade.tsx` filters counterparties on that instead of
     `claimed`. The `/claim` page keeps using `claimed` exactly as today, so
     nothing about issuing or re-issuing paper codes changes.
   - a migration replaces the recipient check inside `create_trade_offer` with
     the same OR, so the server agrees with the picker.
2. **Confirm the identity mix-up with the user.** Doug Weidensaul, David
   Weidensaul and a second empty "David Weidensaul" record all exist. Once
   trading with Doug works I will report which record actually holds Ashley so
   you can decide whether a record needs renaming or merging — no player data
   gets changed without you saying so.

Left deliberately alone, per your answer: a secret pulled **today** stays
untradeable until tomorrow, because that row is the person's spent daily slot and
handing it over would earn them a second pull.

## Technical notes

- `src/lib/member.functions.ts` — `getClaimRoster` joins `account_identities` and
  returns `reachable: claimed || hasAccount`.
- `src/routes/players.trade.tsx` — counterparty filter uses `reachable`; empty
  state copy updated ("Nobody else has claimed or signed in yet").
- New migration — `create_trade_offer` recipient guard becomes: a row in
  `member_codes` with `claimed_at IS NOT NULL`, **or** a row in
  `account_identities` for that participant. Idempotent `CREATE OR REPLACE`.
- Tests: extend `src/lib/trades.functions.test.ts` / `tests/db/trades.test.ts`
  with an account-linked, code-unclaimed recipient, and the e2e picker case in
  `e2e/trades.spec.ts`.
