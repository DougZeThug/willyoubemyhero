# Bug triage

A consolidated list of the defects and inconsistencies the feature documents
raised, in their bodies and in their "Open questions and verification" sections.
The list was read from this repository at commit `b46f330` and from its tests. It
existed so the league could decide, item by item, whether to fix, to document as
intended, or to leave.

**That pass has now been made.** Every entry marked `fix` has been fixed, and two
of the `product call` entries were decided and acted on. What is left is five
product calls that still belong to the league, plus one inside B-30.

Nothing here has been watched on a phone in a garden. Everything claimed as fixed
is covered by the unit, database or end-to-end suites, and the **Fixed** line on
each entry says what changed.

## Summary

Around sixty suspected defects were raised across the fifty-one documents. After
merging by root cause they came to **43 entries**: 7 high, 32 medium, and 4 low
(three of which are clusters of small slips).

Four of those turned out to be already fixed in code — the doc was read at
`b46f330` and seventy-seven commits had landed since. The other thirty-four
`fix` entries, and the two product calls the league took (B-14, B-27), are fixed
here. **Five entries remain open**, all product calls: B-07, B-23, B-32, B-33 and
B-38, plus the deliberately-false "Pack Complete" heading inside B-30.

Two clusters accounted for most of the high entries, and both are closed. The
first was **writes that report a success they did not have** — the running
order, the draft's undo, the timing console's start, and the member-code
rotation all returned `ok` on a path that failed, and in one case that lost
paper codes irrecoverably. The second was **identity transitions that go
quiet** — claiming a player while signed in to an account that already holds
one, and the account screen becoming unreachable the moment its own link
settles.

The largest medium cluster was **six screens disagreeing about the same
number**: a run marked official with no time sorted to the top on three of them
and to the bottom on the other three. There is now one set of rules, in
`src/lib/standings.ts`, that the board and the tier both read.

A second medium cluster was **guards narrower than the writes they protect**:
six admin handlers checked the caller against one event and then wrote a row
belonging to any, and a station delete's "this has recorded times" check lived
in the screen rather than in the handler that cascades.

| ID   | Title                                                                       | Severity | Area          | Outcome             |
| ---- | --------------------------------------------------------------------------- | -------- | ------------- | ------------------- |
| B-01 | A partial code rotation destroys paper codes irrecoverably                  | high     | admin         | fixed               |
| B-02 | Issued codes are shown once and held only in page state                     | high     | admin         | fixed               |
| B-03 | Claiming a second player on one account fails silently and says "Welcome"   | high     | accounts      | fixed               |
| B-04 | The account screen is unreachable the moment its link settles               | high     | accounts      | fixed               |
| B-05 | An official run with no time sorts to the top on three screens              | high     | combine       | fixed               |
| B-06 | Reordering the running order reports a success it did not have              | high     | admin         | fixed upstream      |
| B-07 | A guest who claims mid-day is re-dealt today's pack                         | high     | accounts      | product call — open |
| B-08 | A shared head-to-head link does not open the comparison                     | medium   | cards         | fixed               |
| B-09 | Analytics has no loading, error or degraded state                           | medium   | combine       | fixed               |
| B-10 | The trade screen's set-complete ceremony leaves the nav reachable           | medium   | trading       | fixed               |
| B-11 | Milling a spare leaves it offerable on the Trading Post                     | medium   | dust          | fixed               |
| B-12 | Award winners arrive up to a minute before the lock does                    | medium   | combine       | fixed               |
| B-13 | A guest who finishes a set never sees its ceremony                          | medium   | cards         | fixed               |
| B-14 | The claim screen's copy contradicts what claiming does                      | medium   | accounts      | fixed (copy)        |
| B-15 | "Sign out on this device" undoes itself on the next reload                  | medium   | accounts      | fixed               |
| B-16 | Adding a player is two unlinked writes                                      | medium   | admin         | fixed               |
| B-17 | The draft's undo reports a success it did not have                          | medium   | combine       | fixed               |
| B-18 | The crowd's clock is formatted unlike every other time in the app           | medium   | combine       | fixed               |
| B-19 | The live screen loses a finish, and can call the field done early           | medium   | combine       | fixed               |
| B-20 | Turning a full-size card over is silent                                     | medium   | cards         | fixed               |
| B-21 | Tilt reports success on hardware with no gyroscope                          | medium   | cards         | fixed               |
| B-22 | The timing console's Start can fail without saying so                       | medium   | admin         | fixed upstream      |
| B-23 | Two commissioners editing one result overwrite each other silently          | medium   | admin         | product call — open |
| B-24 | The marketplace renders a blank space where a seller's stall belongs        | medium   | dust          | fixed               |
| B-25 | The secret sheet swipes through shelves that are rolled up                  | medium   | cards         | fixed               |
| B-26 | The signed-out trading gate pushes a code-holder to create an account       | medium   | trading       | fixed               |
| B-27 | The draft and running-order locks cannot be set from anywhere               | medium   | combine       | dropped             |
| B-28 | A failed splits read makes the awards panel claim the votes were unreadable | medium   | combine       | fixed               |
| B-29 | Three ways a shared card image can come out wrong                           | medium   | cross-cutting | fixed               |
| B-34 | Seven screens subscribe to the live feed and never say when it is down      | medium   | cross-cutting | fixed               |
| B-35 | Every link preview is a large-image card with no image                      | medium   | cross-cutting | fixed (small card)  |
| B-36 | Six admin writes authorize against one event and write to any               | medium   | admin         | fixed               |
| B-37 | Deleting a station takes finished runs' splits with it                      | medium   | admin         | fixed               |
| B-38 | The tier override is honoured everywhere and reachable from nowhere         | medium   | cards         | product call — open |
| B-39 | Grants are not idempotent and cannot be undone                              | medium   | admin         | fixed (idempotent)  |
| B-40 | Rescuing a device's cards is three writes with no transaction               | medium   | admin         | fixed               |
| B-41 | "Record a split here" saves, reads back, and does nothing                   | medium   | admin         | fixed               |
| B-42 | A retired secret card cannot be brought back                                | medium   | admin         | fixed               |
| B-43 | The board and the tier rules disagree about who is ranked                   | medium   | combine       | fixed               |
| B-30 | Accessibility gaps across the app                                           | low      | cross-cutting | fixed (one open)    |
| B-31 | Small rendering and copy slips                                              | low      | —             | fixed               |
| B-32 | The compare picker dresses an unpacked card in its real tier                | low      | cards         | product call — open |
| B-33 | Out of season, trading closes silently — including for secrets              | low      | trading       | product call — open |

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
  `src/lib/member.functions.ts` looped the targets and did
  `if (error) throw error;` inside the loop, after previous upserts had already
  committed. The plaintext lived only in the local `issued` array, which was lost
  when the handler threw. Only the salted hash is stored, by design.
- **Severity:** `high`. Silently destroys credentials with no recovery path
  short of rotating again.
- **Fixed:** Every code is minted first and written in one batch `upsert`, so
  the write is all or nothing and the plaintext is only returned when it landed.
  `src/lib/member.functions.test.ts` pins both halves: one statement for the
  whole roster, and a failed write reported rather than a list nothing was
  written for.
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
- **Why (from the code):** `src/components/member-admin-panel.tsx` held the
  issued list in component state and nothing persisted it. Only the hash is
  stored server-side, deliberately, so it genuinely cannot be shown again.
- **Severity:** `high`. Same loss as B-01, reached by an ordinary accident
  rather than a failure.
- **Fixed:** A print view beside the copy-all, both of which now cover a single
  re-issue as well as a whole batch — one fresh code beside a roster row is
  exactly as unrecoverable as a list of them. A `beforeunload` warning is armed
  while the codes are still only on screen, and the header says whether they
  have been got off it yet. Still no "show again": the hash is the only thing
  stored, and that is the right trade.
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
  threw `"This account is already linked to another player"` on purpose, with a
  comment explaining that re-binding would drag every other device onto the new
  player. `src/routes/claim.tsx` wrapped the call in a bare `try {} catch {}`
  whose comment covers a _transient_ failure — "the claim stands; signing in
  again re-runs the adoption" — and swallowed the permanent refusal identically.
- **Severity:** `high`. Silently does something different from what the screen
  confirmed.
- **Fixed:** The deliberate refusal is now a named `AccountAlreadyLinkedError`,
  returned by `linkClaimedPlayer` as data rather than thrown, so the claim
  screen can tell it apart from a flaky request. A throw is still swallowed —
  that reasoning was right. A refusal names the player the account already holds
  and says what to do about it.
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
  `src/routes/auth.tsx` navigated away whenever
  `user && sync.status === "ready" && sync.userId === user.id`, which is the
  normal steady state for a signed-in user.
- **Severity:** `high`. A whole screen, and the only in-app route to the claim
  flow for a signed-in player, is unreachable in the common case.
- **Fixed:** The redirect is armed only when the page was signed **out** when it
  mounted — a genuine sign-in round trip — or when whoever linked here passed an
  explicit `next`. Opening the account screen from the menu now shows the
  account screen.
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
- **Why (from the code):** `src/routes/live.tsx`, `src/routes/tv.tsx` and
  `src/routes/recap.$slug.tsx` sorted with `(a.official_time_ms ?? 0)`, which
  puts null first. `src/routes/leaderboard.tsx`, `src/routes/draft.tsx` and
  `src/routes/analytics.tsx` used `?? Infinity`, which puts it last. Analytics
  additionally fed `Infinity` to `formatTime` when _every_ run was null, which
  printed `NaN.NaN`.
- **Severity:** `high`. The big screen in front of the party shows the wrong
  winner, and this is exactly the state a live combine passes through.
- **Fixed:** One comparator, `compareOfficialTime` in `src/lib/standings.ts`,
  read by all six. `formatTime` guards non-finite rather than only `NaN`.
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
- **Why (from the code):** `setRunningOrder` in
  `src/lib/admin-write.functions.ts` fired every update inside `Promise.all`,
  checked none of the results, and returned `{ ok: true }` unconditionally.
- **Severity:** `high`. Silently produces a corrupt order on the one screen that
  decides who runs next.
- **Fixed upstream:** already corrected in commit `fe4fe04`, "Fixed reorder race
  condition", before this pass began — the handler collects every result and
  throws on the first error. This pass added the event scoping described in
  B-36 alongside it.
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
- **Still open — `product call`.** Carrying the guest's pack across is the
  generous reading; leaving it is defensible if a second pack on claim day is
  considered a welcome gift. Either way it should be deliberate, and it is
  currently a side effect.
  > Worth noting alongside B-13, which was fixed: the trophy for a set a guest
  > finished now survives the claim, because the device primes its ceremony
  > watcher while it is still a guest. The pack is the same shape of problem and
  > the same fix is available — key the stored pack on the league day and the
  > device as well as the identity — but which answer is right is the league's
  > call, not a defect.
- **Raised by:** [keeping your cards](accounts/keeping-your-cards.md#open-questions-and-verification),
  [the sealed pack](cards/the-sealed-pack.md#open-questions-and-verification).

## Medium

### B-08: A shared head-to-head link does not open the comparison

- **Where the user meets it:** Somebody drops a `?vs=` link in the group chat —
  which the route's own comment says is the whole reason the parameter exists.
- **What happens / what was expected:** The recipient lands on the left player's
  card with the Compare chip lit and has to tap it. Expected: the comparison is
  open.
- **Why (from the code):** `src/routes/players.$id.tsx` initialised `comparing`
  to `false` and nothing derived it from the search parameter; the chip lit from
  `!!vs` and the sheet opened from `comparing`.
- **Severity:** `medium`. The feature works, one tap later than intended.
- **Fixed:** `comparing` is seeded from the parameter.
- **Raised by:** [comparing cards](cards/comparing-cards.md#open-questions-and-verification).

### B-09: Analytics has no loading, error or degraded state

- **Where the user meets it:** Opening Analytics on a slow connection, or while
  a read is failing.
- **What happens / what was expected:** A pending fetch, a failed read and a
  genuinely empty combine all render the same "No split data yet." Expected: the
  three are told apart, as they are on every other combine screen.
- **Why (from the code):** `src/routes/analytics.tsx` destructured only
  `bundle` from `useEventBundle()`, discarding `loading`, `error`,
  `failedTables` and `realtimeDegraded`. `src/components/feed-state.tsx` exists
  precisely for this and was not used here.
- **Severity:** `medium`. The same failure the live screen was fixed for.
- **Fixed:** The screen uses `FeedLoading`, `FeedError` and
  `FeedDegradedBanner`, in the same shape as `/leaderboard`, and both of its
  empty states say whether the read failed or the combine is genuinely empty.
- **Raised by:** [analytics and the archive](combine/analytics-and-the-archive.md#open-questions-and-verification).

### B-10: The trade screen's set-complete ceremony leaves the nav reachable

- **Where the user meets it:** A trade completes a secret set, and the ceremony
  plays on the trading post.
- **What happens / what was expected:** The ceremony covers the screen but the
  nav bars stay live — focusable, and reachable at the edges. Every other
  ceremony in the app fades and disables them.
- **Why (from the code):** `src/routes/players.trade.tsx` mounted
  `CollectionComplete` without `PresentationMode`; `players.pack.tsx` and
  `trophy-ceremony-host.tsx` both pair them.
- **Severity:** `medium`. Inconsistent, and the chrome is tappable under a
  full-screen moment.
- **Fixed:** The two are paired here too.
- **Raised by:** [answering an offer](trading/answering-an-offer.md#open-questions-and-verification).

### B-11: Milling a spare leaves it offerable on the Trading Post

- **Where the user meets it:** Mill a spare in the shop, then go straight to
  Trade and try to offer it.
- **What happens / what was expected:** For up to thirty seconds the copy is
  still listed as offerable, and composing the offer is then refused by the
  server. Expected: it disappears when it is spent.
- **Why (from the code):** `src/components/dust-shop.tsx` invalidated its own
  spares key and the card stats key, but not the key `useTradeSpares` registers
  under in `src/hooks/use-trades.ts`. `src/components/market-panel.tsx` did
  invalidate it after a buy, so the two panels on the same screen disagreed.
- **Severity:** `medium`. Bounded by a cache lifetime, and the server refuses
  correctly.
- **Fixed:** All three of the shop's spend paths invalidate `tradeSparesKey`
  alongside their own key.
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
- **Fixed:** The awards subscription in `src/hooks/use-event-social.ts` now
  invalidates `["active-event"]` alongside its own key, so the ballot closes on
  the same event that delivers the winners.
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
  `useCollectionTrophyWatcher` returned early while it had no participant id, so
  a guest never primed at all and the claim itself became the priming pass.
- **Severity:** `medium`. Loses the payoff for the one path where it is most
  earned.
- **Fixed:** Priming is gated on `usePackIdentity()`, which is `d:<deviceId>`
  for a guest — so the device primes while it is still a guest, where the pass
  is a silent no-op, and the trophy the claim banks is genuinely new.
- **Raised by:** [collection trophies](cards/collection-trophies.md#open-questions-and-verification).

### B-14: The claim screen's copy contradicts what claiming does

- **Where the user meets it:** Reading the claim screen before typing a code.
- **What happens / what was expected:** It said "One time only — it sticks on
  this device". Codes stay valid after the first claim on purpose, because people
  get new phones, and every re-claim is counted. One of the two was wrong.
- **Why (from the code):** The copy in `src/routes/claim.tsx` against the
  comment on `claimPlayer` in `src/lib/member.functions.ts`.
- **Severity:** `medium`. Discourages somebody from doing the thing the feature
  was built to allow.
- **Fixed — the league chose the copy.** The screen now says the code keeps
  working and invites using it on a new phone. The behaviour is unchanged,
  because the behaviour was the deliberate half.
- **Raised by:** [claiming your player](accounts/claiming-your-player.md#open-questions-and-verification).

### B-15: "Sign out on this device" undoes itself on the next reload

- **Where the user meets it:** A signed-in player uses the sign-out on the claim
  screen.
- **What happens / what was expected:** Only the member token is dropped. The
  account session is untouched, so the next reload re-mints the token and the
  sign-out silently reverses. In the meantime the vault shows the "your secrets
  are on your name, not on this phone" breadcrumb, which is misleading for
  somebody still signed in.
- **Why (from the code):** `src/routes/claim.tsx` called `clearMemberToken()`
  alone; `useAccountSync` is latched per user id and re-establishes it.
- **Severity:** `medium`.
- **Fixed:** When there is an account session the control signs out of it too,
  and says "Sign out" rather than "Sign out on this device" — which makes the
  label true either way. The misleading breadcrumb goes with it.
- **Raised by:** [signing in](accounts/signing-in.md#open-questions-and-verification).

### B-16: Adding a player is two unlinked writes

- **Where the user meets it:** The commissioner adds somebody to the roster.
- **What happens / what was expected:** A failure between the two writes leaves a
  person created but not on the roster. Retyping the name creates a _second_
  person, because the form never matches an existing one.
- **Why (from the code):** `src/routes/admin.tsx` called `upsertParticipant` and
  then `addParticipantToEvent` as separate operations.
- **Severity:** `medium`. Produces duplicate people in a league of thirteen.
- **Fixed:** One handler, `addPlayerToRoster`, which matches an existing
  participant by name case-insensitively, creates only when the league has never
  heard of them, and is a no-op for somebody already on this roster. Not a
  transaction — they are two tables in PostgREST — but every step is idempotent,
  so the retry after a failure lands on the same person rather than a new one.
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
- **Fixed:** Both are one Postgres statement now
  (`supabase/migrations/20260901120000_draft_selection_rpcs.sql`), serialised on
  the event row: the numbering, the selection row and the roster stamp share a
  transaction, `(event_id, selection_order)` is unique, and undo returns the
  participant it gave back or null. An empty board says so rather than answering
  ok. `tests/db/draft-rpcs.test.ts` covers all three, including two picks landing
  at once.
- **Raised by:** [the draft](combine/the-draft.md#open-questions-and-verification).

### B-18: The crowd's clock is formatted unlike every other time in the app

- **Where the user meets it:** Watching the live screen or the TV board.
- **What happens / what was expected:** Under a minute the HUD timer renders
  `41:32s`; at a minute it switches to `1:41.32`. Everywhere else that duration is
  `41.32`. Somebody arriving from the leaderboard reads forty-one minutes.
- **Why (from the code):** `src/components/hud-timer.tsx` formatted
  independently of `formatTime` in `src/lib/format.ts`.
- **Severity:** `medium`. Actively misreads on the screen most people are
  watching.
- **Fixed:** `formatTime` for both halves, with the `s` suffix kept only while
  there is no minutes part — `1:41.32s` would read no better.
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
  held only `finished` and `scratched`.
- **Severity:** `medium`. Three symptoms, one screen, all on race day.
- **Fixed:** The celebration queue landed upstream (commit `c04a449`, "Queued
  finish celebrations"). This pass fixed the other two: `done` counts distinct
  athletes rather than official runs, `fieldSize` drops the whole
  out-of-contention family from the denominator rather than only the scratched,
  and `DONE` is `finished` plus that same family, so the queue moves past a dq,
  dnp or absent athlete.
- **Raised by:** [live timing](combine/live-timing.md#open-questions-and-verification).

### B-20: Turning a full-size card over is silent

- **Where the user meets it:** Turning a card over on a player's page or in the
  secret sheet — the two screens built for handling a card.
- **What happens / what was expected:** No card-stock sound. The sound exists and
  plays on smaller surfaces.
- **Why (from the code):** `playFlip()` fired only from `HoloCard`'s own toggle.
  On both full-size surfaces the zoom frame swallows the click and the callers
  set the flipped state directly — `src/routes/players.$id.tsx` and
  `src/components/secret-card-sheet.tsx`.
- **Severity:** `medium`. A deliberate piece of feel, unreachable where it matters
  most.
- **Fixed:** Both surfaces, and the Flip chip beside the card, play it.
- **Raised by:** [looking closer](cards/looking-closer.md#open-questions-and-verification).

### B-21: Tilt reports success on hardware with no gyroscope

- **Where the user meets it:** Turning on Tilt in a desktop browser.
- **What happens / what was expected:** The chip lights and nothing moves, with
  no message. Expected: it says the device cannot do this.
- **Why (from the code):** `requestGyroPermission` in `src/lib/gyro.ts` returned
  true whenever the orientation event type existed but exposed no permission
  request — true of desktop Chrome and Firefox.
- **Severity:** `medium`.
- **Fixed:** `requestGyroAccess` returns `granted` / `denied` / `unsupported`.
  Where there is no permission prompt to answer, the only honest test is whether
  a reading with real angles in it arrives, so it waits briefly for one. The chip
  says "no motion sensor — try it on a phone" rather than lighting silently.
- **Raised by:** [looking closer](cards/looking-closer.md#open-questions-and-verification).

### B-22: The timing console's Start can fail without saying so

- **Where the user meets it:** Starting a run on race day.
- **What happens / what was expected:** The status write is swallowed on failure,
  so the crowd's clock can stay stopped for a run that is genuinely under way
  with nothing on the console saying so.
- **Why (from the code):** `startRun` in `src/hooks/use-run-console.ts`.
- **Severity:** `medium`. The local run is unaffected, which is what matters
  most, but every spectator screen is wrong.
- **Fixed upstream:** already corrected in commit `769bf37`, "Fixed run console
  validator", before this pass began — a failed status write is reported.
- **Raised by:** [running the clock](admin/running-the-clock.md#open-questions-and-verification).

### B-23: Two commissioners editing one result overwrite each other silently

- **Where the user meets it:** Two people fixing the same time.
- **What happens / what was expected:** The edit sheet never re-seeds while open,
  so the second save wins and neither side is told.
- **Why (from the code):** `src/components/edit-result-sheet.tsx` seeds on open
  only. Not re-seeding on every keystroke is deliberate and correct; not noticing
  a change at save time is the part that is probably not.
- **Severity:** `medium`.
- **Still open — `product call`.** A conflict warning at save, or accept
  last-write-wins in a league of thirteen. Both are a few lines; which one is
  right depends on whether two people ever hold the console at once, which the
  league knows and this document does not.
- **Raised by:** [editing a result](admin/editing-a-result.md#open-questions-and-verification).

### B-24: The marketplace renders a blank space where a seller's stall belongs

- **Where the user meets it:** A seller opens the shop just after dust is
  switched off, with listings still up.
- **What happens / what was expected:** The panel renders nothing while the stall
  is still loading, then pops in. That path exists so a seller can always cancel
  a listing, so a blank frame there reads as "my cards are gone".
- **Why (from the code):** `src/components/market-panel.tsx` returned null on
  "dust off and no active listings" without considering the loading state.
- **Severity:** `medium`.
- **Fixed:** The early return waits for the stall to land. The panel already had
  a "Counting your stall…" line; it simply never got a chance to show it.
- **Raised by:** [the marketplace](dust/the-marketplace.md#open-questions-and-verification).

### B-25: The secret sheet swipes through shelves that are rolled up

- **Where the user meets it:** Swiping through secrets in the vault with some
  shelves collapsed.
- **What happens / what was expected:** Swiping past the end of an open shelf
  lands on a card from a closed one. The sheet's own comment says it "swipes what
  is on screen, in the order it is on screen".
- **Why (from the code):** the visible-secrets list in
  `src/routes/players.index.tsx` walked the shelf order rather than the open
  shelves.
- **Severity:** `medium`.
- **Fixed:** A collapsed shelf contributes nothing to the swipe list.
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
  redirected to `/auth?mode=signup`; the only claim link in `src/routes/auth.tsx`
  was inside the signed-in branch. The existing e2e test asserted on the
  transient panel, so it passed without exercising the redirect.
- **Severity:** `medium`. Sends a new player down the wrong path, and the test
  that should catch it does not.
- **Fixed:** The gate goes to `/claim`. The signed-out sign-in screen now carries
  a claim link, and the claim screen carries the account route for anybody who is
  not on the roster — the two halves of the same fork. `e2e/trades.spec.ts`
  asserts on the URL now rather than on the panel that flashes over it.
- **Raised by:** [the trading post](trading/the-trading-post.md#open-questions-and-verification).

### B-27: The draft and running-order locks cannot be set from anywhere

- **Where the user meets it:** They cannot. There is no way to lock a completed
  draft.
- **What happens / what was expected:** Both lock flags exist in the schema, and
  the only function that writes them has no caller anywhere in the app. One of
  them is read by nothing at all.
- **Why (from the code):** `updateEvent` in `src/lib/admin-write.functions.ts`.
- **Severity:** `medium`. Dead capability rather than a wrong one.
- **Dropped — the league chose to drop rather than build.** `draft_locked` and
  `running_order_locked` are gone from `updateEvent`, and the permanently-false
  `running_order_locked` check that gated the Re-randomize button on `/order`
  went with them. **The columns stay in the schema** — dropping one costs a
  migration to bring it back, and the feature may return.
  > Found while doing this and worth recording separately: `updateEvent` has no
  > caller at all. `results_locked`, `splits_enabled`, `status` and
  > `timing_mode` are equally unwritable from any screen. That is a wider
  > question than B-27 asked, so nothing was done about it here.
- **Raised by:** [the draft](combine/the-draft.md#open-questions-and-verification),
  [the running order](combine/the-running-order.md#open-questions-and-verification).

### B-28: A failed splits read makes the awards panel claim the votes were unreadable

- **Where the user meets it:** Any moment the event bundle partially fails.
- **What happens / what was expected:** The awards screen chooses between
  "Couldn't read the votes just now" and "No votes cast" using the failure list
  from the _event bundle_, which has nothing to do with votes. A failed splits or
  penalties read therefore claims the votes were unreadable.
- **Why (from the code):** `src/routes/awards.tsx` read `failedTables` from
  `useEventBundle`.
- **Severity:** `medium`.
- **Fixed:** It reads the awards query's own error state.
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
  query in `src/lib/event.functions.ts` had no ordering;
  `src/routes/leaderboard.tsx` around the share handler.
- **Severity:** `medium`. The output is the thing people put in the group chat.
- **Fixed:** `cacheBust` is off — the signature covers the query string, so
  appending to it is what broke the fetch — and a new `waitForPaint` waits for
  the images and the fonts instead of the fixed 100ms and 350ms sleeps the three
  callers used. The splits query is ordered. The leaderboard's handler has a
  catch, and reports a failure rather than swallowing an unhandled rejection; the
  pack summary keeps its deliberate quiet but says so in a polite live region
  (see B-30). The exported splits are still keyed by station name in
  `ResultCard`'s row keys; two identically-named stations in one event is a
  problem the stations panel should refuse rather than the exporter work around,
  and it is not one this pass created or closed.
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
  `src/components/feed-state.tsx` was imported by five route files, and
  `src/routes/tv.tsx` renders an equivalent banner of its own from
  `realtimeDegraded`. The seven listed above called `useEventBundle` and read
  neither.
  > The TV board was in this entry's first draft, on the strength of the import
  > list alone. It rolls its own banner, which the import list does not show —
  > a reminder that "which files import the component" is not the same question
  > as "which screens tell the user".
- **Severity:** `medium`. A frozen screen with no signal is the exact failure the
  health states were added for.
- **Fixed:** All seven show it, the console included — where it sits inside
  `TimingConsole`, above the run controls.
- **Raised by:** [realtime and staleness](cross-cutting/realtime-and-staleness.md#open-questions-and-verification).

### B-35: Every link preview is a large-image card with no image

- **Where the user meets it:** Pasting any link to the app into a chat.
- **What happens / what was expected:** The app declares a large-image preview
  card and supplies no image on any route, so the preview renders as a large
  empty card. Expected: either an image, or a smaller card type.
- **Why (from the code):** `twitter:card: summary_large_image` was declared in
  `src/routes/__root.tsx`, `live.tsx` and `auth.tsx`; no route sets `og:image`.
- **Severity:** `medium`. This app is shared by link constantly.
- **Fixed — the smaller card, which was the second of the two options the entry
  offered.** All three declarations are `summary` now, so a pasted link renders
  as a correct small card carrying the title and description each route already
  writes, instead of a big blank one. There is no artwork to point at and none
  worth inventing; each declaration carries a comment saying to switch it back
  the day a route sets an `og:image` worth the space.
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
- **Why (from the code):** `src/routes/leaderboard.tsx` mapped every official
  run to a row, filtered only on `is_official`, never grouped by participant,
  never consulted `participation_status`, and took the place from the rendered
  index. `rarityMap` in `src/lib/card-rarity.ts` did all three of those things —
  best-run-per-athlete, an out-of-contention set, and a place computed by
  counting everyone strictly faster.
- **Severity:** `medium`. Wrong on the screen a card's whole claim to a tier
  rests on, and self-contradicting where a tier badge sits beside a place.
- **Fixed:** Those rules are now `src/lib/standings.ts`, and both the board and
  `card-rarity.ts` read it. The place rendered on the board is the computed
  place, not the list index, so a dead heat shares a number.
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
  matched on `event_participants.id`; `upsertStation` and `deleteStation` matched
  on `stations.id`; `deleteRun` matched on `runs.id`. Each was preceded by
  `requireAdmin(data.eventId)` and none added `.eq("event_id", data.eventId)`.
  `upsertParticipant` is not in this list — the participants table is
  league-wide by design — and `updateEvent` and `recordRandomization` write with
  the authorized event id itself.
- **Severity:** `medium`. Bounded hard by the deployment: one active event,
  thirteen people, and a shared PIN, so this is a prank rather than a breach
  today. It is listed because the project's security model says plainly that
  these guards are the only thing between a request and the database, and this
  is the guard being narrower than the write it protects.
- **Fixed:** All six carry the event filter, and each asks for its rows back —
  the filter alone would affect nothing and still return ok, which is the same
  shrug as no guard at all. `setParticipantStatus` reuses the on-clock read it
  already made, so none of this costs a round trip; `setRunningOrder` checks the
  whole batch once before any row moves.
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
  `src/lib/admin-write.functions.ts` checked `requireAdmin` and nothing else;
  `splits.station_id` is `ON DELETE CASCADE`; the "has recorded times" block was
  in `src/components/stations-panel.tsx`.
- **Severity:** `medium`. Rewrites results, but needs a deliberate act to reach.
- **Fixed:** The handler counts splits and penalties at the station and refuses.
  The panel keeps its copy as the friendly pre-empt — and gained a fix of its
  own, in B-31: it used to trust an empty splits list even when that read had
  failed, which disarmed the guard exactly when the data was missing rather than
  absent.
- **Raised by:** [stations](admin/stations.md#open-questions-and-verification).

### B-38: The tier override is honoured everywhere and reachable from nowhere

- **Where the user meets it:** They cannot. There is no control for it.
- **What happens / what was expected:** Every card carries a stored tier that
  beats the computed one, and the rule is honoured on every screen. No screen in
  the app writes it. Either a commissioner control is missing, or the override is
  dead weight that every reader still pays for.
- **Why (from the code):** `card_rarity` is read as an always-wins override in
  `src/lib/card-rarity.ts`; a search of `src/` finds no write outside test
  fixtures.
- **Severity:** `medium`. It shaped this description — the foundation document
  originally said a commissioner could override a tier, on the strength of the
  code honouring one.
- **Still open — `product call`.** Build the control, or drop the override. B-27
  was the same shape and was dropped, but this one is not the same call: a tier
  is the thing a card's whole claim rests on, and a commissioner overriding one
  after a disputed run is a plausible thing to want. Unlike B-27 the read costs
  almost nothing to keep.
- **Raised by:** [the card](foundations/the-card.md#what-a-tier-is),
  [dust and ownership](admin/dust-and-ownership.md#open-questions-and-verification).

### B-39: Grants are not idempotent and cannot be undone

- **Where the user meets it:** The commissioner hands somebody a card, and the
  request times out, or they tap twice.
- **What happens / what was expected:** A real second copy is handed out. The
  only thing preventing it is a per-row spinner, which does not survive a
  reload, and there is no undo. Expected: a grant is idempotent, or reversible.
- **Why (from the code):** `grantCard` and `grantSecretCard` inserted without a
  uniqueness key on the grant itself.
- **Severity:** `medium`. Quietly inflates a collection in a game whose whole
  economy is scarcity.
- **Fixed — idempotent, which was the first of the two options the entry
  offered.** Every grant carries a key the screen generates once per intent and
  holds across a retry, and `admin_grants`
  (`supabase/migrations/20260901130000_idempotent_grants.sql`) records what each
  key did. A repeat replays that answer rather than dealing a second card, and a
  replayed secret grant does not re-announce a set it already completed.
  Deliberately handing somebody two copies is still two grants, with two keys.
  **A grant is still not reversible** — that was the "or", and nothing here
  builds an undo.
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
- **Fixed:** One RPC, `attach_device_to_player`
  (`supabase/migrations/20260901140000_attach_device_to_player.sql`), so the
  secrets, the packs, the milestone claims keyed off those packs, and the account
  repair either all happen or none does. The half where packs move and their
  claims do not is the one that pays a milestone twice, which is why the order
  inside it is commented.
  > Writing the database test for this surfaced a second defect the triage had
  > not: the account repair set `participant_id` while leaving `guest_id` in
  > place, which violates `account_identities_one_kind` — so that branch raised a
  > check violation and took the rest of the rescue down with it. The RPC clears
  > both in one statement.
- **Raised by:** [dust and ownership](admin/dust-and-ownership.md#open-questions-and-verification).

### B-41: "Record a split here" saves, reads back, and does nothing

- **Where the user meets it:** The commissioner turns a station's split
  recording off.
- **What happens / what was expected:** The switch saves faithfully and the
  timing console ignores it — it filters on whether the station is active and
  nothing else. Expected: the station is skipped.
- **Why (from the code):** `split_enabled` was written by the stations panel and
  read by nothing; `src/hooks/use-run-console.ts` filtered on `active` only.
- **Severity:** `medium`. A control that confirms and lies.
- **Fixed:** The console filters on both.
- **Raised by:** [stations](admin/stations.md#open-questions-and-verification).

### B-42: A retired secret card cannot be brought back

- **Where the user meets it:** The commissioner retires a secret card and then
  changes their mind.
- **What happens / what was expected:** The handler accepts the field that would
  restore it; the panel never sends it. There is no way back from the screen.
- **Why (from the code):** `updateSecretCard` in
  `src/lib/secret-cards.functions.ts` accepts `active`;
  `src/components/secret-cards-panel.tsx` never sent `active: true`.
- **Severity:** `medium`.
- **Fixed:** The card's edit sheet shows "Put it back in the set" where a live
  card shows "Remove from the set".
- **Raised by:** [secret card sets](admin/secret-card-sets.md#open-questions-and-verification).

## Low

### B-30: Accessibility gaps across the app

- **Where the user meets it:** Using the app with a screen reader, or with
  anything other than a thumb.
- **What happens:** A cluster of independent gaps, none fatal. All are fixed
  except the last, which is a product call:
  - The active navigation tab was conveyed by colour alone. No `aria-current` was
    set anywhere in `src/components/site-nav.tsx`, so the current page was not
    exposed programmatically. **Fixed** on both navs, and pinned by
    `e2e/smoke.spec.ts`, which is where the scripted pass first probed for it.
  - All thirteen share buttons on the leaderboard carried the identical label
    "Share result card". **Fixed** — each names its athlete.
  - The leaderboard's ranked list was an unordered list. **Fixed.**
  - The finish celebration overlay was not announced as a dialog and never took
    focus. **Fixed** — it is a labelled modal dialog and takes focus.
  - The reveal stand had no Next control: a swipe or an unannounced arrow key
    was the only way forward, and the one focusable alternative was styled at
    9px and 45% opacity and removed entirely on the secret's step. **Fixed** — a
    real Next button, kept quiet but in the tree, for a keyboard, a screen
    reader, or anybody whose swipe the browser claimed as a pan.
  - The card page's Pin, Sound and Tilt settings carried no pressed state, unlike
    the star on the same page's tiles — and on a phone they live inside menu
    items, which have none at all. **Fixed** — `aria-pressed` on the chips,
    `menuitemcheckbox` in the menu.
  - The off-screen share composite on a player's page was mounted for the whole
    visit with no `aria-hidden`, so its entire text duplicated the page in the
    accessibility tree. The pack summary's equivalent was hidden correctly.
    **Fixed**, and the leaderboard's export node with it.
  - There was no skip link anywhere, and no focus management across route
    changes. **Fixed** — a skip link first in the tab order, and `<main>` takes
    focus on every route change but the first.
  - The sound toggle existed on exactly one screen, behind an overflow menu on a
    phone — a screen away from the ceremony it silences. **Fixed** — it is on
    the pack screen too, beside the way back to the vault, which is the last
    moment before that ceremony starts.
  - Reduced motion gated audio and haptics as well as motion, so a still screen
    with audible feedback was not expressible. **Fixed** — it governs haptics,
    which really are motion; sound is the app's own mute switch, which already
    exists and is now reachable.
  - A share that could not be produced brought the button back with no message,
    so a screen reader user got no feedback at all. **Fixed** — the pack summary
    keeps its deliberate quiet about interrupting a ceremony, but says so in a
    polite live region; the leaderboard, which had no `catch` at all, reports it.
  - The pack's "Pack Complete" heading is deliberately false for about
    six-tenths of a second, and a screen reader announces it as fact. **Still
    open — `product call`.** The lie is the effect; making it honest costs the
    surprise, and whether that trade is worth it is not a defect question.
- **Severity:** `low` individually, and worth treating as one piece of work —
  which is how it was done.
- **Raised by:** [accessibility](cross-cutting/accessibility.md),
  [the leaderboard](combine/the-leaderboard.md#open-questions-and-verification),
  [opening a pack](cards/opening-a-pack.md#open-questions-and-verification),
  [sharing](cross-cutting/sharing.md#open-questions-and-verification).

### B-31: Small rendering and copy slips

All fixed.

- **The filmstrip computed a finish and threw it away.** The roster filmstrip
  built each entry with an edition and its component declared no such field, so
  every thumbnail rendered standard. No leak; it simply showed less than
  intended. The component declares it and passes it on now.
- **A hand-edited `?vs=` could name the current player**, giving a comparison of
  somebody against themselves with every row a tie. The picker filters self out;
  the URL did not. The page drops a `vs` equal to its own id — `validateSearch`
  cannot do this, because it never sees the path params.
- **The trade feed split on a separator that can occur inside a name.** A
  secret named "Salt + Pepper" rendered as two separately highlighted pieces.
  The parts are exported directly rather than recovered by splitting the joined
  label back apart.
- **A load-bearing comment pointed at a migration that does not exist.**
  `src/lib/trades.ts` cited `20260825140000_trade_feed_secret_names.sql`; the
  rule lives in `20260827130000_name_traded_secrets.sql`. Sharper than usual,
  because that naming has already been reverted once by a migration re-created
  from a stale copy, and this comment is the breadcrumb meant to prevent it.
- **A negative margin with no matching parent padding** on analytics, the recap
  and the TV board removed their side gutter entirely.
- **Three public routes were absent from the smoke test** that otherwise renders
  every one: analytics, the recap and the TV board. Analytics and the TV board
  are in the sweep now. The recap is covered by its own test instead, because
  its loader runs during the SSR render, where the browser-side stub cannot
  reach it — a direct visit is a genuine 404 against a dead Supabase, so the
  test walks to it from the archive the way a reader does.
- **`queued` versus `waiting`.** One cancel path wrote `queued`; every other
  reset writes `waiting`, which is the schema default and the word players see.
  Both behaved identically. Now there is one word.
- **A hidden commissioner-created set rendered as a raw identifier** in the
  admin card picker, because the label lookup fell back to the four seeded sets.
  It is given the real list, hidden sets included.
- **An unused import** on the player page.
  > A `--noUnusedLocals` pass found twenty-six more across the app, none of them
  > failing anything — `noUnusedLocals` is off in this project's tsconfig. Only
  > the one this entry named was removed; the rest are a tidy-up somebody should
  > decide on deliberately.
- **The bulk-upload oversize badge named the wrong cap.** It read "Over 12 MB"
  while the limit is 8.8 MB, so a 10 MB file was correctly rejected and then
  labelled with a number it is under. The badge reads the constant now.
- **Replacing a player's card art orphaned the old files.** The player-card
  upload never removed what it replaced, unlike the card-back and secret-art
  uploads, so storage kept every version ever uploaded — and the path carries a
  timestamp, so nothing overwrote anything either. It cleans up after the row
  points at the new files, in that order, for the reason `deleteEventCardBack`
  already states.
- **The stations panel trusted an empty splits list even when that read failed.**
  The bundle reports which tables it could not read; the panel did not consult
  it, so the delete guard was disarmed exactly when the data was missing rather
  than absent. It refuses instead of guessing.
- **The ownership audit's "Belongs to" select had no accessible name**, unlike
  every neighbouring dropdown.
- **Reordering two stations was two writes with no transaction**, so a
  half-completed swap left them sharing an order value. **Already fixed
  upstream** by the `swap_station_order` RPC in
  `supabase/migrations/20260831120000_swap_station_order.sql`.
- **A card back's station ladder included retired stations**, printing an empty
  row for a station nobody ever ran. A retired station whose splits exist still
  appears — the split is real and the card should say so — but one retired
  before anybody reached it does not.
- **The live feed subscribes to splits and penalties unfiltered**, while runs,
  participants and draft picks are filtered by event — so any event's splits fan
  out to every watcher. Invisible while one combine is active. **Documented
  rather than filtered:** unlike the other three, these two carry no `event_id`
  of their own — they hang off a run — so there is nothing to filter on. The
  asymmetry now reads as known rather than as an oversight.
- **Severity:** `low`.

### B-32: The compare picker dresses an unpacked card in its real tier

- The comparison picker colours every player's initials with their real tier
  accent, including players this device has never packed. The vault's sort, its
  locked styling and the filmstrip all go out of their way to dress an unpacked
  card neutrally. Tiers are public on the leaderboard, so this may well be
  intended.
- **Severity:** `low`. **Still open — `product call`.**
- **Raised by:** [comparing cards](cards/comparing-cards.md#open-questions-and-verification).

### B-33: Out of season, trading closes silently — including for secrets

- With no active event the spares list comes back wholly empty and both pickers
  read "No spares to trade" with no reason given — even though secret pulls are
  not event-scoped and a secret-for-secret swap would be accepted. Relatedly, the
  feed requires an event id while a trade's event may be null, so a trade settled
  out of season is recorded and then never appears in any feed.
- **Severity:** `low`. Plausibly intended, but stated nowhere.
- **Still open — `product call`.** Whether the league trades out of season is
  not something the code can answer. Two things would follow from a yes, and
  both are small: let the spares list serve secrets with no event, and let the
  feed accept a trade whose event is null.
- **Raised by:** [the trading post](trading/the-trading-post.md#open-questions-and-verification),
  [the trade feed](trading/the-trade-feed.md#open-questions-and-verification).

---

Fixes verified at commit `4d19995`, against `bun run lint`, `bun run typecheck`,
`bun run test`, `bun run test:db` and `bun run test:e2e`.
