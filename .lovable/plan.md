# Trading visibility audit — what I found and what to fix

## What the data says about David's Tucker

I queried the live database. David Weidensaul's Tucker copy is intact and, by every
rule in the trading code, should be offerable:

- One Tucker card exists (set: legacy pets).
- David's copy is on his account, marked granted, dated Aug 10 — it reached him
  through an accepted trade from Ryan Pham on Aug 18.
- Granted copies are tradeable immediately, so the "today's pull isn't a spare yet"
  rule does not apply to it.
- He has no duplicate/second account holding cards; a second inactive "David
  Weidensaul" row exists but owns nothing and is hidden from the roster.

So the card is not missing from the database — something on the viewing side is
showing an out-of-date or wrong-identity list. That has to be reproduced before it
can be called fixed, so it is step 1 below rather than an assertion.

## What is definitely broken (verified)

1. **96 secret cards are stranded on device-only identities.** 27 device
   identities hold pulls with no player attached. Cards in that state still show
   in that person's vault, but the trading post only ever looks up cards by
   player, so they are invisible in "available cards" and can never be staked.
   Three of the nine Tucker copies in the game are in exactly this state — which
   is very likely what the group chat is arguing about.
2. **Three signed-in accounts have no player attached at all.** They can open
   packs and see their cards, but they cannot trade and they do not appear in
   anyone's trade-partner list. The only place that asks a signed-in person to
   pick a collector name is the trading post itself, so anyone who never opened
   that screen stays invisible.
3. **Player cards you only own one of are silently absent** from your own picker
   (spares-only rule). That is intended, but the picker gives no reason, which
   reads as a bug — "some of my cards I can't even trade".
4. **Stale lists.** A counterparty's spares can be served from a cache for
   several minutes after a trade, so a card can appear/disappear wrongly right
   after a swap.

## The plan

**Step 1 — reproduce and instrument (before changing rules)**
Add a commissioner-only "card ownership audit" panel in Admin listing, per person:
cards on their account, cards stranded on a device identity, and which of those
are tradeable and why not. This turns "why can't I see Tucker" into a one-screen
answer for any player, including David, and confirms whether his case is a cache
problem or an identity problem.

**Step 2 — reunite stranded cards**
In the same panel, let the commissioner attach a device identity to a player,
running the existing merge routines so packs and secrets move over safely
(no duplicates, no lost daily-pull state). Then walk the 27 stranded identities
and attach the ones that clearly belong to a known player.

**Step 3 — stop it happening again**
- Ask any signed-in person without a player to pick their name from anywhere in
  the app (vault and pack screens), not only the trading post.
- On sign-in and on code claim, re-run the merge for every device identity known
  to that browser, not just the most recent one.

**Step 4 — make the picker honest**
- Show non-tradeable player cards greyed out with the reason ("spares only — you
  own one").
- If a card is held on this device but not yet on the account, show it greyed with
  "not on your account yet" plus a fix button.
- Refresh both sides' spares on window focus and after every accepted trade so a
  stale list cannot outlive a swap.

## Technical notes

- Trading eligibility lives in `trade_item_is_spare` (database) and
  `getTradeSpares` in `src/lib/trades.functions.ts`; both key off
  `participant_id`, which is why device-held rows vanish.
- Merges use the existing `claim_guest_secrets` / `claim_guest_packs` /
  `merge_guest_pulls` routines already called from `account.server.ts`,
  `collector.server.ts` and `member.functions.ts` — the admin tool reuses them
  rather than writing new SQL.
- Trade-partner reachability is `reachable` in `src/lib/member.functions.ts`
  (claimed code or linked account), which is why accounts with no player never
  appear.
- No rarity strings, award ids, or existing card records change; no data is
  deleted.
