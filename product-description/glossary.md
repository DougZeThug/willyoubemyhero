# Glossary

The vocabulary used across these documents. When a document uses one of these
words, it means exactly this.

## The app and its surfaces

**The app.** Will YOU Be My Hero?, a phone-first party app for one friend group's
annual fantasy draft combine. Two halves that share a roster: the _combine_,
which happens on one day a year, and the _collection_, which is every other day
of it.

**Screen.** One route. The bottom bar reaches six of them directly; the rest are
one tap further, behind the _League hub_ or the account menu.

**The League hub.** The `/league` screen, a page of five tiles — Live, Order,
Draft, Awards, Analytics — and the only way into those screens from inside the
app. A screen dropped from this hub is stranded at a URL nothing links to.

**Presentation mode.** A flag a screen raises while it is playing something
cinematic. The top bar and bottom bar fade to nothing and become inert; they are
not unmounted, because unmounting the header reflows the page under it. See
[motion and sound](cross-cutting/motion-and-sound.md).

## The people

**Guest.** Somebody using the app with no player attached to them. The device
holds a server-minted _guest token_, good for 90 days. A guest can open a pack,
pull the _daily secret_, build a _streak_ and star cards. A guest cannot be
granted a roster card, trade, or vote.

**Member.** Somebody who has _claimed a player_ with a code handed out on paper.
The device holds a _member token_, good for 90 days, which carries the
participant id inside its signed payload. Membership is what unlocks trading,
voting, the marketplace and any card tied to a person on the roster.

**Account holder.** A member or guest who has also signed up with an email and
password. The account survives the device: signing in on a second phone brings
the collection with it. An account is not a fourth level of permission — every
guard still reads the guest or member token — it is durability.

**Commissioner.** The admin. Holds an _admin token_, good for 12 hours, issued
against a PIN for one event or derived from a signed-in account that has been
granted admin. Runs the clock, edits results, manages the roster, creates secret
cards and flips the _dust switch_. These documents say "commissioner" for the
person and "admin screen" for the place.

**Collector.** A signed-in account that is not a combine athlete. A collector is
tradeable and _reachable_ but is never issued a paper code and can never be
claimed — they sign in instead. The roster picker on the claim screen lists them
apart for exactly that reason.

**Member code.** Six characters on a slip of paper, one per player, issued by the
commissioner. The alphabet drops every pair people confuse — no O, I, L, Z, S or
B — because codes are read off paper and typed on a phone. Only a salted hash is
stored, so the plaintext is shown to the commissioner exactly once. A code stays
valid after the first claim on purpose: people get new phones.

**Reachable.** The app's own test for who can be sent a trade offer: somebody who
has claimed a code, or signed into an account. An unreachable player is on the
roster but has no device that could answer, so offering them a trade would be a
message into a void.

**Actor.** Whoever is asking, member or guest, for the paths that accept either —
the daily secret and its status. A member token always wins over a guest token on
the same device, so a person who played as a guest and then claimed a player
never ends up with their history split across two identities.

## The cards

**Roster card.** A trading card of a person on the combine roster. Every roster
card is browsable by everyone; what varies is which _copies_ you hold.

**Secret card.** Admin-curated art that is not a person, pulled and never
derived. Secret cards sit on their own shelf in the vault, never sorted against
the roster. How many exist is the one number the app withholds — no screen and
no server response carries a set size.

**Tier.** What a player did on the course, and therefore how their card looks to
everybody. The six tiers are fixed and persisted, so they may never be renamed:
`champion` (fastest official time, labelled "1 of 1"), `podium` (top three,
"Gold"), `stationKing` (fastest split at any one station), `penaltyBox` (most
penalty time taken), `dnf` (did not finish), and `base` (everyone else). Nothing
about a tier is random, and a card upgrades itself mid-event the moment someone
takes the lead. A commissioner can override one.

**Edition.** The finish on one _copy_ of a roster card, rolled by Postgres when
it is pulled: `platinum` (0.5%), `gold` (3.5%), `silver` (8%), `bronze` (18%),
`standard` (70%). The deliberate opposite of a tier — a tier is earned and is the
same on every phone, an edition is luck and belongs to one person's copy. Two
people can hold the same champion and one of them holds a better print of it. A
standard finish prints no badge at all. Best wins: pulling a worse finish of a
card you already hold is a duplicate, not a downgrade.

**Look.** A secret card's foil and prism edge, chosen by the commissioner rather
than rolled. The _prism edge_ — an opaque rainbow bezel that survives being
looked at in a garden — is the invariant that marks a secret across every foil,
and no earned tier may carry it.

**Level.** How good your _copy_ of a secret card is, rolled by Postgres per copy:
`mythic` (0.5%), `legendary` (3.5%), `epic` (8%), `rare` (18%), `common` (70%).
The third axis, kept in its own vocabulary so a secret can never be mistaken for
a pack finish.

**Set.** A named collection a secret card is filed into. A secret with no set is
_unsorted_ and shows under the heading "Secrets" in the vault.

**Card back.** The reverse of a card: the tier's reason line, the pull odds for a
special finish, the date first pulled, and — on a secret — how many people have
found it. Award badges are **not** on the back; they print under the card on a
player's own page.

## The collection

**Pull.** One card arriving in your collection from a pack, a _milestone_, a
purchase or a trade. The word covers the act and the record of it.

**Copy.** One instance of a card that you hold, with its own edition or level.
Copies are counted; a card you hold three copies of shows a count.

**Spare.** A copy beyond the first of a card you already hold. Spares are what
the marketplace lists, what trading moves without cost, and what _milling_ turns
into dust.

**Collection.** Everything you hold. It lives in two places at once: an IndexedDB
database on the device (`wwbh-cards`), which is what a guest has, and rows in
Postgres for anyone the server can name. Claiming a player or signing in merges
the two.

**Baseline.** The snapshot of your collection taken at the moment a pack was
dealt. The pack's last slot prefers a card the baseline lacks — which is the only
mechanism by which a set ever completes — and it is a snapshot rather than the
live collection so the pack cannot shift under you as you reveal it.

**Shelf.** One section of the vault: Favourites, Complete, a secret set, or the
Roster. Shelves can be reordered and rolled up, per device. A shelf with nothing
in it is absent rather than empty.

**Locked.** A roster card this device has never pulled. It renders face-down, has
no star, and shows no finish — there is no copy of it to describe. The link to
its page survives the lock, because that page is where somebody finds out what
they are missing.

**Trophy.** What a finished set leaves behind: a plaque on its own shelf, a badge,
and a pill on the set. Minted in the same breath as the card that finished it,
and celebrated only once.

**Adopt.** What the device does at an identity transition: uploading the roster
cards it holds locally so they land on the name rather than the handset. Secrets
move server-side during the claim; roster cards are adopted, because they were
never on the server for a guest.

**Starred.** A card you have marked. Starred cards pin to the top of the vault
and carry a mark on every grid they appear in. It is per-device state that costs
nothing and tells nobody.

## The pack

**Pack.** Three roster cards dealt once per _league day_, plus a fourth slot for
the _daily secret_. The three come from a seeded shuffle keyed to the event, the
day and your identity, so refreshing cannot reroll them and two people get
different packs.

**League day.** The day boundary a pack and a streak are counted against. A
pack's day is the device's local date, because nothing is at stake in it; the
daily secret's day comes from Postgres, because something is.

**The stand.** Where one card is shown alone, face-down, and turned over. The
reveal stand owns the screen for the whole of the _revealing_ stage, one card at
a time, and hands over to the columns when you walk off the end of it.

**Tear.** The drag across the sealed wrapper that opens a pack. It commits at
60% of a travel worth 80% of the pack's width; short of that it springs back.

**Ceremony.** Any full-screen moment the app takes the device for: a pack
opening, a milestone's bonus secret, a set closing. Every one of them raises
_presentation mode_. Unqualified, it means the pack's: the sequence from a
committed tear to the final columns,
`sealed` → `opening` (the rip finishing, the cards leaving the pack) →
`revealing` (one card at a time on the stand) → `complete` (the columns). The
grid is the destination, never a stage — showing the final layout while cards are
still face-down spends the payoff before it is earned.

**Daily secret.** The fourth slot: one secret card a day, per actor, decided and
recorded by the server. It never stalls the ceremony — only a secret that is
actually coming holds the stand.

**Milestone.** A rung on the streak ladder that pays a reward. Every milestone
pays a bonus secret, some with a level floor. The rungs are stored, so one may be
added but never renumbered.

**Streak.** The run of consecutive league days you opened a pack on. It is not
stored; it is a walk over the pack records, which is why it survives the guest to
member claim for free. Milestones at 3, 7 and further rungs pay a bonus secret,
some with a level floor. A rung may be added but never renumbered.

## The economy

**Dust.** The currency, switched on and off by the commissioner. While it is off
nothing accrues, every dust call refuses, and the Shop tab does not exist — the
bottom bar reflows from five columns to six when the switch flips.

**Mill.** Turning a spare roster copy into dust, paid by edition: platinum 100,
gold 40, silver 20, bronze 10, standard 5. A copy whose finish the server did not
decide pays a flat 5 however rare it claims to be.

**Sell.** Turning a spare secret copy into dust, paid by level: mythic 300,
legendary 120, epic 60, rare 30, common 15 — the roster ladder times three.

**The shop.** What the house sells: a bonus secret pull for 150 dust, and a
reroll of a copy's finish for 50. A reroll can go down; a best-of would make it a
risk-free ratchet.

**Balance.** How much dust you hold, shown as a chip in the chrome. It is the
server's number; nothing on the device decides it.

**Unsettled finish.** A copy whose edition the server did not decide — pulled
before finishes moved to Postgres, or asserted by a commissioner. It mills at the
flat floor however rare it claims to be, and a _reroll_ repairs it.

**Reroll.** Paying to roll a copy's finish again. It can go down. A best-of would
make it a risk-free ratchet and the whole league would converge on platinum.

**Staked.** A copy committed to a pending offer or an active listing. A staked
copy cannot be milled, sold or rerolled until it comes free.

**The marketplace.** Member-to-member selling for dust. A price between 1 and
9999, at most 20 active listings each — not an economic rule, but the only shape
of denial-of-service a marketplace for thirteen people has.

**Listing.** One card on the marketplace at a price its owner set.

**The stall.** Your own listings, live and settled. The only place a sale of
yours is ever visible.

**Trade.** A member-to-member swap of cards for cards, with no dust involved. An
offer names what the proposer gives and what they want, and waits until the other
side answers.

**Offer status.** Where an offer stands. _Pending_ — waiting for an answer.
_Done_ — accepted, and the cards have moved. _Declined_ — somebody said no.
_Pulled_ — the proposer withdrew it. _Expired_ — nobody answered and the cards
moved out from under it. Declined and expired are different facts and the screen
says which.

**Nudge.** A contentless broadcast that lights a dot. It carries no payload at
all — it says only that something changed, and the screen asks for the detail
itself.

**The feed.** The public record of completed trades. A roster item names its
card, because that card is public. A secret item names its card too, and nothing
else — art, flavour, look and level stay server-only, and an untraded secret
appears nowhere, so the catalogue cannot be enumerated from the feed.

## The combine

**Event.** One year's combine. One is active at a time, and almost every screen
reads the same bundle of it: participants, runs, splits, penalties and stations.

**Feed health.** How the live event feed is doing, in three states.
_Connecting_ — before the socket has answered, and deliberately not treated as a
failure, or a banner would flash on every page load. _Live_ — changes arrive as
they happen. _Degraded_ — the socket is down and the screens are being polled
instead, more often. Five screens show a banner while degraded; the rest do not.

**Toast.** The transient message that slides in at the top of the screen. Used
for the outcome of an action somebody took. Deliberately **not** used for a
failure on a screen somebody is enjoying — the pack's failed secret pull and its
failed share both stay inline instead.

**Participant.** A person on the roster for an event, and their status on the
day. The app writes four: **waiting** (the default, and the word players see on
the running order), **running**, **finished** and **scratched**. The schema
allows a wider vocabulary an archived combine may still carry — `up_next`,
`on_deck`, `delayed`, `absent`, `dq`, `dnp`, `rerun_pending` — and anything in
the out-of-contention family is treated as such wherever tiers are decided.

**Run.** One timed attempt at the course. A run has splits, penalties, and an
official time; only an _official_ run counts for a tier or the board.

**Station.** One obstacle on the course. Stations are named, ordered, and can be
added, renamed and removed by the commissioner.

**Split.** The segment time at one station. Editing one split moves every split
after it, because the clock is cumulative.

**Penalty.** Time added to a run. The participant with the most penalty time
across the event wears the `penaltyBox` tier.

**Official time.** The number a card's claim to a tier rests on. Times are
milliseconds everywhere in this app and are formatted only at the edge.

**On the clock.** Two different things, and the app says it both ways on screen.
On race day it is the participant currently running, and the moment the
commissioner started their clock. On the draft screen it is whoever is choosing
the next pick. These documents always say which.

**Draft pick.** A selection made on the draft screen, in order. The last one can
be undone.

**Superlative.** An award category the league votes on. The six ids are stored
and may never be renamed: MVP, Best Card Art, Biggest Trash Talker, Most Likely
to Puke, Weakest Link, Most Clutch.

## The interaction

**Screen visit.** The unit of interaction these documents describe, in five
phases: **arrive**, **leave without acting**, **the tap that starts something**,
**while it runs**, **it settles**.

**Arrive.** Opening a screen: what is fetched, what is read from the device, what
is focused or prefilled, and what the tokens on the device decide before anything
is drawn.

**Leave without acting.** Backing out of a screen having changed nothing. In most
of this app that records nothing at all, which is a claim worth checking rather
than assuming — a pack that has been dealt, a secret that has been pulled and a
streak day are all recorded before any deliberate action.

**The tap that starts something.** The first action that will write. Everything
before it is free; this is where a visit stops being free.

**While it runs.** The window between the write leaving the device and the screen
settling: what is optimistic, what is disabled, what animates, and what else can
arrive meanwhile.

**It settles.** What is committed, where the user lands, what the failure path
shows, and what is rolled back when it fails.

## Events that end or interrupt a visit

Every document's cancel-and-interrupt table has these rows, in this order.

**Back, or closing a sheet.** The system back gesture, a sheet dismissed by swipe
or by tapping outside, a dialog's close button.

**Navigating away inside the app.** A nav tab, a League tile, a link. The router
does not unload the page, so query caches and any realtime channel survive.

**Reload.** A hard page load. Everything in memory is gone; what survives is
localStorage, IndexedDB, and whatever the server recorded.

**Backgrounded.** The tab hidden, the app sent to the background, or the phone
locking. Timers and animations may not run; realtime may drop and resubscribe.

**Network lost mid-request.** The connection dies after a write left the device
and before an answer came back. The important question in every document is
whether the write landed anyway.

**The request fails or times out.** The server answered, but with an error, or
did not answer in time.

**The token expires or is cleared.** A member or guest token after 90 days, an
admin token after 12 hours, or any of them cleared by signing out. What the user
sees is a screen quietly losing an ability it had a moment ago.

**Changed by someone else.** The same data edited elsewhere and arriving over
realtime — a run finishing, a trade accepted, a card granted.

**A second tab or device.** The same screen open twice on the same identity.

**Reduced motion or presentation mode changes.** The OS preference flipping, or a
ceremony taking the screen mid-interaction.

**Commit.** The point after which an interrupt no longer undoes the thing. In this
app a commit is a row in Postgres, a record in IndexedDB, or both — each document
says which, and in how many steps.
