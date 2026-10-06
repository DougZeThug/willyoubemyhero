# Game principles and established rules

The durable record of how the card game is meant to behave, and why. The
specialist agents in `.claude/agents/` read this before they reason about the
economy, trading, content or UX, and the Lead writes to it when the user
corrects a rule (see **Recording a correction** below).

This file is a **map to the source of truth, not a replacement for it.** Every
number below lives in code and is pinned by a test; when this file and the code
disagree, the code wins and this file is the bug. Read the cited file before
relying on a value, and fix the entry in the same change if it has drifted.

Verified against commit `2846e81`. Re-verify an entry against the latest
migration before relying on it; one entry here was already wrong once because
an older migration was read instead of the one that replaced it.

## Vocabulary

The app has three separate axes on a card. They are different words on purpose
and must never be merged (the headers of `card-edition.ts` and
`secret-rarity.ts` explain the type-confusion bugs that motivated it).

| Axis                       | Applies to                | Values (best → worst)                                                 | Decided by                             | Where                                    |
| -------------------------- | ------------------------- | --------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------- |
| **Tier** (a `RarityTier`)  | Player card               | `champion` · `podium` · `stationKing` · `penaltyBox` · `dnf` · `base` | **Earned** on the course; never random | `src/lib/card-rarity.ts`                 |
| **Edition** (the _finish_) | A _copy_ of a player card | `platinum` · `gold` · `silver` · `bronze` · `standard`                | **Rolled** by Postgres when pulled     | `src/lib/card-edition.ts`, `roll_*` RPCs |
| **Level** (a `SecretTier`) | A _copy_ of a secret card | `mythic` · `legendary` · `epic` · `rare` · `common`                   | **Rolled** by `roll_secret_tier()`     | `src/lib/secret-rarity.ts`               |

A secret never carries an edition and an earned tier never carries the prism
edge. The tier strings are persisted in `event_participants.card_rarity`; renaming
one orphans data (CLAUDE.md). The glossary in
`product-description/glossary.md` is the vocabulary of record for user-facing terms
(_pull, copy, spare, shelf, baseline, mill, sell, dust_).

## Rules verified in the repository

### Pull rates

Editions and secret levels share one ladder, in basis points of 10 000:
**0.5% / 3.5% / 8% / 18% / 70%** (platinum or mythic → standard or common).
The numbers equal the "historical" ladder, so they are current, but they are
pinned in **two** places — `EDITION_WEIGHTS_BP` / `SECRET_TIER_WEIGHTS_BP` in
TypeScript and the walk inside the SQL roll functions — with a test asserting
they agree. Changing a rate means changing both and the test; it is an economy
change and goes to the user.

A player card's _tier_ is not a pull rate at all. Which cards are champion or
podium is a fact about the real combine results.

### Packs and the daily rhythm

- One pack per identity per **league day** (the day rolls over in
  `America/New_York`; the daily RPCs all set that zone and must keep agreeing).
- A pack is **three distinct cards from one pool** of every roster card of the
  active event and every active secret, owned or not, dealt by Postgres
  (`open_pack`, `20260908120000` / `20260908165733`), not the client. Picks are
  weighted sampling without replacement: roster cards weigh 100, the same as the
  default secret weight, and the commissioner's per-secret `weight` tunes secrets
  against each other. A pack may be any mix of roster cards and secrets. There is **no**
  "prefer a card you lack" slot any more, so completing a set is luck plus
  trading. (`product-description/glossary.md` still describes a _baseline_ that
  steered the last slot; that predates the server deal and should be re-checked.)
- Finish and level ladders are untouched by the deal: a roster slot's finish is
  `roll_card_edition`, a secret slot's level is `roll_secret_tier`, and a
  duplicate secret upgrades the copy you own.
- A guest mints no editions until they claim; a roster card cannot be granted to a
  guest (`card_copies.participant_id` is NOT NULL), which is why streaks pay
  secrets.

### Streaks

Consecutive league days with a pack opened, walked over `pack_opens`; nothing
is stored but the claims. Milestones at **3 / 7 / 14 / 30 / 60 days**, each paying
a secret with a level floor (none / rare / epic / legendary / mythic). Cashing
day 60 restarts the run. The day numbers are stored in
`streak_milestone_claims.milestone` — **add a rung, never renumber one.** The
ladder and the walk are duplicated in SQL (`claim_streak_milestone`) on purpose.
Source: `src/lib/streaks.ts`.

### Ownership and copies

- Ownership is **per copy** (`card_copies` for roster cards, `secret_card_pulls`
  for secrets), each with its own finish or level. A _spare_ is a copy beyond the
  first of a card you hold.
- Roster card: you always **keep one**; you choose which copy goes. The public
  "Packed by N" count must not move because of a trade.
- Secret card: **any copy**, including your only one, may be traded or sold.
- **Today's pull is a spare the moment it lands**: it sells, burns, lists and
  trades the same day (`20260930120000_todays_pull_is_a_spare.sql` _removed_ an
  older same-day block). That is safe only because the daily deal is keyed on
  `pack_opens` (`open_pack`, `20260908120000`) and the roster mint cap on the
  append-only `card_mints` (`20260827120000`), so moving a copy can never refund
  a slot. Re-opening the same-day block without those would reintroduce
  pull → sell → pull dust farming.
- The same spare predicate, `trade_item_is_spare`, runs when an offer is composed
  and again under lock when it is accepted. The accept-time check is the one that
  protects the database.

### Trading Post

- Up to **four cards a side**, at least one per side, enforced twice: in the zod
  schema (`sideSchema`) for a readable message and in the RPC, which is what
  actually holds. Mirror: `MAX_PER_SIDE` in `src/lib/trade-staging.ts`.
- Offer lifecycle: `pending → accepted | declined | cancelled | voided`
  (`trade_offers.status`; `reopen_trade_offer` exists).
- The public feed names a secret that changed hands and nothing else about it
  (no art, foil or level). Inside an offer, both parties see the card. A
  counterparty's spares list conceals unowned secrets **server-side**. Do not
  widen this.
- Pending offers are never published to realtime; clients get an empty nudge
  and refetch.
- Source: `src/lib/trades*.ts`, `supabase/migrations/20260817120000_card_trading.sql`.

### Dust (optional economy, commissioner switch)

`events.dust_enabled` gates every dust RPC; when off nothing accrues.
Mill a spare roster copy: platinum 100 / gold 40 / silver 20 / bronze 10 /
standard 5 (a client-asserted finish pays the flat 5). Sell a secret: 300 / 120 /
60 / 30 / 15 (three times the mill ladder, same weights). Shop: bonus secret pull
150 (tuned to "about one a week for a daily player"), re-roll a finish 50 (it can
go _down_ on purpose — a best-of would be a risk-free ratchet). Marketplace:
price 1–9999, at most 20 active listings per member. Source: `src/lib/dust.ts`,
`src/lib/market.ts`, `tests/db/dust.test.ts`, `tests/db/market.test.ts`. There is
no real-money path today; if one is ever proposed, it is a major economy decision
(Skeptic: pay-to-win review is mandatory).

### Trust and integrity

- Every write is `service_role`; `requireAdmin` / `requireMember` is the first
  line of every mutating handler. Never trust a participant id from a payload.
- Anything that moves a card between people or pays a reward is a single Postgres
  transaction (RPC) with row locks; the client only requests it. Guest-merge and
  claim paths are serialised (`serialise_guest_merges`, `lock_both_guests`).
- The client may predict a price or odds for display; the database is
  authoritative and a test pins the two together.

## Principles the game is built on

These are read off the code's own comments. They are the taste the Skeptic
defends.

1. **Earned beats random for identity; random is only for the copy.** The
   champion card is special because they won. Luck lives on a person's copy, never
   on the player.
2. **Scarcity must stay legible.** Only the top of each ladder glows; a shelf of
   base cards must not look as special as a champion. Quiet commons keep the rare
   ones loud.
3. **No risk-free ratchets.** Re-roll can go down; a streak floor only upgrades
   and cannot be farmed by breaking and rebuilding a run.
4. **Don't leak the catalogue.** Set sizes, unowned secret names and art are
   withheld server-side. Completion is discovered, not read off a progress bar.
5. **You always keep one of everything** (roster), and a trade can never lower a
   public count.
6. **Phone, garden, beer.** The app is played one-handed, standing outdoors, in
   ambient light (the prism edge exists because blend-mode foil washes out in
   sunlight). Design for that, not for a desk.
7. **A migration that cannot replay is a broken migration.** `tests/db` applies
   all of them from empty.

## Recording a correction

When the user corrects the Lead about a game rule, card behaviour, visual
principle or workflow, the Lead decides whether it is durable:

- **Durable** if it would be wrong or surprising to a future session that had not
  heard it — a rule ("secrets may be traded from a single copy"), a taste ("never
  put counts on face-down cards"), a workflow ("QA must check historical cards").
- **Not durable** if it is a one-off preference for this task, or if the code
  already states it.

A durable correction goes in the narrowest place that will be read when it
matters:

| Kind                                   | Goes in                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------- |
| Game rule, economy value, card rule    | This file, under **Rules verified** — with its source file                 |
| Player-visible behaviour or vocabulary | `product-description/` (and its `glossary.md`)                             |
| Rule that a test should hold forever   | A test, then a line here citing it                                         |
| How agents should work                 | The relevant `.claude/agents/*.md`, or `.claude/skills/hero-lead/SKILL.md` |
| Build, tooling, safety, repo-wide      | `CLAUDE.md`                                                                |

State what was recorded and where in the reply, so the user can veto it. Never
record a correction that contradicts the code without first telling the user the
code disagrees — either the code or the correction is a bug.

`AGENTS.md` and `.lovable/` are Lovable-managed. Do not record guidance there.
