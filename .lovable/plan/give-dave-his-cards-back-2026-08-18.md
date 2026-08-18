# Give Dave his cards back

Dave claimed his player on 31 July and pulled through 6 August. When new member
codes were issued, his phone's old token stopped working and the app quietly
dropped him to an anonymous visitor — so every pull since then has been filed
against a device, not against him.

## What the data actually shows

- **His claimed player** (claimed 31 Jul) holds: 1 secret card (Leo & Mr. Big,
  6 Aug), 6 roster cards, 2 pack opens and 1 timed run.
- **His phone since then** is an anonymous device with 12 secret cards,
  6 Aug through 18 Aug, including the **Legendary Ashley Marquart** (15 Aug)
  and a **Rare Thuy Nguyen** (17 Aug). Nothing else in the app is attached to
  that device — anonymous visitors can only hold secret cards.
- **There are two "David Weidensaul" player records.** The original is the one
  above. The second, created 11 Aug, holds no collection at all — it exists
  only as **his card in the 2026 combine**, which eight other people have
  already packed (14 copies out there). It is not a stray duplicate to delete;
  it is the roster entry his card art hangs off.

## The fix

1. **Fold the anonymous device into his claimed player.** The existing
   `claim_guest_secrets` routine does exactly this and is the same path the
   app uses when a guest claims a code: cards he does not already own move
   across intact, a card he already holds arrives as a duplicate, and if the
   device's copy rolled a better tier than his, the better tier wins. He keeps
   Leo & Mr. Big and gains the other 11, Legendary Ashley included. Nothing is
   deleted.

2. **Merge the two player records into one.** Move the 2026 combine entry from
   the second record onto his original claimed player, then deactivate the now
   empty second record. The card, its art and all 14 copies other people hold
   travel with the entry untouched — they point at the roster entry, not at the
   player record — so nobody loses a card and the "Packed by N" counts do not
   move. Afterwards he is one person: one claim, one collection, one card.

3. **Get his phone signed back in.** Once the data is merged, issue him a fresh
   code and have him claim it, or have him sign into an account on that phone —
   an account survives a code re-issue, which is what would have prevented this.

## Why this happened, and stopping the repeat

Re-issuing codes invalidated the token his phone was holding, and the app has no
"your session expired, claim again" prompt on the pack screen — it simply falls
back to anonymous and keeps dealing cards. After the merge I will check whether
any other player is in the same position (a claimed player whose pulls stop dead
on a date an anonymous device picks up), and report what I find rather than
guessing.

## Technical detail

- Data-only changes, no schema work:
  - `SELECT public.claim_guest_secrets('<david>', 'b0cb6ce0-…')`
  - `UPDATE public.event_participants SET participant_id = '<david>' WHERE id = 'f6a1f279-…'`
  - `UPDATE public.participants SET active = false WHERE id = '422926b4-…'`
- `event_participants` is unique on `(event_id, participant_id)`; his claimed
  player has no row in that event, so the move cannot collide.
- `card_copies`, `card_pulls`, `card_comments` and `card_reactions` all key off
  `event_participant_id`, which does not change — no cascade, no recount.
- Counts will be read back after each step and reported.
