# Will YOU Be My Hero? product description

A written description of the user experience of Will YOU Be My Hero?: what the
user sees, what they can do, and exactly what happens when they do it.

## Purpose

Will YOU Be My Hero? is, from the user's point of view, a large state chart. The
user moves through it with taps, swipes, drags on a pack, form submissions, and
long waits in which something else changes the screen. Most of that behavior is
defined implicitly, spread across route components, data hooks, server functions,
Postgres RPCs and the tests that pin them. There is no single place that says, in
plain language, "when the user does X, this is what happens, and this is what
happens if they do Y halfway through."

This project is that place. It describes the full experience a user has on the
deployed app, on a phone, in the default configuration, with nothing customized.

The documents are for people who need to understand or change the product:
designers, engineers, writers, testers, and anyone evaluating whether a behavior
is intentional. They are written from the outside in. They describe the
experience, not the implementation.

### What this is not

- Not API documentation. The server functions in `src/lib/*.functions.ts` and the
  Postgres RPCs in `supabase/migrations/` document themselves in their own
  comments; this project never describes their signatures.
- Not organized by package. `src/lib`, `src/hooks` and `src/components` are not
  described separately. A single behavior is described once, wherever the user
  encounters it.
- Not a technical design document. Where a technical detail is critical to
  understanding the experience, it appears in a block quote labeled
  `Technical note:` and nowhere else.

## Conventions

- Describe the experience, not the code. "The Trade tab carries a dot until you
  open it" rather than "useTradeBadge subscribes to the nudge channel".
- Technical detail goes in block quotes, prefixed with `Technical note:`. Use it
  only when the mechanism changes what the user would expect.
- Use sentence case for headings.
- Name the vocabulary consistently. The [glossary](glossary.md) is the source of
  truth for terms like *tier*, *edition*, *level*, *spare*, *pull*, *league day*,
  *member*, *guest* and *commissioner*.
- Every document ends with the commit of this repo it was verified against and a
  list of open questions.
- When a behavior is surprising, say so and say why it is that way if the reason
  is known. Do not smooth it over. This codebase explains most of its own
  surprises in comments; quote the reason rather than inventing one.

## The work to be done

Each document describes one feature. Features are large things (opening a pack)
or small things (starring a card), but each is described in full, including its
edge cases and its interactions with other features.

### Document template

Every feature document follows the same skeleton so that documents are
comparable and nothing is skipped.

1. **Summary.** One paragraph describing the feature abstractly. For example:
   "Starring a card pins it to the top of the vault and marks it on every grid
   it appears in; it is the only per-card state a guest can set that costs
   nothing and tells nobody."
2. **The simple case.** The common path in prose.
3. **The interaction, event by event.** The five phases of a screen visit:
   **arrive**, **leave without acting**, **the tap that starts something**,
   **while it runs**, **it settles**. What loads and what is decided on arrival,
   what happens if the user backs out untouched, what becomes irreversible at the
   first write, what updates live while it is in flight, and what is committed at
   the end. Include a small state diagram (Mermaid `stateDiagram-v2`) of the
   states the user passes through.
4. **Modifiers.** A table of the variant axis, and what each does when set at
   arrival and when it changes during the interaction:

   | Modifier | At arrival | Changed during |
   | --- | --- | --- |
   | Who you are (guest · member · account · commissioner) | | |
   | The event's state (before the combine · running · finished) | | |
   | Dust switched on or off | | |
   | The device (phone · desktop · reduced motion · presentation mode) | | |

5. **Cancel and interrupt.** The same checklist in every document, in this order:
   - Back, or closing a sheet
   - Navigating away inside the app (a nav tab, a link)
   - Reload
   - The tab or app backgrounded, or the phone locking
   - Network lost mid-request
   - The request fails or times out
   - The token expires or is cleared (member and guest 90 days, admin 12 hours)
   - The same data changed by someone else, arriving over realtime
   - The same screen open in a second tab or on a second device
   - Reduced motion or presentation mode changing mid-interaction

   Every cell filled, even when the answer is "no effect". The columns are the
   phases before and after the first write.
6. **Interactions with other systems.** One bold-led paragraph per concern, in
   this order in every document: **Who you have to be.** **Realtime.**
   **Offline and reconnection.** **Optimistic updates and rollback.** **The card
   economy.** **Motion and sound.** **Notifications and badges.** **Sharing.**
   **The second device.** **Accessibility.**
7. **Edge cases.** Anything a user could notice that is not covered above.
8. **Open questions and verification.** The commit the document was written
   against, and any behavior that could not be confirmed.

Item 5 matters most. Asking the same interrupt questions of every feature is how
gaps and inconsistencies are found.

### Method

For each document:

1. Read the route component and the components it renders.
2. Read the data hooks it uses in `src/hooks/`, and the domain module in
   `src/lib/` that owns its rules.
3. Read the matching tests. `src/lib/*.test.ts`, `tests/db/*.test.ts` and
   `e2e/*.spec.ts` are close to executable specifications of the edge cases —
   `pack-ceremony.test.ts`, `card-rarity.test.ts`, `trades.functions.test.ts`,
   `tests/db/dust.test.ts` and `e2e/journeys.spec.ts` especially.
4. Read the server function that a write goes through, and the Postgres RPC
   behind it where there is one. The guard on the first line says who may do it.
5. Record the commit written against.

### Verification

Drafting reads the code; verification watches the product. The `verification/`
directory holds one checklist per area, each item a single observable claim with
setup, steps, expected result, a priority, and the device it needs. A tester runs
them on a phone, records `pass`, `fail`, or `blocked` in the Result column, and
files every failure in [bug-triage.md](bug-triage.md) with the item's ID. A
document moves from `drafted` to `verified` in the coverage table only when every
P1 and P2 item for it has passed or been filed.

`bug-triage.md` is the other half: every behavior the documents flagged as a
likely defect, deduplicated, with reproduction steps, the reason in the code, a
severity, and the decision the league needs to make.

### Order of work

1. **Pilot: [favourites](cards/favourites.md).** Small and self-contained. Used
   to settle the template, tone, and depth.
2. **Foundations.** Identity, the card, the collection, navigation, the event,
   and the clock. Everything else refers to them.
3. **The pack.** The bulk of the experience and the hardest part: four documents
   that hand off to each other. Written third so the template is already proven.
4. **Everything else.** Once the template and the exemplars exist, the remaining
   documents can be drafted in parallel, followed by a consistency pass and a
   verification pass across the whole set.

Progress is tracked in the [coverage table](#coverage) below.

### Scope decisions

- **The surface.** The deployed app on a phone, defaults, nothing customized.
  All four identities are in scope — guest, member, account holder and
  commissioner — because the app is built around the differences between them,
  and describing only one would leave most of the interrupt table blank.
- **The source commit is pinned.** Documents cite `b46f330`, the tip of
  `claude/product-description-skill-a2ti5j` when the reading began. The
  description lives inside the repo it describes, so a footer that moved with
  every commit would say nothing; it is pinned deliberately and updated
  deliberately.
- **`src/components/ui/**` is excluded.** Unmodified shadcn primitives. Where one
  of them shapes an interaction — a sheet that closes on a swipe, a dropdown that
  traps focus — that behavior is described in the document for the feature that
  uses it, not in a document of its own.
- **Generated files are excluded.** `src/routeTree.gen.ts` and
  `src/integrations/supabase/`.
- **The MCP routes are excluded.** `src/routes/mcp.ts`, `[.mcp]/` and
  `[.well-known]/` are a machine surface with no user in front of them.
- **The Lovable editor is excluded.** It is how the app is built, not part of
  what a player experiences.
- **The card economy is described where the user meets it, not once centrally.**
  Dust has its own area because it has its own screens; the way a pull's finish
  becomes dust is described in `dust/milling-and-selling.md` and linked from
  everywhere else.
- **Interaction shape.** The unit of interaction is a screen visit and its phases
  are arrive / leave without acting / the tap that starts something / while it
  runs / it settles. The interrupt list and the order of cross-cutting concerns
  are fixed as written in the document template above.
- **Numbered rules.** These are prose documents, not numbered specifications.
  Stable heading anchors are enough for cross-references.

## Structure

```
README.md                        this file
goal.md                          the standing instructions for whoever drafts
AGENTS.md, CLAUDE.md             entry points for agents: read README.md, then goal.md
glossary.md                      shared vocabulary
bug-triage.md                    suspected defects collected from every document

verification/
  README.md                      how to run a pass and record results
  foundations.md                 FND checklist
  cards.md                       VLT checklist
  trading.md                     TRD checklist
  dust.md                        DST checklist
  combine.md                     CMB checklist
  admin.md                       ADM checklist
  accounts.md                    ACC checklist
  cross-cutting.md               XCT checklist

foundations/
  identity-and-sessions.md       guest, member, account and commissioner; what each unlocks
  the-card.md                    tier, edition, foil and level; player cards and secrets
  the-collection.md              copies, spares, and what owning a card means
  navigation-and-screens.md      the bottom bar, the League hub, and what is in the URL
  the-event.md                   the active event, the combine's phases, the dust switch
  time-and-the-clock.md          milliseconds, splits, penalties, official time, league days

cards/
  favourites.md                  starring a card (pilot)
  the-vault.md                   the collection screen and how it sorts
  a-player-card.md               one roster card, its back, and what it says
  the-stand.md                   arriving at the pack, the sealed wrapper, the tear
  opening-a-pack.md              the reveal, one card at a time
  what-you-pulled.md             the summary columns and what they offer
  the-daily-secret.md            the fourth slot and the once-a-day rule
  secret-sets.md                 collections, unsorted secrets, and how a set reads
  looking-closer.md              zoom, tilt, gyroscope, and turning a card over
  comparing-cards.md             two cards side by side
  collection-trophies.md         completing a set and the ceremony for it
  pack-streaks.md                consecutive days and the milestones they pay

trading/
  the-trading-post.md            the screen, its two sides, and the empty state
  making-an-offer.md             choosing what to give and what to ask for
  answering-an-offer.md          accept, decline, and what happens to the cards
  the-trade-feed.md              what the league sees after a trade

dust/
  dust.md                        the balance, the chip, and what earns it
  milling-and-selling.md         turning a spare into dust
  the-shop.md                    what the house sells
  the-marketplace.md             listing a card for a price, and buying one

combine/
  the-leaderboard.md             the board, its tiers, and sharing a result
  live-timing.md                 race day as a spectator sees it
  the-running-order.md           who goes when, and randomizing it
  the-draft.md                   picking players, and undoing a pick
  the-awards.md                  superlatives, voting, and when it locks
  analytics-and-the-archive.md   stats and past combines
  the-recap.md                   an archived combine at its own URL
  the-tv-board.md                the big-screen view

admin/
  getting-in.md                  the PIN, the 12-hour session, and the account door
  running-the-clock.md           starting, splitting and finishing a run
  editing-a-result.md            fixing a time after the fact
  the-roster.md                  players, statuses, and member codes
  stations.md                    naming, reordering, adding and removing
  secret-card-sets.md            creating secret cards and the sets they file into
  card-artwork.md                uploading, generating and bulk-loading card art
  dust-and-ownership.md          the dust switch, grants, and the ownership audit

accounts/
  signing-in.md                  email, password, and the session that follows
  claiming-your-player.md        the code on paper and the player it unlocks
  keeping-your-cards.md          guest to member to account, without losing a pull

cross-cutting/
  realtime-and-staleness.md      what arrives without a refresh, and what does not
  offline.md                     what still works on a dead connection
  motion-and-sound.md            reduced motion, presentation mode, and the chimes
  notifications-and-badges.md    the dots on the nav and the toasts
  sharing.md                     exporting a card as an image, and link previews
  accessibility.md               what a screen reader gets, and what a thumb needs
```

## Coverage

Status is one of `not started`, `drafted`, or `verified`.

| Document | Status |
| --- | --- |
| glossary.md | drafted |
| bug-triage.md | not started |
| verification/ (8 checklists) | not started |
| foundations/identity-and-sessions.md | drafted |
| foundations/the-card.md | drafted |
| foundations/the-collection.md | drafted |
| foundations/navigation-and-screens.md | drafted |
| foundations/the-event.md | drafted |
| foundations/time-and-the-clock.md | drafted |
| cards/favourites.md | drafted |
| cards/the-vault.md | not started |
| cards/a-player-card.md | not started |
| cards/the-stand.md | not started |
| cards/opening-a-pack.md | not started |
| cards/what-you-pulled.md | not started |
| cards/the-daily-secret.md | not started |
| cards/secret-sets.md | not started |
| cards/looking-closer.md | not started |
| cards/comparing-cards.md | not started |
| cards/collection-trophies.md | not started |
| cards/pack-streaks.md | not started |
| trading/the-trading-post.md | not started |
| trading/making-an-offer.md | not started |
| trading/answering-an-offer.md | not started |
| trading/the-trade-feed.md | not started |
| dust/dust.md | not started |
| dust/milling-and-selling.md | not started |
| dust/the-shop.md | not started |
| dust/the-marketplace.md | not started |
| combine/the-leaderboard.md | not started |
| combine/live-timing.md | not started |
| combine/the-running-order.md | not started |
| combine/the-draft.md | not started |
| combine/the-awards.md | not started |
| combine/analytics-and-the-archive.md | not started |
| combine/the-recap.md | not started |
| combine/the-tv-board.md | not started |
| admin/getting-in.md | not started |
| admin/running-the-clock.md | not started |
| admin/editing-a-result.md | not started |
| admin/the-roster.md | not started |
| admin/stations.md | not started |
| admin/secret-card-sets.md | not started |
| admin/card-artwork.md | not started |
| admin/dust-and-ownership.md | not started |
| accounts/signing-in.md | not started |
| accounts/claiming-your-player.md | not started |
| accounts/keeping-your-cards.md | not started |
| cross-cutting/realtime-and-staleness.md | not started |
| cross-cutting/offline.md | not started |
| cross-cutting/motion-and-sound.md | not started |
| cross-cutting/notifications-and-badges.md | not started |
| cross-cutting/sharing.md | not started |
| cross-cutting/accessibility.md | not started |

## Reference

The source of truth is this repository at commit `b46f330`. The relevant
locations are:

- `src/routes/`: the surface. One file per screen; `src/routes/README.md` gives
  the routing conventions.
- `src/lib/*.functions.ts`: every write the app can make. The first line of a
  mutating handler is the guard that says who may make it.
- `src/lib/*.server.ts`: server-only modules — tokens, nudge topics, the
  database helpers behind the RPCs.
- `src/lib/`: the domain rules. `card-rarity.ts` (tiers), `card-edition.ts`
  (finishes), `secret-rarity.ts` (levels), `secret-cards.ts` (secrets and sets),
  `dust.ts` (prices), `pack.ts` and `pack-ceremony.ts` (the ceremony),
  `streaks.ts`, `trades.ts`, `market.ts`, `awards.ts`, `nav.ts`, `league.ts`.
- `src/hooks/`: what a screen knows and when it learns it. TanStack Query over
  Supabase, with realtime subscriptions where a screen must not go stale.
- `src/components/`: the UI.
- `src/lib/*.test.ts`, `tests/db/*.test.ts`, `e2e/*.spec.ts`: behavioral tests,
  and the closest thing to an existing specification of the edge cases.
- `supabase/migrations/`: the schema, the RLS policies, and the RPCs that decide
  anything the client must not decide for itself.
