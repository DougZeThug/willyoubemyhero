# Sammi's secrets, and why new signers still can't trade

Two separate things, one of them already diagnosed.

## 1. New signed-in people still aren't trade partners

The "collector" feature — a signed-in non-player picks a trading name and becomes tradeable — exists in the project but **has never been published**. The live site everyone is using still runs the old build, so there is no name prompt on Trading, no collector rows were ever created, and the two new accounts remain nameless guests. The database confirms it: both new accounts have a guest id and no player, and there are zero collector rows.

Fix: publish. Then each of them opens **Trading** once, taps the name prompt, and everyone sees them in "Make an offer".

## 2. Sammi's secret cards

Her cards are **not deleted** — every secret pull is still in the database. What's happened is an identity split: an unnamed visitor's collection is tied to a token stored on that one browser. Two accounts signed in tonight (21:28 and 21:29):

- one adopted a long-running visitor identity holding 12 secrets, pulled since Aug 6
- one adopted a brand-new identity created minutes earlier, holding a single card

If Sammi is the second, her earlier collection is sitting on an older visitor id that her account never picked up (a cleared browser, a different browser, or a sign-out beforehand will do it). Three older visitor collections are candidates: 5, 5 and 8 cards, all last pulled earlier today.

Because more than one candidate fits, step one is confirming which pile is hers rather than guessing.

### Steps

1. Ask Sammi two things: roughly how many secret cards she had, and one card she remembers pulling. That is enough to match her to exactly one of the candidate collections.
2. Re-point her account at that collection and fold in anything she has pulled since, using the existing merge routine — a data fix, no code change.
3. Publish, so the name prompt reaches her and the other new account.
4. Once she picks a trading name, her collection is carried onto that collector identity automatically by the existing claim routine, and it stops being device-bound for good.

## Technical notes

- No schema or code change is required for either item. Item 1 is a deploy; item 2 is `merge_guest_pulls` (or `claim_guest_secrets`, once she has a collector participant) plus an `account_identities.guest_id` correction.
- Root cause of the split is that visitor identity lives in `localStorage` and `signOutAccount()` clears it. Naming herself as a collector is the durable fix; a follow-up hardening pass (don't clear the visitor token on sign-out) can be planned separately if you want it.
