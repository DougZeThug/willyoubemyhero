# Bug triage

A consolidated list of the defects and inconsistencies the feature documents
raised, in their bodies and in their "Open questions and verification" sections.
Each entry is read from this repository at commit `b46f330` and from its tests.
The list exists so the league can decide, item by item, whether to fix, to
document as intended, or to leave.

Nothing here has been confirmed against the running app on a phone. A handful
were confirmed by the scripted pass described in
[verification/README.md](verification/README.md); those carry a **Status** line.

## Summary

Around sixty suspected defects were raised across the fifty-one documents. After
merging by root cause they come to **43 entries**: 7 high, 32 medium, and 4 low
(three of which are clusters of small slips).

Two clusters account for most of the high entries. The first is **writes that
report a success they did not have** — the running order, the draft's undo, the
timing console's start, and the member-code rotation all return `ok` on a path
that failed, and in one case that loses paper codes irrecoverably. The second is
**identity transitions that go quiet** — claiming a player while signed in to an
account that already holds one, and the account screen becoming unreachable the
moment its own link settles.

The largest medium cluster is **six screens disagreeing about the same number**:
a run marked official with no time sorts to the top on three of them and to the
bottom on the other three.

A second medium cluster is **guards narrower than the writes they protect**: six
admin handlers check the caller against one event and then write a row belonging
to any, and a station delete's "this has recorded times" check lives in the
screen rather than in the handler that cascades.

| ID   | Title                                                                       | Severity | Area          | Decision needed |
| ---- | --------------------------------------------------------------------------- | -------- | ------------- | --------------- |
| B-01 | A partial code rotation destroys paper codes irrecoverably                  | high     | admin         | fix             |
| B-02 | Issued codes are shown once and held only in page state                     | high     | admin         | fix             |
| B-03 | Claiming a second player on one account fails silently and says "Welcome"   | high     | accounts      | fix             |
| B-04 | The account screen is unreachable the moment its link settles               | high     | accounts      | fix             |
| B-05 | An official run with no time sorts to the top on three screens              | high     | combine       | fix             |
| B-06 | Reordering the running order reports a success it did not have              | high     | admin         | fix             |
| B-07 | A guest who claims mid-day is re-dealt today's pack                         | high     | accounts      | product call    |
| B-08 | A shared head-to-head link does not open the comparison                     | medium   | cards         | fix             |
| B-09 | Analytics has no loading, error or degraded state                           | medium   | combine       | fix             |
| B-10 | The trade screen's set-complete ceremony leaves the nav reachable           | medium   | trading       | fix             |
| B-11 | Milling a spare leaves it offerable on the Trading Post                     | medium   | dust          | fix             |
| B-12 | Award winners arrive up to a minute before the lock does                    | medium   | combine       | fix             |
| B-13 | A guest who finishes a set never sees its ceremony                          | medium   | cards         | fix             |
| B-14 | The claim screen's copy contradicts what claiming does                      | medium   | accounts      | product call    |
| B-15 | "Sign out on this device" undoes itself on the next reload                  | medium   | accounts      | fix             |
| B-16 | Adding a player is two unlinked writes                                      | medium   | admin         | fix             |
| B-17 | The draft's undo reports a success it did not have                          | medium   | combine       | fix             |
| B-18 | The crowd's clock is formatted unlike every other time in the app           | medium   | combine       | fix             |
| B-19 | The live screen loses a finish, and can call the field done early           | medium   | combine       | fix             |
| B-20 | Turning a full-size card over is silent                                     | medium   | cards         | fix             |
| B-21 | Tilt reports success on hardware with no gyroscope                          | medium   | cards         | fix             |
| B-22 | The timing console's Start can fail without saying so                       | medium   | admin         | fix             |
| B-23 | Two commissioners editing one result overwrite each other silently          | medium   | admin         | product call    |
| B-24 | The marketplace renders a blank space where a seller's stall belongs        | medium   | dust          | fix             |
| B-25 | The secret sheet swipes through shelves that are rolled up                  | medium   | cards         | fix             |
| B-26 | The signed-out trading gate pushes a code-holder to create an account       | medium   | trading       | fix             |
| B-27 | The draft and running-order locks cannot be set from anywhere               | medium   | combine       | product call    |
| B-28 | A failed splits read makes the awards panel claim the votes were unreadable | medium   | combine       | fix             |
| B-29 | Three ways a shared card image can come out wrong                           | medium   | cross-cutting | fix             |
| B-34 | Eight screens subscribe to the live feed and never say when it is down      | medium   | cross-cutting | fix             |
| B-35 | Every link preview is a large-image card with no image                      | medium   | cross-cutting | fix             |
| B-36 | Six admin writes authorize against one event and write to any               | medium   | admin         | fix             |
| B-37 | Deleting a station takes finished runs' splits with it                      | medium   | admin         | fix             |
| B-38 | The tier override is honoured everywhere and reachable from nowhere         | medium   | cards         | product call    |
| B-39 | Grants are not idempotent and cannot be undone                              | medium   | admin         | fix             |
| B-40 | Rescuing a device's cards is three writes with no transaction               | medium   | admin         | fix             |
| B-41 | "Record a split here" saves, reads back, and does nothing                   | medium   | admin         | fix             |
| B-42 | A retired secret card cannot be brought back                                | medium   | admin         | fix             |
| B-30 | Accessibility gaps across the app                                           | low      | cross-cutting | fix             |
| B-31 | Small rendering and copy slips                                              | low      | —             | fix             |
| B-32 | The compare picker dresses an unpacked card in its real tier                | low      | cards         | product call    |
| B-33 | Out of season, trading closes silently — including for secrets              | low      | trading       | product call    |

## High

### B-01: A partial code rotation destroys paper codes irrecoverably

- **Where the user meets it:** The commissioner issues member codes for the
  league, on the admin console, before handing out slips of paper.
- **What happens / what was expected:** Codes are rotated one player at a time.
  The first write that fails aborts the whole run, and the screen says "Could not
  generate codes" and shows nothing. The players already rotated now have new
  codes that **nobody has ever seen** — their old paper slips are dead and the
  new plaintext was discarded with the failed request. Expected: either every
  code is issued and shown, or none is.
- **Reproduce:** Issue codes for the roster with any single write failing
  part-way — a dropped connection during the loop is enough.
- **Why (from the code):** `generateMemberCodes` in
  `src/lib/member.functions.ts` loops the targets and does
  `if (error) throw error;` inside the loop, after previous upserts have already
  committed. The plaintext lives only in the local `issued` array, which is lost
  when the handler throws. Only the salted hash is stored, by design.
- **Severity:** `high`. Silently destroys credentials with no recovery path
  short of rotating again.
- **Decision needed:** `fix`. Collect every code first and write them in one
  transaction, or return the partial list with the failure so the commissioner
  at least holds what was issued.
- **Raised by:** [the roster](admin/the-roster.md#open-questions-and-verification).

### B-02: Issued codes are shown once and held only in page state

- **Where the user meets it:** The commissioner has just issued codes and is
  about to write them onto slips of paper.
- **What happens / what was expected:** The list exists only in the page. A
  reload, a navigation, or a tab discarded by the phone loses it — while the
  codes are already live. There is no "show again" and no warning before
  leaving. Expected: at minimum a warning, and ideally a way to print or copy in
  one action.
- **Reproduce:** Issue codes, then reload the admin screen.
- **Why (from the code):** `src/components/member-admin-panel.tsx` holds the
  issued list in component state and nothing persists it. Only the hash is
  stored server-side, deliberately, so it genuinely cannot be shown again.
- **Severity:** `high`. Same loss as B-01, reached by an ordinary accident
  rather than a failure.
- **Decision needed:** `fix`. A copy-all and a print view, plus an
  unsaved-changes style warning on leave.
- **Raised by:** [the roster](admin/the-roster.md#open-questions-and-verification).

### B-03: Claiming a second player on one account fails silently and says "Welcome"

- **Where the user meets it:** Somebody signed in to an account, who already has
  a player, types another player's code on the claim screen.
- **What happens / what was expected:** The claim succeeds on the device and the
  screen says "Welcome, {name}". The account is **not** re-linked — the refusal
  is deliberate — so the next phone that signs in gets the _old_ player back,
  with nothing anywhere having said the link was refused. Expected: the screen
  says the account is already linked to somebody else, and what to do about it.
- **Reproduce:** Sign in, claim player A, then claim player B's code on the same
  device.
- **Why (from the code):** `bindParticipant` in `src/lib/account.server.ts`
  throws `"This account is already linked to another player"` on purpose, with a
  comment explaining that re-binding would drag every other device onto the new
  player. `src/routes/claim.tsx` wraps the call in a bare `try {} catch {}` whose
  comment covers a _transient_ failure — "the claim stands; signing in again
  re-runs the adoption" — and swallows the permanent refusal identically.
- **Severity:** `high`. Silently does something different from what the screen
  confirmed.
- **Decision needed:** `fix`. Distinguish the deliberate refusal from a
  transient failure and surface the first.
- **Raised by:** [claiming your player](accounts/claiming-your-player.md#open-questions-and-verification),
  [keeping your cards](accounts/keeping-your-cards.md#open-questions-and-verification).

### B-04: The account screen is unreachable the moment its link settles

- **Where the user meets it:** A signed-in player taps "Account" in the header
  menu.
- **What happens / what was expected:** They land on the vault. The account
  panel — the email address, "I have a player code", and the page's own sign-out
  — is visible only while the account link is still in flight or has failed.
  Expected: the menu item goes to the account screen.
- **Reproduce:** Sign in, wait for the app to settle, tap Account.
- **Why (from the code):** The effect at the top of `AuthPage` in
  `src/routes/auth.tsx` navigates away whenever
  `user && sync.status === "ready" && sync.userId === user.id`, which is the
  normal steady state for a signed-in user.
- **Severity:** `high`. A whole screen, and the only in-app route to the claim
  flow for a signed-in player, is unreachable in the common case.
- **Decision needed:** `fix`. Redirect only when the visit was a sign-in
  round trip, not on every visit.
- **Raised by:** [signing in](accounts/signing-in.md#open-questions-and-verification).

### B-05: An official run with no time sorts to the top on three screens

- **Where the user meets it:** Any spectator screen during or after a combine,
  where a run has been marked official before its time was entered.
- **What happens / what was expected:** The runner with no time is shown in
  first place, printing an em dash where the time belongs. On the leaderboard,
  the draft and analytics the same run sorts last. Expected: one answer
  everywhere, and it should be last.
- **Reproduce:** Mark a run official with a null time; open `/live`, `/tv` and
  `/recap/{slug}`, then `/leaderboard`.
- **Why (from the code):** `src/routes/live.tsx:67`, `src/routes/tv.tsx:34` and
  `src/routes/recap.$slug.tsx:63` sort with `(a.official_time_ms ?? 0)`, which
  puts null first. `src/routes/leaderboard.tsx:47`, `src/routes/draft.tsx:60` and
  `src/routes/analytics.tsx:62` use `?? Infinity`, which puts it last. Analytics
  additionally feeds `Infinity` to `formatTime` when _every_ run is null, which
  prints `NaN.NaN`.
- **Severity:** `high`. The big screen in front of the party shows the wrong
  winner, and this is exactly the state a live combine passes through.
- **Decision needed:** `fix`. One comparator, `?? Infinity`, and a guard in
  `formatTime` for a non-finite input.
- **Status:** Confirmed by reading all six call sites; not yet watched on a
  running combine.
- **Raised by:** [live timing](combine/live-timing.md#open-questions-and-verification),
  [the TV board](combine/the-tv-board.md#open-questions-and-verification),
  [the recap](combine/the-recap.md#open-questions-and-verification),
  [analytics and the archive](combine/analytics-and-the-archive.md#open-questions-and-verification).

### B-06: Reordering the running order reports a success it did not have

- **Where the user meets it:** The commissioner sets or randomises the running
  order.
- **What happens / what was expected:** The screen says it worked whatever
  happened. A partial failure leaves two athletes sharing a running-order number
  and nothing says so. Expected: a failed write is reported.
- **Reproduce:** Reorder with any single row update failing.
- **Why (from the code):** `setRunningOrder` in
  `src/lib/admin-write.functions.ts:243-256` fires every update inside
  `Promise.all`, checks none of the results, and returns `{ ok: true }`
  unconditionally.
- **Severity:** `high`. Silently produces a corrupt order on the one screen that
  decides who runs next.
- **Decision needed:** `fix`. Check every result, or do it in one statement.
- **Raised by:** [the running order](combine/the-running-order.md#open-questions-and-verification).

### B-07: A guest who claims mid-day is re-dealt today's pack

- **Where the user meets it:** The commonest first-timer path — somebody plays
  as a guest, tears today's pack, is asked to claim a player, does, and comes
  back.
- **What happens / what was expected:** Their pack is keyed to who they are, and
  claiming changes that, so the stored pack stops matching and the wrapper seals
  again. They get a second pack for the same day. The streak still counts the day
  once. Expected, probably: the pack they already tore.
- **Reproduce:** As a guest, tear a pack, claim a player, return to the pack
  screen.
- **Why (from the code):** `usePackIdentity` in `src/lib/device-id.ts` returns
  `d:<deviceId>` for a guest and `m:<participantId>` for a member, and the stored
  pack records which one it was dealt to. The mismatch is detected on purpose —
  it is how a phone changing hands is caught — and a claim looks identical to it.
- **Severity:** `high`. Two packs a day on the path most new players take.
- **Decision needed:** `product call`. Carrying the guest's pack across is the
  generous reading; leaving it is defensible if a second pack on claim day is
  considered a welcome gift. Either way it should be deliberate, and it is
  currently a side effect.
- **Raised by:** [keeping your cards](accounts/keeping-your-cards.md#open-questions-and-verification),
  [the sealed pack](cards/the-sealed-pack.md#open-questions-and-verification).

## Medium

### B-08: A shared head-to-head link does not open the comparison

- **Where the user meets it:** Somebody drops a `?vs=` link in the group chat —
  which the route's own comment says is the whole reason the parameter exists.
- **What happens / what was expected:** The recipient lands on the left player's
  card with the Compare chip lit and has to tap it. Expected: the comparison is
  open.
- **Why (from the code):** `src/routes/players.$id.tsx:130` initialises
  `comparing` to `false` and nothing derives it from the search parameter;
  line 651 lights the chip from `!!vs`, and line 764 opens the sheet from
  `comparing`.
- **Severity:** `medium`. The feature works, one tap later than intended.
- **Decision needed:** `fix`. Seed `comparing` from the parameter.
- **Raised by:** [comparing cards](cards/comparing-cards.md#open-questions-and-verification).

### B-09: Analytics has no loading, error or degraded state

- **Where the user meets it:** Opening Analytics on a slow connection, or while
  a read is failing.
- **What happens / what was expected:** A pending fetch, a failed read and a
  genuinely empty combine all render the same "No split data yet." Expected: the
  three are told apart, as they are on every other combine screen.
- **Why (from the code):** `src/routes/analytics.tsx:28` destructures only
  `bundle` from `useEventBundle()`, discarding `loading`, `error`,
  `failedTables` and `realtimeDegraded`. `src/components/feed-state.tsx` exists
  precisely for this and is not used here.
- **Severity:** `medium`. The same failure the live screen was fixed for.
- **Decision needed:** `fix`.
- **Raised by:** [analytics and the archive](combine/analytics-and-the-archive.md#open-questions-and-verification).

### B-10: The trade screen's set-complete ceremony leaves the nav reachable

- **Where the user meets it:** A trade completes a secret set, and the ceremony
  plays on the trading post.
- **What happens / what was expected:** The ceremony covers the screen but the
  nav bars stay live — focusable, and reachable at the edges. Every other
  ceremony in the app fades and disables them.
- **Why (from the code):** `src/routes/players.trade.tsx` mounts
  `CollectionComplete` without `PresentationMode`; `players.pack.tsx` and
  `trophy-ceremony-host.tsx` both pair them.
- **Severity:** `medium`. Inconsistent, and the chrome is tappable under a
  full-screen moment.
- **Decision needed:** `fix`.
- **Raised by:** [answering an offer](trading/answering-an-offer.md#open-questions-and-verification).

### B-11: Milling a spare leaves it offerable on the Trading Post

- **Where the user meets it:** Mill a spare in the shop, then go straight to
  Trade and try to offer it.
- **What happens / what was expected:** For up to thirty seconds the copy is
  still listed as offerable, and composing the offer is then refused by the
  server. Expected: it disappears when it is spent.
- **Why (from the code):** `src/components/dust-shop.tsx` invalidates its own
  spares key and the card stats key, but not the key `useTradeSpares` registers
  under in `src/hooks/use-trades.ts`. `src/components/market-panel.tsx:178` does
  invalidate it after a buy, so the two panels on the same screen disagree.
- **Severity:** `medium`. Bounded by a cache lifetime, and the server refuses
  correctly.
- **Decision needed:** `fix`.
- **Raised by:** [milling and selling](dust/milling-and-selling.md#open-questions-and-verification),
  [making an offer](trading/making-an-offer.md#open-questions-and-verification).

### B-12: Award winners arrive up to a minute before the lock does

- **Where the user meets it:** The commissioner publishes the superlatives while
  people still have the awards screen open.
- **What happens / what was expected:** Winners arrive at once over the live
  feed, but the fact that voting has closed rides on a value cached for a
  minute — so for up to a minute a member sees a live ballot for a vote that is
  already over, and the tap is refused. Expected: the ballot closes with the
  winners.
- **Why (from the code):** Winners come from a realtime subscription on the
  awards table; `awards_locked` comes from `useActiveEvent`, which has a 60s
  stale time, no subscription, and the event channel does not watch the events
  table.
- **Severity:** `medium`. Recoverable, but the refusal reads as a bug to the
  voter.
- **Decision needed:** `fix`.
- **Raised by:** [the awards](combine/the-awards.md#open-questions-and-verification).

### B-13: A guest who finishes a set never sees its ceremony

- **Where the user meets it:** A guest completes a secret set, then claims a
  player.
- **What happens / what was expected:** The trophy is banked at the moment of the
  claim — which is also the first moment the device has an identity to prime
  against — so the priming pass that exists to avoid celebrating history
  swallows it. The set is complete and nothing marks it. Expected: the ceremony
  plays once.
- **Why (from the code):** `claim_guest_secrets` banks the trophy;
  `useCollectionTrophyWatcher`'s priming pass absorbs whatever is already on the
  shelf on its first run.
- **Severity:** `medium`. Loses the payoff for the one path where it is most
  earned.
- **Decision needed:** `fix`.
- **Raised by:** [collection trophies](cards/collection-trophies.md#open-questions-and-verification).

### B-14: The claim screen's copy contradicts what claiming does

- **Where the user meets it:** Reading the claim screen before typing a code.
- **What happens / what was expected:** It says "One time only — it sticks on
  this device". Codes stay valid after the first claim on purpose, because people
  get new phones, and every re-claim is counted. One of the two is wrong.
- **Why (from the code):** The copy in `src/routes/claim.tsx` against the
  comment on `claimPlayer` in `src/lib/member.functions.ts`.
- **Severity:** `medium`. Discourages somebody from doing the thing the feature
  was built to allow.
- **Decision needed:** `product call`. Change the copy, or make the behavior
  match it.
- **Raised by:** [claiming your player](accounts/claiming-your-player.md#open-questions-and-verification).

### B-15: "Sign out on this device" undoes itself on the next reload

- **Where the user meets it:** A signed-in player uses the sign-out on the claim
  screen.
- **What happens / what was expected:** Only the member token is dropped. The
  account session is untouched, so the next reload re-mints the token and the
  sign-out silently reverses. In the meantime the vault shows the "your secrets
  are on your name, not on this phone" breadcrumb, which is misleading for
  somebody still signed in.
- **Why (from the code):** `src/routes/claim.tsx` calls `clearMemberToken()`
  alone; `useAccountSync` is latched per user id and re-establishes it.
- **Severity:** `medium`.
- **Decision needed:** `fix`. Either sign out of the account too, or rename the
  control to say what it does.
- **Raised by:** [signing in](accounts/signing-in.md#open-questions-and-verification).

### B-16: Adding a player is two unlinked writes

- **Where the user meets it:** The commissioner adds somebody to the roster.
- **What happens / what was expected:** A failure between the two writes leaves a
  person created but not on the roster. Retyping the name creates a _second_
  person, because the form never matches an existing one.
- **Why (from the code):** `src/routes/admin.tsx` calls `upsertParticipant` and
  then `addParticipantToEvent` as separate operations.
- **Severity:** `medium`. Produces duplicate people in a league of thirteen.
- **Decision needed:** `fix`.
- **Raised by:** [the roster](admin/the-roster.md#open-questions-and-verification).

### B-17: The draft's undo reports a success it did not have

- **Where the user meets it:** The commissioner taps undo on an empty draft, or
  two picks land at once.
- **What happens / what was expected:** Undo on an empty draft returns ok and the
  screen says "Undid last pick". A pick whose roster stamp fails leaves a square
  reading Open that the unique constraint then refuses forever. `selection_order`
  is computed as count + 1 with no unique constraint, so two near-simultaneous
  picks can share a number and undo takes an arbitrary one.
- **Why (from the code):** `undoLastDraftSelection` and `recordDraftSelection` in
  `src/lib/admin-write.functions.ts`.
- **Severity:** `medium`. Same family as B-06.
- **Decision needed:** `fix`.
- **Raised by:** [the draft](combine/the-draft.md#open-questions-and-verification).

### B-18: The crowd's clock is formatted unlike every other time in the app

- **Where the user meets it:** Watching the live screen or the TV board.
- **What happens / what was expected:** Under a minute the HUD timer renders
  `41:32s`; at a minute it switches to `1:41.32`. Everywhere else that duration is
  `41.32`. Somebody arriving from the leaderboard reads forty-one minutes.
- **Why (from the code):** `src/components/hud-timer.tsx` formats
  independently of `formatTime` in `src/lib/format.ts`.
- **Severity:** `medium`. Actively misreads on the screen most people are
  watching.
- **Decision needed:** `fix`.
- **Raised by:** [live timing](combine/live-timing.md#open-questions-and-verification).

### B-19: The live screen loses a finish, and can call the field done early

- **Where the user meets it:** Race day, when two people finish close together,
  or after a re-timed run.
- **What happens / what was expected:** The screen holds one celebration slot, so
  two finishes in the same refetch overwrite each other and one is never shown.
  Separately, the "x of y done" tally counts official runs against non-scratched
  roster entries, so a re-timed athlete counts twice and enough of that tips the
  screen into "everyone is done" early. And an athlete marked disqualified, did
  not play or absent is treated as neither done nor finished, so they occupy the
  "Up Next" slot indefinitely.
- **Why (from the code):** `src/routes/live.tsx` and
  `currentAthlete`/`fieldSize` in `src/lib/current-athlete.ts`, whose `DONE` set
  holds only `finished` and `scratched`.
- **Severity:** `medium`. Three symptoms, one screen, all on race day.
- **Decision needed:** `fix`. Queue celebrations; count distinct athletes; widen
  the done set to the out-of-contention family.
- **Raised by:** [live timing](combine/live-timing.md#open-questions-and-verification).

### B-20: Turning a full-size card over is silent

- **Where the user meets it:** Turning a card over on a player's page or in the
  secret sheet — the two screens built for handling a card.
- **What happens / what was expected:** No card-stock sound. The sound exists and
  plays on smaller surfaces.
- **Why (from the code):** `playFlip()` fires only from `HoloCard`'s own toggle.
  On both full-size surfaces the zoom frame swallows the click and the callers
  set the flipped state directly — `src/routes/players.$id.tsx` and
  `src/components/secret-card-sheet.tsx`.
- **Severity:** `medium`. A deliberate piece of feel, unreachable where it matters
  most.
- **Decision needed:** `fix`.
- **Raised by:** [looking closer](cards/looking-closer.md#open-questions-and-verification).

### B-21: Tilt reports success on hardware with no gyroscope

- **Where the user meets it:** Turning on Tilt in a desktop browser.
- **What happens / what was expected:** The chip lights and nothing moves, with
  no message. Expected: it says the device cannot do this.
- **Why (from the code):** `requestGyroPermission` in `src/lib/gyro.ts` returns
  true whenever the orientation event type exists but exposes no permission
  request — true of desktop Chrome and Firefox.
- **Severity:** `medium`.
- **Decision needed:** `fix`.
- **Raised by:** [looking closer](cards/looking-closer.md#open-questions-and-verification).

### B-22: The timing console's Start can fail without saying so

- **Where the user meets it:** Starting a run on race day.
- **What happens / what was expected:** The status write is swallowed on failure,
  so the crowd's clock can stay stopped for a run that is genuinely under way
  with nothing on the console saying so.
- **Why (from the code):** `startRun` in `src/hooks/use-run-console.ts`.
- **Severity:** `medium`. The local run is unaffected, which is what matters
  most, but every spectator screen is wrong.
- **Decision needed:** `fix`.
- **Raised by:** [running the clock](admin/running-the-clock.md#open-questions-and-verification).

### B-23: Two commissioners editing one result overwrite each other silently

- **Where the user meets it:** Two people fixing the same time.
- **What happens / what was expected:** The edit sheet never re-seeds while open,
  so the second save wins and neither side is told.
- **Why (from the code):** `src/components/edit-result-sheet.tsx` seeds on open
  only. Not re-seeding on every keystroke is deliberate and correct; not noticing
  a change at save time is the part that is probably not.
- **Severity:** `medium`.
- **Decision needed:** `product call`. A conflict warning at save, or accept
  last-write-wins in a league of thirteen.
- **Raised by:** [editing a result](admin/editing-a-result.md#open-questions-and-verification).

### B-24: The marketplace renders a blank space where a seller's stall belongs

- **Where the user meets it:** A seller opens the shop just after dust is
  switched off, with listings still up.
- **What happens / what was expected:** The panel renders nothing while the stall
  is still loading, then pops in. That path exists so a seller can always cancel
  a listing, so a blank frame there reads as "my cards are gone".
- **Why (from the code):** `src/components/market-panel.tsx` returns null on
  "dust off and no active listings" without considering the loading state.
- **Severity:** `medium`.
- **Decision needed:** `fix`.
- **Raised by:** [the marketplace](dust/the-marketplace.md#open-questions-and-verification).

### B-25: The secret sheet swipes through shelves that are rolled up

- **Where the user meets it:** Swiping through secrets in the vault with some
  shelves collapsed.
- **What happens / what was expected:** Swiping past the end of an open shelf
  lands on a card from a closed one. The sheet's own comment says it "swipes what
  is on screen, in the order it is on screen".
- **Why (from the code):** the visible-secrets list in
  `src/routes/players.index.tsx` walks the shelf order rather than the open
  shelves.
- **Severity:** `medium`.
- **Decision needed:** `fix`.
- **Raised by:** [the vault](cards/the-vault.md#open-questions-and-verification),
  [secret sets](cards/secret-sets.md#open-questions-and-verification).

### B-26: The signed-out trading gate pushes a code-holder to create an account

- **Where the user meets it:** Somebody holding a paper code opens the Trading
  Post before claiming.
- **What happens / what was expected:** They briefly see "Claim your player to
  trade cards", then are redirected to sign-up — and the signed-out sign-in
  screen has no link to the claim screen at all. Expected: they are sent to
  claim.
- **Why (from the code):** the signed-out branch of `src/routes/players.trade.tsx`
  redirects to `/auth?mode=signup`; the only claim link in `src/routes/auth.tsx`
  is inside the signed-in branch. The existing e2e test asserts on the transient
  panel, so it passes without exercising the redirect.
- **Severity:** `medium`. Sends a new player down the wrong path, and the test
  that should catch it does not.
- **Decision needed:** `fix`.
- **Raised by:** [the trading post](trading/the-trading-post.md#open-questions-and-verification).

### B-27: The draft and running-order locks cannot be set from anywhere

- **Where the user meets it:** They cannot. There is no way to lock a completed
  draft.
- **What happens / what was expected:** Both lock flags exist in the schema, and
  the only function that writes them has no caller anywhere in the app. One of
  them is read by nothing at all.
- **Why (from the code):** `updateEvent` in `src/lib/admin-write.functions.ts`.
- **Severity:** `medium`. Dead capability rather than a wrong one.
- **Decision needed:** `product call`. Wire them up, or drop them.
- **Raised by:** [the draft](combine/the-draft.md#open-questions-and-verification),
  [the running order](combine/the-running-order.md#open-questions-and-verification).

### B-28: A failed splits read makes the awards panel claim the votes were unreadable

- **Where the user meets it:** Any moment the event bundle partially fails.
- **What happens / what was expected:** The awards screen chooses between
  "Couldn't read the votes just now" and "No votes cast" using the failure list
  from the _event bundle_, which has nothing to do with votes. A failed splits or
  penalties read therefore claims the votes were unreadable.
- **Why (from the code):** `src/routes/awards.tsx` reads `failedTables` from
  `useEventBundle`.
- **Severity:** `medium`.
- **Decision needed:** `fix`.
- **Raised by:** [the awards](combine/the-awards.md#open-questions-and-verification).

### B-29: Three ways a shared card image can come out wrong

- **Where the user meets it:** Sharing a result card or a pack.
- **What happens / what was expected:** The exporter waits a fixed 100ms for the
  offscreen node before rasterising, and cache-busts the artwork URL by appending
  a query parameter to a _signed_ Supabase URL — either can produce a shared card
  showing initials where a face should be. Separately, splits on the exported
  card render in the bundle's return order, which is unordered, and are keyed by
  station name, so two identically-named stations collide and one is dropped.
  A fourth: the three share buttons fail three different ways. The pack summary
  swallows the failure deliberately, the player page reports it, and the
  leaderboard has a `try`/`finally` with **no `catch` at all** — an unhandled
  rejection with no message, and a complete no-op if the offscreen node is not
  mounted yet.
- **Why (from the code):** `exportCardPng` in `src/lib/share-card.ts`; the splits
  query in `src/lib/event.functions.ts` has no ordering;
  `src/routes/leaderboard.tsx` around the share handler.
- **Severity:** `medium`. The output is the thing people put in the group chat.
- **Decision needed:** `fix`.
- **Raised by:** [sharing](cross-cutting/sharing.md#open-questions-and-verification),
  [the leaderboard](combine/the-leaderboard.md#open-questions-and-verification).

### B-34: Seven screens subscribe to the live feed and never say when it is down

- **Where the user meets it:** Anywhere the feed goes degraded outside the five
  screens that show a banner.
- **What happens / what was expected:** The vault, the pack, the trading post,
  the shop, a player's card, analytics and the **admin console** all watch the
  same event channel and none of them surfaces its health. The console is the
  one that matters — it is where a commissioner times a run, and a frozen screen
  there with no signal is the failure the health states were added for.
  Expected: the same banner the other screens show.
- **Why (from the code):** `FeedDegradedBanner` in
  `src/components/feed-state.tsx` is imported by five route files, and
  `src/routes/tv.tsx:61` renders an equivalent banner of its own from
  `realtimeDegraded`. The seven listed above call `useEventBundle` and read
  neither.
  > The TV board was in this entry's first draft, on the strength of the import
  > list alone. It rolls its own banner, which the import list does not show —
  > a reminder that "which files import the component" is not the same question
  > as "which screens tell the user".
- **Severity:** `medium`. A frozen screen with no signal is the exact failure the
  health states were added for.
- **Decision needed:** `fix`.
- **Raised by:** [realtime and staleness](cross-cutting/realtime-and-staleness.md#open-questions-and-verification).

### B-35: Every link preview is a large-image card with no image

- **Where the user meets it:** Pasting any link to the app into a chat.
- **What happens / what was expected:** The app declares a large-image preview
  card and supplies no image on any route, so the preview renders as a large
  empty card. Expected: either an image, or a smaller card type.
- **Why (from the code):** `twitter:card: summary_large_image` is declared in
  `src/routes/__root.tsx`, `live.tsx` and `auth.tsx`; no route sets `og:image`.
- **Severity:** `medium`. This app is shared by link constantly.
- **Decision needed:** `fix`.
- **Raised by:** [sharing](cross-cutting/sharing.md#open-questions-and-verification).

### B-43: The board and the tier rules disagree about who is ranked

- **Where the user meets it:** The leaderboard, whenever the combine has a tie, a
  scratched athlete with a recorded run, or anybody re-timed.
- **What happens / what was expected:** Three symptoms of one cause — the board
  ranks _official runs_ while tiers rank _athletes in contention_.
  - A dead heat is numbered 1 and 2 by position in the list, while both athletes
    wear the champion tier. The card and the board contradict each other on the
    same screen.
  - An athlete who is scratched or disqualified still holds a place on the board
    if they have an official run, though the tier rules put them out of
    contention for everything.
  - An athlete re-timed appears twice, because every official run becomes a row.
    Expected: the board agrees with the cards.
- **Reproduce:** Record two identical official times; separately, mark an athlete
  with an official run as scratched; separately, save a second official run for
  one athlete. Open the leaderboard each time.
- **Why (from the code):** `src/routes/leaderboard.tsx:40-48` maps every official
  run to a row, filters only on `is_official`, never groups by participant, never
  consults `participation_status`, and takes the place from the rendered index.
  `rarityMap` in `src/lib/card-rarity.ts` does all three of those things —
  best-run-per-athlete, an out-of-contention set, and a place computed by
  counting everyone strictly faster.
- **Severity:** `medium`. Wrong on the screen a card's whole claim to a tier
  rests on, and self-contradicting where a tier badge sits beside a place.
- **Decision needed:** `fix`. The rules already exist in `card-rarity.ts`; the
  board should use them rather than a second, looser set.
- **Status:** Confirmed by reading both, side by side.
- **Raised by:** [the leaderboard](combine/the-leaderboard.md#open-questions-and-verification).

### B-36: Six admin writes authorize against one event and write to any

- **Where the user meets it:** They mostly do not, today — one combine is active
  at a time. It matters the moment a second event exists, or a past one is
  edited.
- **What happens / what was expected:** A handler checks the admin token against
  the event id in the request, then writes a row identified only by its own id,
  with no check that the row belongs to that event. An admin session for last
  year's combine can set a participant's status, reorder the running order,
  rename or delete a station, or delete a run in **this** year's.
- **Reproduce:** Hold an admin token for event A; issue any of the six calls
  naming event A with a row id from event B.
- **Why (from the code):** In `src/lib/admin-write.functions.ts`,
  `setParticipantStatus`, `removeParticipantFromEvent` and `setRunningOrder`
  match on `event_participants.id`; `upsertStation` and `deleteStation` match on
  `stations.id`; `deleteRun` matches on `runs.id`. Each is preceded by
  `requireAdmin(data.eventId)` and none adds `.eq("event_id", data.eventId)`.
  `upsertParticipant` is not in this list — the participants table is
  league-wide by design — and `updateEvent` and `recordRandomization` write with
  the authorized event id itself.
- **Severity:** `medium`. Bounded hard by the deployment: one active event,
  thirteen people, and a shared PIN, so this is a prank rather than a breach
  today. It is listed because the project's security model says plainly that
  these guards are the only thing between a request and the database, and this
  is the guard being narrower than the write it protects.
- **Decision needed:** `fix`. Add the event filter to all six; the guard already
  has the id it needs.
- **Status:** Confirmed by enumerating every handler in that file that calls
  `requireAdmin(data.eventId)` and checking each write's filters.
- **Raised by:** [stations](admin/stations.md#open-questions-and-verification),
  [the roster](admin/the-roster.md#open-questions-and-verification).

### B-37: Deleting a station takes finished runs' splits with it

- **Where the user meets it:** The commissioner removes a station after the
  combine has been run.
- **What happens / what was expected:** The panel refuses to delete a station
  that has recorded times — but that check lives entirely in the screen. The
  handler checks only that the caller is an admin, and the database cascades, so
  a delete reaching it another way removes every split at that station. Since a
  station crown is computed from splits, that can silently demote somebody's
  `stationKing` card to `base`. Expected: the guard is on the write, not on the
  button.
- **Why (from the code):** `deleteStation` in
  `src/lib/admin-write.functions.ts:316-324` checks `requireAdmin` and nothing
  else; `splits.station_id` is `ON DELETE CASCADE`; the "has recorded times"
  block is in `src/components/stations-panel.tsx`.
- **Severity:** `medium`. Rewrites results, but needs a deliberate act to reach.
- **Decision needed:** `fix`. Move the check into the handler.
- **Raised by:** [stations](admin/stations.md#open-questions-and-verification).

### B-38: The tier override is honoured everywhere and reachable from nowhere

- **Where the user meets it:** They cannot. There is no control for it.
- **What happens / what was expected:** Every card carries a stored tier that
  beats the computed one, and the rule is honoured on every screen. No screen in
  the app writes it. Either a commissioner control is missing, or the override is
  dead weight that every reader still pays for.
- **Why (from the code):** `card_rarity` is read as an always-wins override in
  `src/lib/card-rarity.ts:320`; a search of `src/` finds no write outside test
  fixtures.
- **Severity:** `medium`. It shaped this description — the foundation document
  originally said a commissioner could override a tier, on the strength of the
  code honouring one.
- **Decision needed:** `product call`. Build the control, or drop the override.
- **Status:** Confirmed by search; the-card.md corrected accordingly.
- **Raised by:** [the card](foundations/the-card.md#what-a-tier-is),
  [dust and ownership](admin/dust-and-ownership.md#open-questions-and-verification).

### B-39: Grants are not idempotent and cannot be undone

- **Where the user meets it:** The commissioner hands somebody a card, and the
  request times out, or they tap twice.
- **What happens / what was expected:** A real second copy is handed out. The
  only thing preventing it is a per-row spinner, which does not survive a
  reload, and there is no undo. Expected: a grant is idempotent, or reversible.
- **Why (from the code):** `grantCard` and `grantSecretCard` insert without a
  uniqueness key on the grant itself.
- **Severity:** `medium`. Quietly inflates a collection in a game whose whole
  economy is scarcity.
- **Decision needed:** `fix`.
- **Raised by:** [dust and ownership](admin/dust-and-ownership.md#open-questions-and-verification).

### B-40: Rescuing a device's cards is three writes with no transaction

- **Where the user meets it:** The commissioner uses the ownership audit to move
  cards from a device onto a player.
- **What happens / what was expected:** The confirm says "This can't be undone",
  and it is three sequential calls with nothing tying them together. A failure
  between steps leaves the device half-rescued and nothing on screen says so.
- **Why (from the code):** `attachDeviceToPlayer` in
  `src/lib/ownership-audit.functions.ts`.
- **Severity:** `medium`.
- **Decision needed:** `fix`.
- **Raised by:** [dust and ownership](admin/dust-and-ownership.md#open-questions-and-verification).

### B-41: "Record a split here" saves, reads back, and does nothing

- **Where the user meets it:** The commissioner turns a station's split
  recording off.
- **What happens / what was expected:** The switch saves faithfully and the
  timing console ignores it — it filters on whether the station is active and
  nothing else. Expected: the station is skipped.
- **Why (from the code):** `split_enabled` is written by the stations panel and
  read by nothing; `src/hooks/use-run-console.ts` filters on `active` only.
- **Severity:** `medium`. A control that confirms and lies.
- **Decision needed:** `fix`, or remove the switch.
- **Raised by:** [stations](admin/stations.md#open-questions-and-verification).

### B-42: A retired secret card cannot be brought back

- **Where the user meets it:** The commissioner retires a secret card and then
  changes their mind.
- **What happens / what was expected:** The handler accepts the field that would
  restore it; the panel never sends it. There is no way back from the screen.
- **Why (from the code):** `updateSecretCard` in
  `src/lib/secret-cards.functions.ts` accepts `active`;
  `src/components/secret-cards-panel.tsx` never sends `active: true`.
- **Severity:** `medium`.
- **Decision needed:** `fix`.
- **Raised by:** [secret card sets](admin/secret-card-sets.md#open-questions-and-verification).

## Low

### B-30: Accessibility gaps across the app

- **Where the user meets it:** Using the app with a screen reader, or with
  anything other than a thumb.
- **What happens:** A cluster of independent gaps, none fatal:
  - The active navigation tab is conveyed by colour alone. No `aria-current` is
    set anywhere in `src/components/site-nav.tsx`, so the current page is not
    exposed programmatically.
  - All thirteen share buttons on the leaderboard carry the identical label
    "Share result card".
  - The leaderboard's ranked list is an unordered list.
  - The finish celebration overlay is not announced as a dialog and never takes
    focus.
  - The reveal stand has no Next control: a swipe or an unannounced arrow key
    is the only way forward, and the one focusable alternative is styled at
    9px and 45% opacity and is removed entirely on the secret's step.
  - The card page's Pin, Sound and Tilt settings carry no pressed state, unlike
    the star on the same page's tiles — and on a phone they live inside menu
    items, which have none at all.
  - The off-screen share composite on a player's page is mounted for the whole
    visit with no `aria-hidden`, so its entire text duplicates the page in the
    accessibility tree. The pack summary's equivalent is hidden correctly.
  - There is no skip link anywhere, and no focus management across route
    changes.
  - The sound toggle exists on exactly one screen, behind an overflow menu on a
    phone — a screen away from the ceremony it silences.
  - Reduced motion gates audio and haptics as well as motion, so a still screen
    with audible feedback is not expressible.
  - The pack's "Pack Complete" heading is deliberately false for about
    six-tenths of a second, and a screen reader announces it as fact.
  - A share that cannot be produced brings the button back with no message, so a
    screen reader user gets no feedback at all.
- **Severity:** `low` individually, and worth treating as one piece of work.
- **Decision needed:** `fix`, except the false heading, which is a
  `product call`.
- **Status:** The missing `aria-current` was confirmed by the scripted pass —
  the probe for it found nothing, and the active tab is a colour class.
- **Raised by:** [accessibility](cross-cutting/accessibility.md),
  [the leaderboard](combine/the-leaderboard.md#open-questions-and-verification),
  [opening a pack](cards/opening-a-pack.md#open-questions-and-verification),
  [sharing](cross-cutting/sharing.md#open-questions-and-verification).

### B-31: Small rendering and copy slips

- **The filmstrip computes a finish and throws it away.** The roster filmstrip
  builds each entry with an edition and its component declares no such field, so
  every thumbnail renders standard. No leak; it simply shows less than intended.
- **A hand-edited `?vs=` can name the current player**, giving a comparison of
  somebody against themselves with every row a tie. The picker filters self out;
  the URL does not.
- **The trade feed splits on a separator that can occur inside a name.** A
  secret named "Salt + Pepper" renders as two separately highlighted pieces.
- **A load-bearing comment points at a migration that does not exist.**
  `src/lib/trades.ts` cites `20260825140000_trade_feed_secret_names.sql`; the
  rule lives in `20260827130000_name_traded_secrets.sql`. Sharper than usual,
  because that naming has already been reverted once by a migration re-created
  from a stale copy, and this comment is the breadcrumb meant to prevent it.
- **A negative margin with no matching parent padding** on analytics, the recap
  and the TV board removes their side gutter entirely.
- **Three public routes are absent from the smoke test** that otherwise renders
  every one: analytics, the recap and the TV board.
- **`queued` versus `waiting`.** One cancel path writes `queued`; every other
  reset writes `waiting`. Both behave identically, and `waiting` is the schema
  default and the word players see.
- **A hidden commissioner-created set renders as a raw identifier** in the admin
  card picker, because the label lookup falls back to the four seeded sets.
- **An unused import** on the player page.
- **The bulk-upload oversize badge names the wrong cap.** It reads "Over 12 MB"
  while the limit is 8.8 MB, so a 10 MB file is correctly rejected and then
  labelled with a number it is under.
- **Replacing a player's card art orphans the old files.** The player-card
  upload never removes what it replaces, unlike the card-back and secret-art
  uploads, so storage keeps every version ever uploaded.
- **The stations panel trusts an empty splits list even when that read failed.**
  The bundle reports which tables it could not read; the panel does not consult
  it, so the delete guard is disarmed exactly when the data is missing rather
  than absent.
- **The ownership audit's "Belongs to" select has no accessible name**, unlike
  every neighbouring dropdown.
- **Reordering two stations is two writes with no transaction**, so a
  half-completed swap leaves them sharing an order value.
- **A card back's station ladder includes retired stations**, printing an empty
  row for a station nobody ever ran.
- **The live feed subscribes to splits and penalties unfiltered**, while runs,
  participants and draft picks are filtered by event — so any event's splits fan
  out to every watcher. Invisible while one combine is active.
- **Severity:** `low`. **Decision needed:** `fix`.

### B-32: The compare picker dresses an unpacked card in its real tier

- The comparison picker colours every player's initials with their real tier
  accent, including players this device has never packed. The vault's sort, its
  locked styling and the filmstrip all go out of their way to dress an unpacked
  card neutrally. Tiers are public on the leaderboard, so this may well be
  intended.
- **Severity:** `low`. **Decision needed:** `product call`.
- **Raised by:** [comparing cards](cards/comparing-cards.md#open-questions-and-verification).

### B-33: Out of season, trading closes silently — including for secrets

- With no active event the spares list comes back wholly empty and both pickers
  read "No spares to trade" with no reason given — even though secret pulls are
  not event-scoped and a secret-for-secret swap would be accepted. Relatedly, the
  feed requires an event id while a trade's event may be null, so a trade settled
  out of season is recorded and then never appears in any feed.
- **Severity:** `low`. Plausibly intended, but stated nowhere.
- **Decision needed:** `product call`.
- **Raised by:** [the trading post](trading/the-trading-post.md#open-questions-and-verification),
  [the trade feed](trading/the-trade-feed.md#open-questions-and-verification).
