# Keep the cards you packed before you claimed

## What happened to Dave

Cards pack differently depending on whether the phone knows who you are:

- **Secret cards** pulled before claiming are stored on the server against a
  guest id, so redeeming a code moves them across (that part works).
- **Base / roster cards** pulled before claiming are only ever stored **on the
  phone**. The server records nothing for a guest.

So when Dave redeemed his code, the app did what it is designed to do for a
claimed member: it treated the league's record as the truth, showed the 9 cards
the server has for him, and deleted the local rows the server could not vouch
for. His guest-era base cards were exactly those rows.

Confirmed in the database: Dave holds 9 base cards / 3 recorded pack opens, all
dated from his claim onwards.

## The fix

**1. Adopt the phone's collection at the moment of claim.**
When a device claims a code (or signs into an account), the app hands its local
collection — card ids plus finishes — to a new member-guarded endpoint that
files them as real copies before anything is pruned. Same ceiling as the pack
tear itself: one row per card, and the participant comes from the verified
token, never the payload.

**2. Don't prune on the first sync after a claim.**
The reconcile step only deletes local rows once the adopt call has succeeded, so
a failed or slow upload can never eat somebody's collection again.

**3. Record guest packs going forward.**
A guest's pack tear currently writes nothing at all. It will record the pack
against the guest id so the count survives the claim too.

**4. Get Dave's cards back.**
His phone's copy is gone, so the honest route is a commissioner action rather
than a guess: a small admin control to hand a named player specific base cards
(recorded as a grant, not a pull, so the public "Packed by N" numbers stay
honest). You pick the cards with Dave, and it takes a few seconds.

If Dave has a second device or browser that still shows the old collection,
signing in there instead would adopt them automatically once step 1 ships.

## Technical notes

- New `adoptCollection` server fn in `src/lib/card-pulls.functions.ts`,
  `requireMember()`-guarded, reusing the `record_card_pulls` RPC with a
  `source = 'adopt'` copy so adopted cards are distinguishable from pulls and
  are exempt from the one-pull-per-day index.
- Migration: widen the `card_copies.source` allowance and add an `adopt` /
  `grant` source; no new tables.
- `claimPlayer` (`src/lib/member.functions.ts`) and the account sync in
  `src/lib/account.server.ts` both trigger the adopt from the client after the
  token lands — server-side they cannot see IndexedDB.
- `useMyCollection` gains an "adopting" gate before `forgetCards` runs.
- Guest pack opens: `record_pack_open` gains a nullable `_guest_id`, mirroring
  `secret_card_pulls`, and `claim_guest_secrets` picks them up on claim.
- Admin grant: server fn behind `requireAdmin`, writing `card_copies` with
  `source = 'grant'` and calling `resync_card_pull`.
