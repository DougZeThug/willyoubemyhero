# Trading-Card Engagement Roadmap

Five releases for keeping the card game alive between combines. Theme progression:
**habit → social → chase → economy → mastery.** Each release is independently
shippable, and each one makes the next land harder — trade visibility (R2) makes
spares feel valuable before you're allowed to burn them (R4); completion
trophies (R3) give the dust shop (R4) something worth buying on day one.

## Why this exists

The daily loop is strong but shallow: one pack + one secret per league day with
a great ceremony, but nothing rewards _consistency_ — no streaks, no pity, no
currency, no completion rewards. Dupes have no life beyond trading (the code
treats dupe ceremonies as "a tax" after three). Trading has no pulse — no
notification when an offer arrives, only a focus-refetch. Meanwhile several
ready-made levers sit unused: the `pack_opens` per-day ledger, the
`secret_cards.weight` knob (everything at the default 100), the admin grant
RPCs, and the append-only award categories.

## Constraints every feature below respects

- Guards, not RLS: `requireAdmin` / `requireMember` / `requireActor` first line
  of every mutating handler; participant ids come from the verified token.
- **Editions are client-asserted** (`card-pulls.functions.ts`): an edition never
  enters a number a second person sees without server re-derivation. Secret
  tiers ARE server-rolled (`roll_secret_tier`) and trustworthy.
- **No response carries a total** — the secret set size never leaks;
  denominators are client-side roster data. One designed exception in R3.
- No secret card id in a member-facing request parameter.
- League day = `America/New_York` (`leagueDay()` in `src/lib/trades.ts`).
- New tables pick an explicit posture: server-only (the `card_pulls` shape) or
  public + realtime (the `trades` shape); `tests/db/rls.test.ts` asserts both.
- Migrations replay from empty; vocabularies (tiers, award ids, collection ids,
  source/reason enums) are append-only.
- Zero new npm dependencies across all five releases.

---

## R1 — "Show up every day" (~5 dev-days, one small migration)

### 1a. Pack streaks + milestone rewards (M)

- Streak = walk over consecutive `opened_on` values in `pack_opens`. The table
  already carries `guest_id`, and `claim_guest_packs` merges guest history, so
  streaks are actor-scoped and survive the guest→member claim for free.
- New server-only table `streak_milestone_claims (participant_id,
streak_started_on date, milestone int, claimed_on, PK (participant_id,
streak_started_on, milestone))` — keying by streak start lets a rebuilt streak
  re-earn milestones; the PK makes claims idempotent.
- New RPC `claim_streak_milestone`: lock the participant row FOR UPDATE (the
  same row `pull_secret_card` / `accept_trade_offer` lock — serializes, no new
  deadlock shape), recompute the streak from `pack_opens` in NY days inside the
  function, verify ≥ milestone, `INSERT … ON CONFLICT DO NOTHING`, pay out
  atomically.
- **Payouts in secrets, not editions** (keeps R1 free of the edition-integrity
  prerequisite): day 3 → bonus roster card through the existing
  `grant_card_copy` path with a server-rolled edition; days 7/14/30 → bonus
  secret pull via new RPC `pull_bonus_secret_card` (the weighted selection from
  `pull_secret_card`, inserted `granted = true`, which sidesteps the daily
  unique index by design).
- New: `src/lib/streaks.ts` (pure date-walk + append-only `STREAK_MILESTONES`),
  `src/lib/streaks.functions.ts` (`getStreakStatus`, `claimStreakMilestone`).
  UI: streak flame + "Day 6 — open to keep it alive" on `players.pack.tsx`;
  the claim tap fires the ceremony stack.
- **Claim button, not auto-grant**: ceremony needs a reveal trigger, the claims
  PK makes retries free, and `record_pack_open` stays untouched.

### 1b. Featured weeks (S)

- Zero migration: bulk-set a collection's `secret_cards.weight` ×4 (bounds are
  already CHECKed; follow the `updateSecretCollectionLook` bulk pattern). New
  admin fns `featureSecretCollection` / `endFeature`; member day-status gains
  `featuredActive: boolean` only.
- UI: admin action in `secret-cards-panel.tsx`; an **unnamed** mystery banner on
  `players.pack.tsx` ("Something in the pool is 4× more likely this week") — a
  named banner would leak a collection's existence to non-owners.

### 1c. Trade offer badge + broadcast nudge (M)

- Zero migration, zero published tables — Supabase **broadcast channels**
  sidestep the "published tables are anon-readable" wall documented in
  `use-trades.ts`.
- New `src/lib/nudge.server.ts`: per-participant topic
  `nudge:v1:<hmac16(SESSION_SECRET, "trade-nudge:" + pid)>`. Topic
  unguessability is the guard (no per-user Supabase auth exists, so private
  channels are unavailable); events carry **zero payload**, so the worst leak is
  "someone has trade activity".
- `trades.functions.ts`: after create/accept/decline/cancel, send a payload-free
  broadcast to the counterparty's topic. Verify the server-side REST broadcast
  from the Cloudflare worker in dev before committing; if flaky, ship the badge
  alone.
- New hooks `use-trade-nudge.ts` (subscribe → invalidate `useTradeOffers` keys;
  never merge payloads) and `use-trade-badge.ts` (unread = open incoming offers
  minus a localStorage seen-set). Badge dot on the nav trade item; the existing
  focus-poll stays as the backstop.

## R2 — "Trade & social visibility" (~5–6 dev-days, two small migrations)

### 2a. Wishlists (M)

- New **public** table `wishlist_items (id, participant_id,
event_participant_id, event_id, created_at, UNIQUE (participant_id,
event_participant_id))` — anon SELECT + realtime, writes only via server fns.
  **Roster cards only** (a public secret wishlist would leak the catalogue).
  Cap ~8 items in the server fn.
- New `src/lib/wishlist.functions.ts`. UI: "They want: ×2" chips in the
  `players.trade.tsx` partner picker; "Wanted by N" on `players.$id.tsx`
  (N computed client-side); heart-toggle in `vault-section.tsx`.

### 2b. Flex-a-pull feed (M–L)

- Two tables. Public `flexes (id, participant_id, event_id, day, kind
roster|secret, event_participant_id NULL, secret_name NULL, secret_tier NULL,
created_at)` — **no secret_card_id column and no edition column** (editions
  stay private until R4; secret tier is server-rolled so it may show).
  Server-only `flex_secrets (flex_id PK → flexes, secret_card_id)` holds the
  join.
- New `src/lib/flex.functions.ts`:
  - `flexTodaysSecret` — **takes no card parameter**: the server reads the
    actor's own `secret_card_pulls` row for `pulled_on = leagueDay()`. The
    missing parameter is the security boundary.
  - `flexRosterPull({ eventParticipantId })` — roster ids are public; verify
    today's owned `source='pull'` copy.
  - `getFlexArtUrl({ flexId })` — signed-reference read: resolve `flex_secrets`
    server-side and sign the art path. `flexId` is a reference minted by the
    flexer's own action, never a secret id. `no-store`.
- UI: "Flex this" in the post-reveal moment (`pack-summary.tsx`,
  `secret-card-sheet.tsx`, reusing `share-card-graphic.tsx` visuals); "Today's
  flexes" strip on `players.index.tsx`; new `flex-feed.tsx` + `use-flexes.ts`.

### 2c. New award category (S)

- Append `top_trader` (optionally `best_flex`) to `AWARD_CATEGORIES` in
  `src/lib/awards.ts` — append, never rename. Voting and card-back badges ride
  the existing award pipeline. Zero new plumbing.

## R3 — "Set completion & scarcity" (~5 dev-days, two migrations)

### 3a. Completion trophies (M–L)

- New **public** table `collection_trophies (participant_id, collection_id →
secret_collections, completed_on, size_at_completion int, via
pull|trade|grant, PK (participant_id, collection_id))`.
- New SQL helper `award_collection_trophy(_participant_id, _collection)` —
  "owns every active card in this collection", idempotent insert — called from
  all three acquiring RPCs: `pull_secret_card` (after a non-dupe insert),
  `accept_trade_offer` (per distinct collection received, under the existing
  sorted participant locks), `grant_secret_card`. Detection is atomic with the
  acquiring write; **the set size crosses the wire exactly once, in the
  completion response** — the designed payoff. Un-completed collections still
  never expose a total.
- UI: the completion ceremony is the biggest dopamine moment of the roadmap —
  spend the polish there. Trophy shelf in the vault; badge on
  `secret-back-panel.tsx`; other people's trophies visible from the public
  table.

### 3b. Limited-time drops (M)

- Migration: `secret_cards ADD COLUMN IF NOT EXISTS available_from date /
available_until date`; extend `pull_secret_card`'s candidate WHERE with the
  window against the same NY `_day`. Self-executing scarcity; `weight = 0`
  remains the manual retire lever. Windowed-out cards stay tradeable — rare,
  not gone.
- Admin date pickers in `secret-cards-panel.tsx`; day-status gains
  `limitedActive: boolean`; "Limited drop live" banner on `players.pack.tsx`.
- Recommended: windowed cards **count** toward completion (trading and bonus
  pulls are the catch-up path) — flagged as an open question below.

## R4 — "Dupe economy I: dust" (~8–9 dev-days; the riskiest release)

### 4a. Server-side edition re-derivation (M) — prerequisite

- Implements the future work named in the comments in
  `card-pulls.functions.ts` and `trades.functions.ts`: `record_card_pulls`
  rolls editions server-side (bp ladder mirrored into SQL like
  `roll_secret_tier`: 50/350/800/1800/7000) and returns them; the client
  `editions` param stays accepted-and-ignored so old phones keep working.
- Add `card_copies.edition_asserted_by client|server DEFAULT 'client'`, set
  `'server'` on new pulls. Anything that _pays by_ edition trusts only
  `'server'` rows.
- `players.pack.tsx` reveals editions from the `recordCardPulls` response.
  Failed-record fallback: reveal `standard` with a quiet retry — never a
  locally-rolled rare the server won't honor.

### 4b. Dust ledger + earn + sinks (L)

- New **server-only** `token_ledger (id identity, participant_id, delta int
CHECK <> 0, reason IN ('dupe_secret','mill_copy','buy_secret_pull',
'reroll_edition','milestone','bounty','admin_adjust') — append-only, ref
uuid, detail jsonb, created_at)`. Balance = `sum(delta)` under the
  participant row lock; no denormalized balance to drift.
- Earn: a duplicate secret pull auto-credits **+25** inside `pull_secret_card`
  (the dupe sting becomes the earn moment); new RPC `mill_card_copy` (lock
  participant + copy, verify spare-ness by the `trade_item_is_spare` rule,
  DELETE the copy, credit — flat +5 for `'client'`-asserted copies,
  edition-scaled 5/10/20/40/100 only for `'server'` rows, which kills the
  self-asserted-platinum exploit). Milling never touches `card_pulls`
  ("Packed by N" counts pulls-ever).
- Sinks: `buy_bonus_secret_pull` (**150** ≈ one bonus pull a week for a daily
  player) and `reroll_copy_edition` (**50**; server-roll, set
  `edition_asserted_by='server'` — re-rolls converge the fleet to trusted
  rows). All RPCs SECURITY DEFINER, service_role-only, `accept_trade_offer`
  lock discipline.
- New `src/lib/tokens.ts` (constants; a unit test asserts the TS↔SQL mirror) +
  `src/lib/tokens.functions.ts`. UI: dust chip on vault + trade headers;
  `dust-shop.tsx` sheet; mill affordance on spares; "+25 dust" on the dupe
  moment.

## R5 — "Dupe economy II" (~5–6 dev-days; bounties are the cut-first stretch)

- **5a. Craft-up (M):** RPC `craft_up_copies(_participant_id, _copy_ids[])` —
  lock participant + the 3 copies sorted by id; verify exactly 3, owned, same
  card, none platinum; consume all 3, mint one copy an edition step above the
  best consumed, `source='craft'` (extend the source CHECK add-only),
  `edition_asserted_by='server'`. 3-in/1-out preserves `trade_leaves_a_copy` by
  construction. Forge ceremony in the vault.
- **5b. Edition pity (M, depends on 4a):** server-only `edition_pity
(participant_id PK, standards_in_a_row int, updated_at)` maintained inside
  the server-side roll; at **18** consecutive standards (~6 all-standard packs)
  force bronze+ and reset. Invisible — no client surface. Secret-tier pity
  needs no prerequisite and can ship in any release.
- **5c. Daily bounties (M, stretch):** server-only `bounty_claims
(participant_id, day, bounty_id, PK all three)`; definitions as an
  append-only TS list in `src/lib/bounties.ts`, rotated deterministically by
  league day; claims verified against existing ledgers (`pack_opens`, `trades`,
  `flexes`), small dust credit (+5..10).

## Verification per release

Unit and server-fn tests gate CI; db tests replay every migration from empty;
e2e is advisory.

- **R1:** unit — streak date-walk (gaps, NY boundary), nudge topic derivation,
  badge hook. Server-fn — `claimStreakMilestone` via `callServerFn` +
  `memberHeaders()` (wrong actor rejected, double-claim idempotent). DB — new
  `tests/db/streaks.test.ts` (recompute from seeded `pack_opens`, claim
  idempotence, payout row, guest→member carry); extend `rls.test.ts`. Manually
  verify Cloudflare→Realtime broadcast in dev before committing 1c.
- **R2:** DB — `wishlist_items` posture both directions; assert `flexes` has no
  secret-id column and `flex_secrets` is anon-invisible. Server-fn —
  `flexTodaysSecret`'s validator structurally has no card-id field (pin with a
  schema-rejection test).
- **R3:** DB is the heart — seed a 2-card collection, pull the second → trophy
  - `completed_collection` in the response; same via trade-accept and grant;
    window boundaries in `pull_secret_card`; existing `secret-cards.test.ts`
    stays green untouched.
- **R4:** DB — no negative balance under two concurrent buys; mill rejects
  last-copy; a bought pull bypasses the daily index while the free pull still
  can't double; server editions returned and client-passed ones ignored;
  trade-accept vs spend lock-order test. Unit — TS/SQL price mirror. E2E —
  pack journey green with stubbed edition responses.
- **R5:** DB — craft consumes exactly 3 / platinum cap / mixed-card rejection /
  CHECK migration replays; pity forces bronze+ at threshold.

## Open questions (none block R1)

1. **Trophy size reveal (R3):** public `size_at_completion` makes a completed
   set's size league lore forever. Recommended yes — the reveal is the trophy's
   value.
2. **Do limited-window cards count toward completion (R3)?** Recommended yes;
   otherwise add a `counts_toward_completion` flag.
3. **Guest streaks (R1):** real streaks live on unclaimed guest ids (the known
   stranded-guest-secrets issue); the streak UI is a natural "claim your
   player" nudge surface — lean in?
4. **Edition reveal round-trip (R4):** the reveal depends on the record
   response; sign off on the reveal-standard-and-retry fallback.
