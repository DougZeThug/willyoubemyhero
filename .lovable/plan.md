# Let signed-in non-players trade

Right now the whole trading system is keyed to roster players. Two people signed in with their email, but because they aren't in the combine they have no player identity, so they can't be offered a trade and don't show in the picker. This gives every signed-in account a tradeable identity of its own — a "collector" — without putting them on the roster, the leaderboard or the draft.

## What changes for people using the app

- A signed-in user who isn't a combine player opens **Trading** and is asked once: "Pick a name to trade under" (pre-filled from their email). One tap and they're in.
- From then on they appear in everyone's **Make an offer** list and in the **Around the league** feed under that name, and can propose, accept and decline trades exactly like a player.
- Anything they pulled as a guest on that phone (packs, secrets) comes with them.
- They stay off the roster, the leaderboard, the draft, and the "needs a code" claim list — they're collectors, not athletes.
- The commissioner sees them in the admin console, clearly marked as collectors, and can grant them secret cards and rename them.

## Technical notes

**Schema (one migration)**

- `participants.is_collector boolean not null default false`. Collector rows are `active = true` (so all existing trading rules and RPCs work untouched) but excluded from roster surfaces by this flag.
- No change to `trade_offers`, `card_copies`, `secret_card_pulls` or the trade RPCs — a collector is just a participant, so `create_trade_offer`'s existing "reachable = has a linked account" test already passes for them.

**Server**

- New `createCollectorIdentity({ displayName })` in a `*.functions.ts`, behind `requireSupabaseAuth`: refuses if the account already has a participant, otherwise inserts a `is_collector` participant, upserts `account_identities.participant_id`, merges the account's prior `guest_id` via the existing `claim_guest_secrets` / `claim_guest_packs` RPCs, and mints a member token so the device becomes a member.
- `getClaimRoster` gains `isCollector` on each row; it already computes `reachable` from `account_identities`, which covers collectors.
- Filter collectors out of roster reads: `/claim` picker (client-side on `isCollector`), `getAllParticipants`, and `generateMemberCodes` targets. Leaderboard/draft/order are driven by `event_participants`, which collectors never join — nothing to do there.
- Keep collectors in the admin roster panel and the secret-card grant picker, tagged "collector".

**Client**

- `players.trade.tsx`: when signed in but the device has no member identity, render a "Choose your trading name" card (input pre-filled with the email local part, title-cased) instead of the "you're not a player" state; on submit call the new server fn, store the token, invalidate the roster and offer caches.
- Existing counterparty filter needs no change — collectors arrive `reachable: true`.

**Tests**

- DB test: a collector participant is tradeable and `create_trade_offer` accepts them as recipient.
- Unit tests: `createCollectorIdentity` refuses a second identity, merges guest pulls, and `getClaimRoster` marks collectors.

**The two existing accounts** need no data fix — they'll get the name prompt the next time they open Trading, and their guest pulls fold in at that point.
