# Will YOU Be My Hero? — Mobile UI/UX Audit

_Trading-card experience, audited phone-first. September 2026._

## How this audit was made

- **Code read**: every player-facing route and component under `src/routes/players*.tsx`, `src/components/`, `src/lib/`, the design tokens in `src/styles.css`, and the 51 behaviour documents in `product-description/` (verified at commit `b46f330`; 166 commits have landed since, and this audit reads the code as it stands today).
- **Real renders**: the app was run locally against the same server-function stubs the e2e suite uses (`e2e/fixtures.ts`), with a member who owns three roster cards, two secrets, a five-day streak with a reward to claim, one incoming trade offer and dust switched on. Every player-facing screen was screenshotted at **320, 375, 390 and 430 px** widths and measured for horizontal overflow, control sizes and font sizes. Card art was not available in the stub environment, so tiles render the app's initials placeholder; sizes and layout are unaffected.
- **Already-known defects** in `product-description/bug-triage.md` are not re-raised. Five product calls there remain open (B-07, B-23, B-32, B-33, B-38) and are referenced where they touch the experience.
- **Vocabulary**: what the brief calls "Common → Mythic" is the app's secret-card **level**; "series" is a secret **set**; roster cards carry an earned **tier** (champion, podium, stationKing, penaltyBox, dnf, base) and a per-copy **edition** (Platinum, Gold, Silver, Bronze, Standard). These six tier ids and the award ids are persisted and must never be renamed.
- **One rule of the product is respected throughout**: how many secret cards exist is deliberately withheld everywhere except a completed-set trophy. Recommendations never ask for "x of N".

Priority scale: **Critical** (blocks the emotional loop or usability on a phone) · **High** (materially weakens collecting, trading or readability) · **Medium** · **Low**.

---

## 1. Overall product experience

**Does this feel like a collectible card app?** Partly. The card itself and the pack opening feel like a premium collectible product. The rest of the app feels like a very well-engineered sports-broadcast dashboard that happens to contain cards.

**Strongest areas**

- **The pack opening** is the best thing in the product. A drag-to-tear wrapper that commits at 60% travel (`src/lib/pack.ts:152-159`), an eight-phase four-second ceremony where every phase has something moving (`src/lib/pack-ceremony.ts:74-86`), a one-card reveal stand with a face-down hold before the flip, a fake "Pack Complete" heading that glitches into "One More Card" for the secret (`src/lib/stand-phase.ts`), tier-scaled ambience, chimes, haptics and confetti, and a resume-where-you-were rule that never loses a card. This is genuinely suspenseful and premium.
- **The card as an object.** Per-tier foil _patterns_ (prismatic, refractor, scanline, hazard, matte, rosette in `src/styles.css:455-572`), an opaque prism ring that marks every secret and survives daylight, an inner metal hairline for editions, pinch-to-zoom to 4×, tap-to-flip with a half-second turn that overshoots, gyro tilt. `src/components/holo-card.tsx` is a serious piece of work.
- **Integrity of the collecting rules**: spares-only trading with reasons shown, best-finish-wins, set sizes withheld so tomorrow's pull stays a mystery, trophies minted atomically.

**Weakest areas**

- **The home screen (the Vault) does not answer "what should I do right now".** It answers "what do I own". There is no countdown to the next pack, no claimable-reward cue on home, no "new since yesterday", and a guest never sees the "secret waiting" ring at all (`secretWaiting` requires `claimed`, `src/lib/secret-cards.ts:580-582`).
- **The chrome competes with the cards.** Every page sits on `circuit-bg` (cyan bloom + circuit-trace SVG, `src/styles.css:156-167`), the base-tier card foil is the same electric cyan as the primary button, the nav underline, the badges and the wordmark. A base card and the UI are the same colour.
- **The label layer is tiny.** 210 uses of `text-[8px]`…`text-[11px]` across player-facing files, almost all uppercase with 0.2–0.35 em tracking. Tier names, finish names, "You give", set counts, trade captions and the "Reveal all" control are all 9–10 px. Outdoors, at arm's length, this is the single biggest readability problem.
- **Touch targets.** Roughly 40 distinct controls are under 44 px (section 18). The nav tabs and the Open Pack button are the notable exceptions.
- **Rarity is legible on the card, not on the shelf.** A Mythic and a Common secret tile differ by the colour of a 9 px caption. Roster tiles do not show how many copies you hold.
- **Trading** is functional but reads like a form: a wrapping row of 30 px name pills, two 84 px-tile strips, and a Send button with no summary and no confirmation.

**Cohesive or bolted on?** The daily loop (Vault → Pack → Trade) is cohesive and the visual language is consistent. The Board and League tabs are a second product (the once-a-year combine) sharing the same bar; Shop appears and disappears with a commissioner switch and reflows the nav. It feels like one team's work, but two products.

**Custom or generic?** Custom. The foils, the ceremony, the copywriting ("Nobody wants your cards. Yet.") are memorable. The generic parts are the surrounding layout: stock shadcn `Button size="sm"`, a stock 404 page, a light-themed SSR error page in a dark app, and utility-class typography everywhere.

---

## 2. Mobile-first design

**Measured on real renders** (stubbed data, Chromium, device scale 2×):

| Width | Horizontal overflow | Header height                         | Vault: first card visible above the fold? | Stand card width | Summary roster card width |
| ----- | ------------------- | ------------------------------------- | ----------------------------------------- | ---------------- | ------------------------- |
| 320   | none                | ≈ 90 px (wordmark wraps to two lines) | no — hero + shelf header fill the screen  | ≈ 185 px         | ≈ 80 px                   |
| 375   | none                | ≈ 48 px                               | top edge only                             | ≈ 265 px         | ≈ 95 px                   |
| 390   | none                | ≈ 48 px                               | top edge only                             | ≈ 315 px         | ≈ 100 px                  |
| 430   | none                | ≈ 48 px                               | yes                                       | 320 px (cap)     | ≈ 110 px                  |

No screen scrolls sideways; `html, body { overflow-x: hidden }` (`src/styles.css:121-125`) guarantees that, at the cost of hiding any overflow bug rather than surfacing it.

**What works**

- Bottom tab bar is thumb-sized (≈ 54 px + safe-area spacer, `src/components/site-nav.tsx:122-173`) and always present.
- Cards keep a 5:7 box before the art lands, so the grid never jumps (`src/components/holo-card.tsx:635`).
- The reveal stand sizes the card off viewport _height_ (`max-w-[min(320px,calc((100svh-19rem)*5/7))]`, `src/components/pack-stand.tsx:788`) so the name and dots stay on screen.
- `100dvh`-based page heights on the eleven card routes.

**Problems**

- **Wordmark wraps at 320 px.** The two-line header (`text-lg` display + `text-[9px]` eyebrow with 0.35 em tracking) breaks "TRADING CARDS" onto two lines and doubles the header height. **Medium.** Fix: `text-base` and `tracking-[0.12em]` below `sm`, or a single-line wordmark.
- **The hero eats the first screen.** At 390 × 844 the vault's header block (banner, eyebrow, title, dust chip, four status lines, streak flame, Open Pack, Offer pill, divider, Rearrange row, shelf header) occupies ≈ 640 px before the first card. At 320 × 568 no card is visible at all. The product's hero is the card; the page opens on text. **High.**
- **Cards get smallest at the payoff.** The pack summary lays the three roster cards in `grid-cols-3 max-w-sm gap-2` (`src/components/pack-summary.tsx:178`): ≈ 80 px wide at 320, ≈ 100 px at 390. The stand showed them at 315 px a moment earlier. **High.**
- **Desktop layout compressed onto mobile** in two places: the trade offer card's side-by-side "You give | ⇄ | You get" (`src/components/trade-offer-card.tsx:281-327`) gives each side ≈ 139 px at 390 and scrolls a second card sideways; the shop's two-column ladder table (`src/components/dust-shop.tsx:492`) is fine at 390 but tight at 320.
- **Sort chips wrap to two rows at 320** ("Name Order Pick / Rarity … Shuffle"), pushing the grid down further.
- **Important actions placed high**: Open Pack, Rearrange, sort chips, the player page's Flip/Share/Compare row and the trade counterparty picker all sit in the top third. The thumb zone (bottom third) holds only the nav.
- **No `safe-area-inset-top`** on the sticky header; on a notched phone in standalone/PWA mode the wordmark sits under the status bar.
- **Three different viewport formulas** (`calc(100dvh-8rem)` on 11 routes, `calc(100vh-4.5rem)` on live/analytics/recap, `100vh` on tv). The `vh` ones mis-size when Safari's toolbar collapses.
- **Modals**: the secret sheet is a centred `Dialog` at `w-[92vw]` with a 16 px close icon (`src/components/ui/dialog.tsx:47-50`); the compare and market-listing drawers are proper bottom sheets. Two modal idioms for the same kind of task.

**Mobile-native alternatives to adopt**

- Bottom sheets (vaul is already installed and used twice) for sort/filter, the trade partner picker and the card picker.
- A collapsing hero: counts as a single line, actions in a sticky bottom bar or a floating Open Pack pill once the hero scrolls away.
- Swipe between cards is already there on the player page; extend the same gesture to the vault via the secret-sheet pattern (see section 6).

---

## 3. Home screen

`/` redirects to `/players` (`src/routes/index.tsx:23`); the Vault is home. What it currently answers, top to bottom (`src/components/vault-hero.tsx:54-152`):

| Question                     | Answered?                                    | How                                                                                                                                                 |
| ---------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| What can I do right now?     | Weakly                                       | "Open Pack" is the biggest control; nothing says whether today's pack is still sealed, half-revealed or done.                                       |
| Do I have a pack available?  | Only via a secret-waiting ring, members only | `packWaiting` ring + dot on the button; a guest never sees it. No "resets in 3 h" although `resetsAt` is returned and never rendered.               |
| Can I claim a streak reward? | No                                           | Flame + "Day 5 — open today's pack to keep it alive." The claim button exists only on the pack summary (`src/components/pack-summary.tsx:306-357`). |
| Did I receive something new? | No                                           | No "new" state anywhere (`src/components/card-slab.tsx:104`).                                                                                       |
| Has someone sent me a trade? | Yes                                          | "Offer waiting" pill + Trade tab dot.                                                                                                               |
| What should I tap first?     | Open Pack, by size                           | But Rearrange, four sort chips and the star buttons are the next things the eye meets.                                                              |

**Competing actions.** Within one screen height at 390 px: Open Pack, Offer waiting, Claim your player (guest), Rearrange, Name/Order/Pick/Rarity/Shuffle, one star per card, one shelf toggle per shelf. Six kinds of control before the first card.

**Recommended hierarchy**

1. **Primary CTA: the pack, as a state, not a button.** A single "Today" card at the top: sealed → "Open today's pack"; torn but unfinished → "Finish your pack · 2 cards left"; done → "Next pack in 6 h" with the streak line. One component, three states, always the same height (no layout shift).
2. **Secondary: rewards.** When a rung is claimable, a second line in the same card: "Three Days is waiting — claim it". Never a nav dot (the product-description argues against one; agree), but home must say it.
3. **New since last visit.** A short horizontal strip of the cards pulled in the last pack or received by trade, dismissed when tapped or after 24 h. This is the "small celebration" the brief asks for, without permanent NEW badges.
4. **Trade offer pill** — keep, it is right.
5. **Collection summary** — one line: "3 of 4 roster · 3 secrets · 1 set complete" with a link to the shelves. Move packs-opened and printed-count to the profile.
6. Then the shelves, with Favourites and the last-pulled set first by default.

Move "Rearrange" and the sort chips into a bottom sheet behind one "Sort & filter" control on the Roster shelf header. **Priority: High** for 1–3; **Medium** for the rest.

---

## 4. Navigation

Current bar: **Vault · Pack · Trade · (Shop) · Board · League** (`src/lib/nav.ts:47-56`), plus a 32 px account icon in the header. Tap depth is good: every card feature is one tap; combine screens are two; TV is unreachable from inside the app by design.

**Problems**

- **Two products share five slots.** Board and League are the combine; they take 40% of the bar all year for a week of use. The brief's expected shape (Home · Collection · Packs · Trading · Profile) is closer to how the app is actually used the other 51 weeks.
- **The bar changes shape** (`grid-cols-5` ↔ `grid-cols-6`) when the commissioner flips dust (`src/components/site-nav.tsx:130`), acknowledged as a deliberate cost in `nav.ts:38-45`. On a phone the tabs move under the thumb and the label size drops.
- **Profile has no home.** Account, claim code, sound, tilt, sign out are spread across the header icon menu, the pack screen (sound), the player page overflow (tilt/pin/sound) and `/claim`.
- **Labels are `text-[10px]` uppercase with 0.15 em tracking**; "LEAGUE" and "BOARD" touch at 320 px with six columns.
- Neither `<nav>` carries an `aria-label`; the badge dots are aria-hidden with the text on the link (good).

**Recommendation** (Priority: High, Moderate effort)

- **Vault · Pack · Trade · League · You.** Fold Board into the League hub (it is already the first thing people want from the combine) and put Shop inside the Vault as a dust chip destination (the chip already links there) and as a League-hub tile while dust is on. The bar never reflows.
- **"You"** = profile: name, code, streak ladder and history, dust balance, sound/haptics/tilt, sign out, admin link.
- Keep the two dots (secret waiting on Pack, offer on Trade). Add a third state, not a dot: the Pack icon swaps to a torn-pack glyph while today's pack is mid-reveal.
- Labels 11 px, tracking 0.08 em, `min-h-14` tiles.
- Bottom sheets for sort/filter (Vault), partner and card pickers (Trade), and a contextual "…" on the player page instead of the 26 px overflow chip.

---

## 5. Collection experience

**Grid** (`src/routes/players.index.tsx:620`): `grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4`, inside `px-4` page padding and a shelf with `px-3`. Tile widths: ≈ 124 px at 320, ≈ 152 at 375, ≈ 159 at 390, ≈ 179 at 430. Two-up is the right default for a 5:7 card; the tiles are large enough to read art. Verdict: **card size is right; everything around it is not.**

**What works**: shelves as the organising idea (Favourites, Complete, one per set, Roster), tinted set panels, collapsible with a 44 px header, per-device layout memory, locked cards drawn as the event's universal back, image loading (lazy, stepped renditions, 5:7 reserved).

**Problems**

- **Under-tile metadata is 9 px.** Name at `text-sm`, then `text-[9px]` for tier/finish, then `text-[10px]` for "Packed by N" (`:565-600`). The tier line is the rarity signal and it is the smallest text on the page. **High.**
- **Roster duplicates are invisible.** Tiles show a tick or "Not packed yet"; "Pulled ×3" appears only on secrets and on the detail slab. The one number that makes a card _tradeable_ is missing where trading decisions start. **High.**
- **No finish on the tile frame at a glance** beyond the 2 px hairline; the `text-[9px]` caption carries it.
- **Sort is Roster-only** and colour-only for its active state; **no filters, no search, no owned/missing toggle, no "spares" view, no "recently pulled"**. With 13 roster cards this is tolerable; with 20+ secrets across four sets it is not.
- **Loading**: no skeleton. `useEventBundle().loading` is discarded (`:93`). The page paints chrome, then tiles pop from locked to owned once `mine.ready`.
- **Locked tiles decode the 1200 px universal back** with no `loading="lazy"` or `srcset` (`src/components/pack-card-back.tsx:36-53`).
- **Favourite star** (36 px) sits over the top-right of a tile that is itself a link; mis-taps navigate.
- **Trophy tiles** are `aspect-[3/4]` in a 5:7 grid — the one thing on the shelf that is not a card is drawn almost like one.

**Recommendations**

- Keep 2-up on phones. Add a density toggle (2-up / 3-up) in the sort sheet for people who want to scan.
- Tile caption: name 14 px; a single 11 px line "Gold · ×3 · Packed by 7" — finish first (it is yours), count second, league number last. Drop uppercase for the count.
- A small **×N pip** in the tile's bottom-right corner for any card with spares — the physical "stack" cue. Never on locked tiles.
- **Sort & filter bottom sheet** on the Roster shelf: sort (Name/Order/Pick/Rarity/Newest), filters (Owned / Missing / Spares / Finish ≥ Silver). On secret shelves: sort by level, filter Spares. Search only if the roster grows past ~20; otherwise omit.
- **Recently pulled** as a strip on home (section 3), not a shelf.
- **Skeleton tiles** (5:7 grey with a soft shimmer) until `mine.ready`, replacing the locked→owned pop.
- Serve the universal back at the `thumb` rendition with `loading="lazy"` on grid tiles.
- Move the star to a long-press or to the detail page; or make it 44 px and give the tile's link a 44 px inset so a star tap never navigates.

**Priority: High. Effort: Moderate** (the sheet is new; the rest is markup).

---

## 6. Card detail screen

Roster card: `/players/$id` (`src/routes/players.$id.tsx`). Secret: a centred dialog (`src/components/secret-card-sheet.tsx`), deliberately without a URL.

**What works**: the card is full-width (`max-w-sm`), pinch-zoom to 4×, double-tap 2.4×, tap flips with a proper card-stock turn, swipe steps through the roster, gyro tilt behind a permission tap, the "acrylic slab" with a serial plate, a locked state that shows the universal back and "Rip a pack to see this card", filmstrip of the whole set, an exported 1080×1350 share image.

**Problems**

- **The card is the top 45% of a stats page.** Below it: name, six action chips (three visible + overflow on phones), quote, four stat tiles, station bars, filmstrip, reactions, comments, pack stats, QR. The screen reads as "player profile" more than "examine a collectible".
- **Action chips are ≈ 27 px tall** (`px-2.5 py-1.5 text-[10px]`, `:948-952`); the phone overflow trigger is ≈ 26 px; zoom buttons 32 px; the back link has no padding. **High.**
- **Landing on an owned card replays its reveal cue.** The chime plays the first time each card is opened in a browser session (a module-scoped `revealed` set, `:78`, `:233-234`), and confetti fires only for champion/podium tiers or a Gold+ finish (`:239-240`). So the vault is not a machine gun, but every fresh session re-fires the chime card by card, and a good card re-fires confetti, which spends a little of the pack reveal's currency each time.
- **No trade entry point.** A card with spares should offer "Offer this card" (goes to Trade with it pre-staged) and a locked card should offer "Ask for a trade" (partner picker filtered to owners). Today trading starts from a blank form.
- **Provenance is thin**: "Pulled ×3" and "Packed by N". No "first pulled 28 Jul · Gold from a trade with Bob".
- **Secret sheet**: 16 px close target; card capped at 320 px inside a 92 vw dialog; no full-screen mode; the flip hint is 10 px.
- **Locked roster card page** still shows the tier badge ("DNF") and the running order, but hides the art — fine — yet the badge lets you learn the tier of a card you have not packed, which the vault's Rarity sort goes to lengths to hide (`LOCKED_RARITY_RANK`, `players.index.tsx:81-90`). Open product call B-32 is the same inconsistency.

**Recommendations**

- **Full-screen viewer as the default for a tap.** Tap a tile → the card fills the screen on a dark wash (the ceremony's "room"), name + tier/finish badge beneath, chevrons implicit via swipe, `44 px` close at bottom-left, "Flip" at bottom-centre, "…" at bottom-right (Share, Pin, Compare, Offer). Pull down to dismiss. The stats page becomes a second step ("Details") reached by swiping up or a chip.
- Reuse the reveal-stand's card sizing rule (`svh`-based) so the card is as big as the pack made it.
- Key the once-guard on acquisition, not on module lifetime: persist the seen set in the device store so the chime and confetti fire the first time a card is opened after it was acquired and not again on the next reload. Low priority; the current gate already limits it to once per session and to top tiers and finishes.
- Add **Offer this card** / **Ask for this card** chips wired into the trade builder.
- Provenance line on the slab plate: acquisition source and date (`card_copies.source` already exists: pull / trade / grant / craft).
- Secret sheet: same full-screen viewer, same controls, close button at 44 px; keep "no URL".

**Priority: High. Effort: Significant** (a new viewer component, but `ZoomPanFrame` + `HoloCard` already do the hard part).

---

## 7. Pack opening experience

**Verdict: exciting, suspenseful, smooth, premium.** The problems are at the edges, not the core.

**Sequence as built**: sealed wrapper (`max-w-[260px]`, `src/components/pack-wrapper.tsx:540`) → drag (or Enter) → ceremony 4.0 s with Skip → stand: face-down card, tap → 900 ms glowing hold → 500 ms flip + chime + haptic + burst → Next/swipe → last roster card gets a longer hold → "Pack Complete" 620 ms → glitch 520 ms → clear → empty beat → secret with 1600 ms hold and 1100 ms flip, blackout-flash-shake → summary.

**What works**: pacing, the twist, tier-specific ambience (`GLOW` in `src/lib/reveal-ambience.ts:19-31`), duplicate handling for secrets ("Already yours — this one's just showing off" plus a shimmer and a quieter chime), persistence, the guest getting a real fourth card, inline failure with retry and never a toast.

**Problems**

- **Rarity is revealed all at once.** The flip shows the tier bezel, the foil, the edition frame and the badge in the same 500 ms. There is no pre-tell for a good pull beyond glow strength, and no beat between "it's Bob" and "…in Gold". **Medium** (the fix is cheap and lifts the best moment).
- **Roster duplicates get no treatment.** Only secrets say "already yours". A third Bob flips identically to a first Bob, and nothing marks a first-ever pull as NEW. **High.**
- **Controls**: "Reveal all" is a `text-[9px] text-muted-foreground/45` ghost (≈ 25 px) and hidden on the secret step; Skip ≈ 27 px; Next `min-h-9`; the sound toggle is a bare 16 px icon that disappears once the pack is torn, so there is no way to mute mid-reveal. **High.**
- **Summary shrinks the cards** to ≈ 100 px (section 2) and lists tier/finish in 9 px; the secret is larger but the three roster cards read as thumbnails.
- **The 6 s pending secret** is a pulsing rectangle with "Checking the wrapper…"; on a garden network this is the likeliest bad moment. The wait has no progress feel.
- **Guest at the payoff** meets "Sign in to claim" on the streak block; a first-timer's best moment ends in a gate.
- Live feed banner ("Live feed down — refreshing every few seconds") can sit above the pack when realtime is degraded — noise on the one screen that should be silent.

**Recommendations**

- **Two-beat reveal for special pulls**: flip to a _dimmed_ face for 250 ms, then bloom the edition frame + shine + second chime. Only for Silver+ finishes, champion/podium tiers and Rare+ secrets, so common pulls stay fast. (`playEditionShine` already exists as a second cue, `players.pack.tsx:566-569`.)
- **NEW / ×N ribbons** on the stand and the summary: for roster cards, "NEW" when the pre-pack baseline count is 0 and "×3" otherwise; for the secret, from the pull result's own `duplicate` flag (the baseline holds no secrets). Sell-hint on dupes when dust is on (already there for secrets).
- **Summary reflow**: roster cards in a single horizontal snap row at ≥ 140 px each, the secret full-width above them, streak block below, Share as the primary exit next to View collection. Keep the collected counter.
- **Controls**: Skip and Reveal all at 44 px, 11 px text, 60% opacity; keep Reveal all hidden on the secret step (that call is right). Mute in the same place throughout (bottom-left, 44 px), including on the stand.
- **Pending secret**: replace the pulse with a wrapped card that "loads" a foil sweep every second and a line that changes at 2 s ("Still sealed…") and 4 s ("Slow signal — it's yours either way").
- Hide the degraded-feed banner while presenting (tiers can change live, but the pack is not the place to say so).

**Priority: High for dupes/NEW and controls; Medium for reveal pacing. Effort: Easy–Moderate.**

---

## 8. Rarity system

Three axes, each with its own visual language (`src/lib/card-rarity.ts:91-170`, `src/lib/card-edition.ts`, `src/lib/secret-rarity.ts`):

| Axis               | Colour                                            | Frame                                | Texture                 | Label                               | Motion                                   | Icon                   |
| ------------------ | ------------------------------------------------- | ------------------------------------ | ----------------------- | ----------------------------------- | ---------------------------------------- | ---------------------- |
| Tier (earned)      | gold, gold-warm, violet, cyan, amber, slate       | outer bezel                          | 6 foil patterns         | word + reason                       | idle sheen hero-only for champion/podium | none                   |
| Edition (per copy) | platinum, gold, silver, bronze; standard has none | 2 px inner hairline                  | —                       | word, chip; standard prints nothing | platinum sheen hero-only                 | Sparkles on the ribbon |
| Secret level       | accent colour only                                | prism ring marks _secret_, not level | 22 admin foils per card | "Mythic · 0.5% pull"                | ring spin/pulse/shimmer per card         | none                   |

**What works**: colour is never the only cue on a card (pattern + text), the prism ring is an unmistakable "this is a secret" from three feet, editions are a separate metal so a gold finish on a podium card never reads "Gold · Gold".

**Problems**

- **Level (Common→Mythic) is the weakest axis and the one the brief cares most about.** On a tile it is a 9 px coloured caption. On the stand it is the same caption. The ring says "secret", not "mythic". Two cards from the same set at different levels look identical until you read the caption.
- **Base tier border is `oklch(1 0 0 / 12%)`** — invisible — and the base foil is the UI's own cyan. Base cards look like UI; the UI looks like a base card.
- **Standard edition prints nothing.** Correct on the card, but on a tile in the trade picker it means 70% of copies carry no finish word at all, so the ones that do stand out only as more 9 px text.
- **No consistent rank glyph.** The brief asks for rarity to be "immediately understandable". Words in five colours are not immediate.

**Recommended visual language** (no persisted ids change; this is presentation only)

- **Level pips**: one to five small diamonds under the secret's name, filled in the level colour, on tiles, the stand, the summary and trade tiles. Mythic gets five plus the ring's shimmer forced on at hero size. Pips are readable at 9 px height where a word is not, and they are shape, not colour.
- **Edition metals as a corner tab** on tiles: a small 45° tab in the frame's metal (bronze/silver/gold/platinum), nothing for standard. Same idea as a physical parallel's stamp.
- **Tier keeps the bezel + pattern + word**, unchanged, but the **base tier's border rises to 24% white** and its foil hue shifts ~20° off the primary (teal-green) so UI cyan and base cards separate.
- **One scale of glow**: tile glow only for champion/podium tiers, Gold+ editions and Legendary+ levels; everything else flat. Today every owned tile glows in its tier colour, so nothing is special.
- Label floor 11 px for every tier/edition/level word.

**Priority: High. Effort: Moderate.**

---

## 9. Secret cards

**As built**: only owned secrets exist on screen; one shelf per set, tinted; count without denominator; sheet with level, odds, first-pulled date, "Pulled ×N", "Packed by N people"; dupes shimmer once; a set you finish gets a gold full-screen ceremony that counts up to the size; a "Complete" shelf with plaques; trophy pills on player pages.

**Do they feel special enough?** The pull does. The shelf does not. A secret tile is the same 2-up card with a ring; the set panel is a tint; the level is a caption.

**States and how to differentiate them without leaking the catalogue**

| State                               | Today                      | Recommendation                                                                                                                                                                                                                                                              |
| ----------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unknown (never pulled, set unknown) | nothing                    | Keep nothing. No silhouettes, no counts.                                                                                                                                                                                                                                    |
| Discovered set, cards unknown       | shelf with your cards only | Add **one** unnamed mystery slot at the end of each _open_ set shelf: a face-down secret back with "?" and the caption "More in this set". It never counts, never says how many, and disappears when the set completes. It gives the shelf a horizon without a denominator. |
| Owned                               | tile + caption             | Level pips (section 8), foil, ring; the set's colour on the tile frame edge.                                                                                                                                                                                                |
| Missing from a completed set        | n/a                        | n/a — completion is the only time the size is known; the plaque already says it.                                                                                                                                                                                            |
| Duplicate                           | "Pulled ×2" in 9 px        | ×N pip; sell/trade hint on the sheet when dust/trading is on.                                                                                                                                                                                                               |
| Today's pull                        | none                       | "Today" ribbon for 24 h (also explains why it cannot be traded yet — `todays-pull`).                                                                                                                                                                                        |

Also: the daily secret should be _previewed as a sealed thing_ on home ("A secret is waiting" is a ring on a button today), and the Pack tab dot is the secret's colour — keep that, it is the one place the secret announces itself.

**Priority: Medium. Effort: Easy** (the mystery slot is a static tile; pips are CSS).

---

## 10. Trading Post

`/players/trade` (`src/routes/players.trade.tsx`) is one scrolling page: header + rules paragraph → "Waiting on you" carousel → "Out there" → "Make an offer" (partner pills → two card strips → Send) → receipts → league feed.

**What works and must be kept**: spares-only with the reason shown in a greyed "Can't be traded" row (`:755-771`); one tile per _copy_ so a Gold Bob and a Standard Bob are separately tradeable; unowned counterparty art face-down with "not yours yet"; "⚠ last copy" marker on a secret; 4-per-side cap with a toast; the one-line "1 card for 2 cards" summary above the tiles; Accept is atomic and refuses stale offers cleanly; the nudge + tab dot + hero pill.

**Measured at 390 px**: Accept/Decline 38 px tall, partner pills 33 px, Send 34 px, picker tiles 84 px wide with names clipped ("GARY THE…", "BOB BLIT"), 37 text nodes at 9 px on the compose screen.

**Can a user tell You Give from You Receive?** On the _offer card_: yes, both labels are present and the arrows between them help, but the two sides are 139 px wide at 390 and a second card on either side scrolls sideways out of view. In the _builder_: the labels are "You give (1/4)" and "Bob Blitz gives (1/4)" in 9 px, above two strips that look identical, and the blocked row appears under each. A person scanning sees four rows of the same cards.

**Problems**

1. **The builder is below the fold whenever an offer exists**, because the inbox and outbox come first. Starting a trade means scrolling past everything you have not answered. **High.**
2. **Partner picker is a wrapping pill row** with no `aria-pressed`, ≈ 33 px tall, no avatar, no hint of what they have that you want. With 12 possible partners it is two rows of identical pills. **Medium.**
3. **84 px tiles in a horizontal strip** with no snap, no edge fade and no "3 more" count. Names truncate; the finish and level are 9 px captions; selection is a ring. Selecting is not "picking a card", it is "hitting a chip". **High.**
4. **No tray and no summary.** After staging, nothing shows the deal in one place. Send reads only "Send offer". **High.**
5. **No confirmation** on Send, Accept, Decline or Take it back, and no undo. Accept moves two people's cards. **High.**
6. Colour-only state: the pending ring on an offer, the selected partner pill (plus a 4 px green dot). No focus-visible on any trade control; `hover:text-danger` on Decline references a token that does not exist (`:373`). **Medium.**
7. Empty inbox is one 12 px sentence with no way forward; outbox/receipts/feed sections vanish entirely when empty.
8. Carousel dots are decorative spans (`:638-648`); there is no way to jump to the third offer except swiping.
9. Open product call B-33: out of season the strips read "No spares to trade" with no reason, even though secrets could be swapped.

**Recommended layout** (Priority: High, Effort: Significant — but the data layer needs no change)

- **Trade home** = two tabs at the top of the screen: **Offers** (inbox, then outbox, then receipts) and **Feed**. A sticky **"Make an offer"** button at the bottom, above the tab bar, always visible.
- **Full-screen trade builder**, three steps in one sheet stack:
  1. **Who** — a list, not pills: avatar/initials, name, and one line "has 3 spares · wants 2 of yours" (from `getTradeSpares` today; wishlists later per the roadmap). 56 px rows.
  2. **You give / You get** — a stacked layout at phone widths: the **You give tray** (your staged cards, 2-up, 44 px remove targets) with a "+ Add your cards" button opening a bottom-sheet picker (3-up grid of full cards with the ×N pip, edition tab and level pips, tap-to-toggle, blocked cards greyed with the reason). Then the **You get tray** with "+ Ask for their cards", same sheet on their spares. Counts "1 / 4" at 12 px on each tray header.
  3. **Review** — the two trays side by side as small cards, the one-line summary in 16 px ("Your Gold Bob for their Epic Gary"), a "last copy" warning if any, and **Send offer** at 48 px. Sending returns to Offers with the new card highlighted.
- **Answering**: the offer card keeps the summary line but stacks You give above You get on phones, each a horizontal snap row at ≥ 110 px per card. Accept (48 px, primary) and Decline (48 px, quiet). Accept opens a one-line confirm sheet: "Swap your Standard Alice for Bob's Gold Bob?" — Confirm / Cancel. Decline needs no confirm. "Take it back" needs none either.
- Status as a chip with text at every state, including Pending. Carousel dots become a "1 of 3" label plus swipe.
- Empty inbox: "Nobody wants your cards. Yet." plus a "Make an offer" button and a hint of who is reachable.

---

## 11. Streak rewards

**As built**: flame + number on the vault and pack headers (`src/components/streak-flame.tsx`), a sentence ("Day 5 — open today's pack to keep it alive."), rungs 3/7/14/30/100 paying a bonus secret with rising floors (`src/lib/streaks.ts:56-92`), a claim block on the pack summary only, a milestone reveal ceremony, "Day 7 pays Rare or better." shown only on the summary and only when nothing is claimable, hidden entirely at zero.

**What works**: the flame pulses only when today's pack is in the run; the at-risk sentence is exactly right; rewards are cards revealed with ceremony; the highest rung is claimed first; refusals are inline, never toasts; nothing shown at zero.

**Problems**

- **The ladder is invisible.** A user never sees 3 · 7 · 14 · 30 · 100 as a shape. They learn about a rung when they land on it.
- **Claimable state is not on home.** A reward earned yesterday and not claimed sits behind Pack → summary.
- **Next-rung promise** appears in one place, after the pack, and never on the vault.
- **Missed-day consequence** is implied by the sentence; there is no visual difference between "alive" and "at risk" beyond the words and a non-pulsing flame.
- **No history** — nothing lists what the last 30 days paid.
- **Guests build streaks but need an _account_ to claim**; the gate lands at the payoff ("Sign in to claim") with a full account sign-up. The reward is the best moment to ask, but the ask is heavy.
- The milestone reveal dialog lacks `aria-modal` and a focus trap (`src/components/milestone-reveal.tsx:120-126`); the bought-pull reveal has both.

**Recommendations** (Priority: Medium, Effort: Easy–Moderate)

- **Streak strip** in the home "Today" card: flame + "Day 5", then five small rung markers `3 · 7 · 14 · 30 · 100` with passed rungs filled, the next rung labelled "Day 7 · Rare+". One line, 44 px tall, no progress bar.
- **At-risk styling**: the flame turns amber-outline with "Keep it alive — open today's pack" when `openedToday` is false and the run is still alive; grey with "Streak ended at 12 days" for one day after a break (data is already computed by `walkStreak`).
- **Claim from home**: when a rung is claimable, the strip becomes a button "Claim Three Days" that opens the same `MilestoneReveal`.
- **History** lives in the profile tab: last rungs claimed, with the card each paid (a small row of the secrets, level pips visible).
- Keep the milestone claim on the pack summary too — it is where the streak was extended.
- Fix the dialog semantics to match `BoughtPullReveal`.

---

## 12. New card discovery

**As built**: no "new" state, by design (`src/components/card-slab.tsx:104`: looking at a card no longer collects it, so there is nothing to mark). The tick + "Not packed yet" split is the only newness cue. Roster duplicates in a pack look like first pulls. The collected counter appears only on the summary. Set completion gets a full ceremony.

**Recommendations** (Priority: High. Effort: Easy for the ribbons; Moderate for the strip, which needs one new read-only server function)

- **"NEW" ribbon on the reveal stand and summary**, with two predicates because the data lives in two places. Roster cards: the pre-pack baseline the pack already snapshots (`packBaseline`, `src/routes/players.pack.tsx:171`, keyed by `event_participants.id`) — `held === 0` is NEW, `held > 0` is **"×N"** with N from the baseline plus one. The secret: `packBaseline` holds no secrets, so use the pull result's `duplicate` flag (`SecretPullResult`, `src/lib/secret-cards.ts:100-108`) — `false` is NEW, `true` is ×N with N from `getMySecrets` `count`. Dust sell-hint on dupes when dust is on. These are per-pack, on the pack screens only.
- **"New since last visit" strip on home**: cards acquired (pull, trade, grant, bought) since the last time the vault was opened. A device-stored last-visit timestamp is only half of it: today's client responses carry aggregates only (`MyCardStats.cards` has a count, best edition and first-pull date; `OwnedSecret` the same), so a second copy that arrived by trade, grant or purchase has no timestamp or source to place it. Back the strip with a small member-scoped server function that returns recent acquisitions — `card_copies` rows (`source`, `acquired_on`) and recent `secret_card_pulls` — filtered by the timestamp the device sends. Tapping a card opens the viewer and clears it; the strip disappears after 24 h. No permanent badges on shelves.
- **First-time-set moment**: the first card from a set you have never held gets one extra line on the stand ("A new set — Pets") and the shelf arrives open (already true) with a one-time soft glow on its header.
- **Completion** already has the biggest ceremony in the app; keep it, and add the plaque to the "new since last visit" strip so it is reachable after the ceremony is dismissed.

---

## 13. Collection completion

**As built**: "N of M cards printed · K collected" in the vault hero (roster only), "N packs opened", "N secrets pulled" (no denominator), per-set counts without denominators, a Complete shelf with plaques ("Pets · 9 cards · date"), trophy pills on player pages, a `Collected N / M` tile on the pack summary and on your own card's pack-stats block.

**Should progress be global, per set, or both?** Roster: both (13 cards, public). Secrets: per set, and only _after_ completion — the withheld total is the product's mystery mechanic and the audit agrees with it.

**Problems**

- "Printed" is an admin concept ("cards that have art") and reads as a collector number; with no art it reads "0 of 4 cards printed" next to "3 collected".
- The roster percentage is never shown as a shape; it is a sentence.
- Secrets progress is a count with no context: "3 secrets pulled" says nothing about how many sets you have touched.

**Recommendations** (Priority: Medium, Effort: Easy)

- Home summary line: **"Roster 3 / 13 · Secrets 3 across 2 sets · 1 set complete"**. A thin 2 px ring around the Vault tab icon or the roster shelf header showing roster completion is enough; no bars for secrets.
- Roster shelf header: "Roster · 3 / 13" with the count in 12 px instead of a bare "4".
- Set shelf header: "Pets · 2 held" (words, not a bare number), plus the mystery slot from section 9.
- Complete shelf: keep, and move it _above_ the set shelves by default (it is the trophy case).
- Profile: a small "Collection" block repeating these numbers with the trophies.
- Drop "printed" from the player-facing hero; keep it in admin.

---

## 14. Card series (secret sets)

**As built**: sets are shelves — named, coloured, ordered by the commissioner, appearing only when you hold something from them, with the unsorted pile last as "Secrets". A card belongs to exactly one shelf and moves to Favourites if pinned. The sheet swipes through open shelves in on-screen order. Trophies name the set and, once complete, its size.

**Can users tell which set a card belongs to?** On the shelf, yes (the tinted panel). In the sheet, the trade strips, the shop and the summary: no — the set name is not printed on the card or its caption anywhere but the shelf header.

**Recommendations** (Priority: Medium, Effort: Easy)

- Sets should behave like **binder pages**: keep shelves, add a **set name chip** on the secret's caption and in the sheet ("Pets"), coloured with the set accent, so a card carries its set with it into trade and shop contexts.
- One mystery slot per open set (section 9) makes each page feel like a page with a horizon.
- **Set tabs** are not needed at four sets; a filter chip row in the sort sheet ("All · Pets · WAGs · Cornhole · Unsorted") covers it if sets grow.
- Completed sets: the plaque should _link_ to the set shelf (it does — `openShelf` scrolls and flashes; keep) and the set shelf header should carry a small medal once complete.
- Never print "x of N" on an incomplete set; never render an empty set.

---

## 15. Visual design

**As built** (`src/styles.css`): dark-only, `--background oklch(0.14 0.02 240)`, cards `0.19`, primary electric cyan `oklch(0.82 0.14 210)`, accent teal, amber warn, green success; `circuit-bg` on every route (radial cyan bloom + a repeating circuit-trace SVG); `hud-bezel` radial gradients on panels; `neon-btn` pill with a two-layer cyan glow; `--glow-primary` on the nav underline, badges, selected pills and offer cards. Header comment still says "electric green accent" (stale).

**Does the interface complement the artwork?** The card treatment does; the room around it does not. Everything glows: the Open Pack button, the offer card, the active tab, the selected partner, the secret set panel when open, every owned tile in its tier colour, the dust chip. With card art present, the page becomes a competition between cyan UI glow and coloured foil glow. The base tier's foil _is_ the UI colour, so a base card and a button are the same object visually.

**Recommendations** (Priority: High, Effort: Moderate — mostly token changes)

- **Quieter ground**: keep the near-black blue, drop `circuit-bg` from the card screens (Vault, Pack stand, player page, Trade, Shop). Keep it for League/Board/TV where "broadcast HUD" is the right register. Card screens get a flat `oklch(0.13 0.015 240)` with a single soft vignette at the top.
- **One accent, used sparingly**: cyan stays the interactive colour (links, primary button, active tab) but loses its glow everywhere except the primary CTA. Selection = 2 px ring, no bloom. Offer status = a chip, not a glowing border.
- **Tile glow by rank only** (section 8). Owned base tiles: no glow, 24% white border.
- **Shift base foil hue** off the UI primary (e.g. `oklch(0.8 0.12 185)`) so cards never read as UI.
- **Panels**: one surface token `oklch(0.17 0.02 240)` with a 1 px `oklch(1 0 0 / 8%)` border; reserve `hud-bezel` gradients for the pack wrapper, the slab and the trophy plaque — the three objects meant to feel physical.
- **Radius**: cards 12 px (already), panels 12 px, chips 999 px, buttons 999 px for primary and 10 px for secondary — today `rounded-md/lg/xl/2xl/full` all appear within one screen.
- Theme the 404/error boundary (`src/routes/__root.tsx:22-80`) and the SSR error page (`src/lib/error-page.ts`, currently white) to the dark system.

The register to aim for: a dark binder page under a desk lamp. The cards are lit; the binder is not.

---

## 16. Typography

**As built**: display = Barlow Condensed 600–900 (`--font-display`), numerals = JetBrains Mono, body = the system sans (Tailwind default). Inter is requested from Google Fonts in four weights (`src/routes/__root.tsx:120`) and **never applied** — there is no `--font-sans` override anywhere.

Measured on real renders at 390 px (share of visible text nodes under 11 px):

| Screen         | < 11 px  | Most common sizes             |
| -------------- | -------- | ----------------------------- |
| Vault (member) | 28 / 62  | 9 px ×20, 12 px ×8, 14 px ×10 |
| Pack summary   | 54 / 107 | 8 px ×24, 9 px ×12, 7 px ×9   |
| Player page    | 46 / 97  | 10 px ×18, 9 px ×12, 8 px ×9  |
| Trade builder  | 43 / 117 | 9 px ×37, 11 px ×16           |
| Shop           | 1 / 74   | 12 px ×61                     |

The Shop, built from stock shadcn components, is the most readable screen in the app. The card screens, built by hand, run their labels at 8–10 px uppercase with 0.2–0.35 em tracking on a dark ground. On a phone outdoors this is the first thing to fix.

**Recommended scale** (rem, phone; two display sizes, one body family, one utility)

| Role                                | Face                                  | Size / line | Weight | Case                     |
| ----------------------------------- | ------------------------------------- | ----------- | ------ | ------------------------ |
| Page title                          | Barlow Condensed                      | 30 / 32     | 900    | upper, 0.02 em           |
| Section heading                     | Barlow Condensed                      | 18 / 22     | 800    | upper, 0.06 em           |
| Card name (tile)                    | Barlow Condensed                      | 15 / 18     | 800    | upper, 0.02 em           |
| Card name (viewer/stand)            | Barlow Condensed                      | 22 / 24     | 900    | upper                    |
| Body                                | system sans (or actually apply Inter) | 15 / 22     | 400    | sentence                 |
| Label / eyebrow                     | body face                             | 12 / 16     | 700    | upper, 0.08 em           |
| Metadata (finish, count, packed-by) | body face                             | 12 / 16     | 600    | sentence, tabular digits |
| Rarity word on a badge              | Barlow Condensed                      | 13 / 16     | 800    | upper, 0.06 em           |
| Nav label                           | body face                             | 11 / 14     | 700    | upper, 0.06 em           |
| Button                              | Barlow Condensed                      | 15 / 20     | 800    | upper, 0.08 em           |
| Numerals (times, counts)            | JetBrains Mono                        | as context  | 700    | tabular                  |

Rules: nothing under 11 px; tracking never above 0.1 em below 14 px; uppercase only for display, labels and buttons; body and metadata in sentence case. Decide on Inter (set `--font-sans` and keep the request) or remove the request; today it is a 4-weight download for nothing.

---

## 17. Spacing and layout

**As built**: page shells `mx-auto max-w-{3xl|4xl|6xl} px-4 py-6`; sections `mb-6`/`mb-7`/`space-y-6`; shelf `px-3 pb-3`; grid `gap-4`; header `py-2.5` (≈ 48 px, 90 px at 320 when the wordmark wraps); bottom nav ≈ 54 px + safe area; `main` reserves `5rem` for it.

**Wasted vertical space** (measured at 390 × 844):

- Vault: ≈ 640 px above the first card (banner, eyebrow, title + chip, four status lines, flame, Open Pack, Offer pill, divider, Rearrange row, shelf header with sort chips).
- Trading Post: ≈ 470 px of header, rules paragraph and banner before the first offer.
- Player page: 2 115 px total; the card ends at ≈ 900 px and the remaining 1 200 px is stats, filmstrip, social and a 140 px QR code.
- Pack summary: the streak block, collected tile and two buttons add ≈ 330 px under the cards; the secret sits in a 240 px column with empty space either side.

**Recommended system** (4 pt base, 8 pt rhythm)

| Token         | Value               | Use                                                  |
| ------------- | ------------------- | ---------------------------------------------------- |
| page-x        | 16 px               | all phone routes (already `px-4`)                    |
| page-y        | 16 px               | top; 24 px was the old `py-6`                        |
| section-gap   | 24 px               | between shelves / sections                           |
| stack-gap     | 8 px                | between lines inside a block                         |
| grid-gap      | 12 px               | card grid on phones (from 16) — buys ≈ 4 px per tile |
| shelf-inset   | 12 px               | inside a shelf                                       |
| control-gap   | 8 px                | between chips/buttons                                |
| header        | 48 px + safe-top    | single-line wordmark                                 |
| tab bar       | 56 px + safe-bottom |                                                      |
| modal padding | 16 px               | sheets and dialogs                                   |

Collapse the hero to one row on scroll; move sort/rearrange into a sheet; put the rules paragraph on the Trading Post behind an "i" affordance after the first visit.

---

## 18. Buttons and touch targets

Measured on real renders at 390 px (CSS px, height × width where relevant). Target: 44 px minimum, 48 px for primary actions.

| Control                                         | Location                              | Measured                    | Priority |
| ----------------------------------------------- | ------------------------------------- | --------------------------- | -------- |
| Sound on/off                                    | pack header (`players.pack.tsx:1242`) | **16 × 16**                 | Critical |
| Dialog close (secret sheet)                     | `ui/dialog.tsx:47`                    | **16 × 16**                 | Critical |
| "← Vault" / "← The Vault" back links            | pack, player, trade                   | **15–16 tall**, no padding  | High     |
| "Claim your player"                             | vault hero                            | **15 tall**                 | High     |
| Sort chips Name/Order/Pick/Rarity, Shuffle      | vault                                 | **23 tall**                 | High     |
| "Reveal all"                                    | stand                                 | **22 tall**, 45% opacity    | High     |
| Skip                                            | ceremony                              | ≈ 27 tall                   | High     |
| Flip/Stats, Share, Compare chips                | player page                           | **29 tall**                 | High     |
| "More actions" overflow                         | player page (phone only)              | **28 × 36**                 | High     |
| Zoom −/+, prev/next                             | player page, secret sheet             | **32 × 32**                 | Medium   |
| Reaction chips                                  | player page                           | 34 tall                     | Medium   |
| Post comment                                    | player page                           | 34 × 34                     | Medium   |
| Partner pills                                   | trade builder                         | 33 tall                     | High     |
| Accept / Decline                                | trade inbox                           | 38 tall                     | Medium   |
| Send offer                                      | trade builder                         | 34 tall                     | High     |
| Claim Three Days / View collection / Share pack | pack summary                          | 34 tall                     | High     |
| Rip a pack to see this card                     | locked card                           | 34 tall                     | Medium   |
| Burn / Sell / Re-roll                           | shop                                  | 32 tall                     | Medium   |
| List a card / Buy for 150                       | shop                                  | 36 tall                     | Low      |
| Favourite star                                  | tiles                                 | 36 × 36, overlapping a link | Medium   |
| Rearrange                                       | vault                                 | 36 tall                     | Low      |
| Next                                            | stand                                 | 36 tall                     | Medium   |
| Move shelf up/down                              | rearrange mode                        | 44 × **28**                 | Low      |
| Account / Sign-in icon                          | header                                | **20 × 32**                 | Medium   |
| Leaderboard share icons                         | board                                 | 36 × 36                     | Low      |

Passing: bottom tabs, Open Pack (46 px), shelf headers (`min-h-11`), dust chip (`min-h-11`), the pack and the stand card, roster filmstrip thumbs (64 × 89).

**Ambiguous or too close**: the star over a tile link; the four zoom/nav buttons at 32 px with 6 px gaps; sort chips at 23 px in a row of five; the partner pills wrap into two rows with 6 px gaps; Accept and Decline are visually equal weight (Decline should be quiet).

**Fix pattern**: a `min-h-11` (44 px) floor on every chip, pill and link that acts; a `neon-btn` size API (`sm` 44, `md` 48, `lg` 56) replacing the `!px/!py` overrides; icon-only buttons at 44 × 44 with the glyph centred; secondary actions visibly secondary.

---

## 19. States and feedback

| State                             | As built                                                                                                                                              | Recommendation                                                                                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading (vault, player, pack)     | bare "Loading…" text; locked→owned pop once `mine.ready`; no `<Skeleton>` anywhere (the component exists but is only imported by unused sidebar code) | 5:7 skeleton tiles with a slow shimmer; a skeleton hero row; `FeedLoading` only for combine screens                                                                   |
| Pack opening                      | excellent; ceremony + stand                                                                                                                           | keep; add a mute control on the stand                                                                                                                                 |
| Card image loading                | stepped renditions, lazy grid, 5:7 reserved                                                                                                           | keep; add `loading="lazy"` + thumb rendition to the universal back                                                                                                    |
| Trade processing                  | buttons dim; single `pending` id; no spinner, no `aria-busy`                                                                                          | button label "Sending…" + `aria-busy`; disable only that offer                                                                                                        |
| Successful trade                  | toast "Trade done" + confetti; ceremony if a set completes                                                                                            | keep; add the received card to the "new since last visit" strip                                                                                                       |
| Failed trade                      | toast with the server sentence; staged cards kept                                                                                                     | keep; show the sentence inline under Send as well (toasts are top-centre, far from the thumb)                                                                         |
| Streak claim                      | inline button states, never a toast                                                                                                                   | keep                                                                                                                                                                  |
| Pack unavailable / already opened | resume to the card you were on; summary if done                                                                                                       | add "Next pack in 6 h" to the summary and home                                                                                                                        |
| Empty collection                  | all tiles face-down, "Not packed yet"                                                                                                                 | keep; add one line under the hero: "Open your first pack to turn a card over"                                                                                         |
| Empty trade inbox                 | "Nobody wants your cards. Yet."                                                                                                                       | keep the line; add the Make an offer button beneath it                                                                                                                |
| Offline                           | nothing; `navigator.onLine` unused; PWA manifest present                                                                                              | a slim bottom banner "You're offline — the vault still works, packs record when you're back", and disabled spend/trade buttons with that reason                       |
| Error                             | `FeedError` card on combine screens; unthemed 404; white SSR error page                                                                               | theme both; keep FeedError                                                                                                                                            |
| Degraded realtime                 | amber banner on every screen                                                                                                                          | hide it on the Pack and viewer; on other screens show it once per session as a toast, then a small dot on the League tab                                              |
| Toasts                            | Sonner, `top-center`, outside PresentationMode                                                                                                        | `bottom-center`, offset above the tab bar, suppressed while presenting                                                                                                |
| Undo                              | none anywhere                                                                                                                                         | offer a 5 s "Undo" toast on Decline and Take it back (they move nothing, so a reversal is cheap server-side); none on Accept (atomic), Mill or Sell (confirm instead) |
| Confirmations                     | `window.confirm` on selling a last-copy secret; none elsewhere                                                                                        | replace `window.confirm` with the app's dialog; add confirm on Accept and on Re-roll                                                                                  |

---

## 20. Accessibility

**Done well**: tier and finish are text as well as colour on cards; secrets carry a ring and a word; toggles use `aria-pressed`; nav badges are spoken text; `inert` on the bars during ceremonies; skip link and route focus; reduced motion honoured live in CSS and JS, including the entire ceremony; the stand has a real Next button; dialogs for the set-complete and bought-pull reveals are labelled and trapped.

**Gaps**

- **Text contrast and size**: 9 px amber-on-dark uppercase (streak line, degraded banner), `text-muted-foreground/45` for Reveal all, `opacity-40` blocked tiles. Sizes under 11 px fail comfortably-readable thresholds regardless of contrast ratio. Contrast ratios were not measured in this pass; the three above are the first to check.
- **Colour-only**: sort chip active state (no `aria-pressed`), selected partner pill, pending offer ring, current filmstrip thumb (opacity), compare winner (bold + colour). Secret _level_ on a tile is colour + a 9 px word.
- **Rarity without colour**: on the card yes; on tiles and trade chips the word is the only non-colour cue and it is 9 px. Level pips (section 8) solve this.
- **Touch targets**: section 18.
- **Keyboard**: no `focus-visible` on any trade button, the partner pills, Rearrange or League tiles; `neon-btn` defines no focus state; `--ring` equals `--primary`, so focus and selection look the same.
- **Screen-reader structure**: two unlabelled `<nav>` landmarks; the milestone reveal lacks `aria-modal`/focus trap; the false "Pack Complete" heading is announced as fact (open product call B-30). Nothing that _arrives_ (a trade, a tier change) is announced.
- **Reduced motion**: comprehensive, but `motion/react` fades and Tailwind `animate-pulse/spin` are not gated; long unfilled holds remain (the secret still waits 1.6 s in silence).
- **Modals**: the secret sheet's close is 16 px; Escape and outside-tap work.

**Fixes**: `aria-pressed` on sort chips and partner pills; a status word on pending offers; `aria-label="Primary"`/`"Account"` on the navs; a global `:focus-visible` rule with a 2 px offset ring in a colour that is not the primary (e.g. white at 80%); `aria-modal` + focus trap on `MilestoneReveal`; shorten the reduced-motion holds to 300 ms; polite live region for "Offer from Bob arrived".

---

## 21. Performance and perceived speed

**Good**: three renditions (320/800/1200) with `sizes` matched between grid and hero; lazy grid images starting at `medium`; the next two pack fronts preloaded during the ceremony (`src/lib/preload.ts`, `players.pack.tsx:1140-1150`); signed-URL snapshot in localStorage for first paint; `HoloCard` memoised; foil layers mounted only while engaged; 5:7 boxes reserved; synthesised sound (no audio downloads).

**Gaps**

- **Perceived**: no skeletons — screens paint chrome, then text, then tiles pop. The vault hero grows through five independent query results (dust chip, flame, packs line, secrets line, streak line, offer pill), each shifting the grid below.
- **Universal back** decoded at 1200 px per locked tile with no lazy attribute (`src/components/pack-card-back.tsx:36-53`).
- **Fonts**: one render-blocking Google stylesheet requesting seven weights across three families, one of which is unused.
- **Secret pull wait** up to 6 s behind a pulsing rectangle.
- **Landing chime + confetti** on the first open of each owned card per session (90 particles for top tiers and Gold+ finishes) while the page is still laying out the stats.
- `circuit-bg` is a repeating SVG data URI plus two gradients on every route; cheap, but it is also the first thing to drop for a quieter page.
- 27 unused shadcn primitives and their Radix/recharts/embla/cmdk dependencies remain in the bundle graph; tree-shaking removes most but not all of the CSS and the install weight. Not a user-facing problem; worth a cleanup ticket.

**Recommendations**: skeleton tiles and a fixed-height hero (reserve every line); `thumb` rendition + lazy for locked backs; self-host Barlow Condensed and JetBrains Mono as WOFF2 with `font-display: swap` and drop Inter (or apply it); preload the secret's art the moment the pull resolves (already done for `secret.artUrl`) and show a foil sweep on the sealed card while waiting; key the landing celebration on first view after acquisition rather than per session.

---

## 22. Screen-by-screen audit

### The Vault (home) — `/players`

- **What works**: shelves as binder pages; 2-up tiles at a readable size; tinted set panels; locked cards as the universal back; Open Pack as the biggest control; the "Offer waiting" pill; per-device layout; no leaks about unpulled secrets.
- **UX problems**: does not answer "what now"; no pack countdown; no claimable-reward cue; no new-cards strip; no dupes on roster tiles; no filter/search; sort is Roster-only and colour-only; "printed" is an admin word.
- **Mobile problems**: ≈ 640 px of header before the first card at 390; no card visible above the fold at 320; sort chips wrap at 320; hero grows in five steps as queries land; star (36 px) over a link.
- **Visual problems**: 9 px tier/finish captions; every owned tile glows; circuit background and cyan glow compete with foils; six control styles in the first screen.
- **Recommended changes**: a fixed-height "Today" card (pack state, streak strip, claimable rung, new-since-last-visit); one-line collection summary; sort/filter/density in a bottom sheet; 12 px captions with finish · ×N · packed-by; ×N pip on tiles; skeleton tiles; glow by rank only.
- **Priority: Critical.**

### Pack — sealed — `/players/pack`

- **Works**: the wrapper is a real object; the perforation hint; "Drag across the tear · or press Enter"; streak line; Collected counter.
- **UX**: the streak sentence and the flame duplicate each other; no "resets at" for a finished pack; guest sees no secret cue; CollectorSignupGate can push the pack down a full screen.
- **Mobile**: header row of back-link (16 px tall), 16 px sound icon, flame, counter; wrapper capped at 260 px so at 430 px it floats in space.
- **Visual**: fine; the wax foil is good.
- **Changes**: 44 px header controls; wrapper up to 300 px; sound control persistent at bottom-left; move the collector signup to a dismissible line.
- **Priority: Medium.**

### Pack — ceremony and stand

- **Works**: nearly everything (section 7).
- **UX**: no NEW/×N; rarity all at once; no mute mid-reveal; "Reveal all" hidden on the secret step (right) but a ghost elsewhere.
- **Mobile**: card 185 px at 320 × 568 (acceptable), 315 px at 390; Next 36 px; Skip 27 px; Reveal all 22 px.
- **Changes**: NEW/×N ribbons; two-beat reveal for special pulls; 44 px Skip/Reveal all/Next; mute on the stand; pending-secret sweep and time-based copy.
- **Priority: High.**

### Pack — summary

- **Works**: the secret is the biggest thing; streak claim is here; share is here; inline failures.
- **UX**: roster cards become thumbnails; tier/finish in 8–9 px (54 of 107 text nodes under 11 px); no dupe/NEW marks; guest hits "Sign in to claim".
- **Mobile**: ≈ 100 px roster cards at 390, 80 px at 320; 330 px of blocks under the cards; three 34 px buttons.
- **Changes**: secret full-width, roster cards in a snap row at ≥ 140 px, ribbons, 12 px captions, 48 px buttons, "Next pack in N h", Share as a first-class exit.
- **Priority: High.**

### Player card — `/players/$id`

- **Works**: full-width card; zoom/flip/swipe/tilt; the slab and serial plate; locked state with a CTA; filmstrip; share export.
- **UX**: card is 45% of a 2 100 px stats page; the landing chime replays each session and confetti re-fires for top cards; no trade entry; thin provenance; tier badge shown on locked cards (product call B-32 territory).
- **Mobile**: 29 px action chips, 28 px overflow trigger, 32 px zoom buttons, 16 px back link; six reaction chips at 34 px; QR at 140 px on a phone that is the printed card's twin, not its reader.
- **Visual**: the tier wash is good; chips and tiles use four radii.
- **Changes**: full-screen viewer first, details second; 44 px controls; celebration keyed to first view after acquisition; "Offer this card" / "Ask for it"; provenance line; hide the QR behind "Printed card" unless the device is desktop.
- **Priority: High.**

### Secret sheet (dialog from the Vault)

- **Works**: dialog not route; swipe across held secrets; level + odds; flavour line; "only one who has found this".
- **UX**: raw ISO date "PULLED 2026-07-28"; no set name; no share by rule; no trade entry.
- **Mobile**: 16 px close; card capped at 320 px in a 92 vw box; nav visible behind the sheet.
- **Changes**: same full-screen viewer as roster cards; formatted date ("Pulled 28 Jul"); set chip; 44 px close; level pips.
- **Priority: Medium.**

### Trading Post — `/players/trade`

- See section 10. **Priority: High.** Structural: Offers/Feed tabs, sticky Make an offer, full-screen builder with trays and review, stacked You give / You get on phones, confirm on Accept.

### Shop — `/players/shop`

- **Works**: the most readable screen (12 px body throughout); prices on buttons; refusals as sentences; market-first order is argued and reasonable; "Nothing for sale right now".
- **UX**: "Settle a finish" rows read "— unsettled" with no card name (stub artefact of missing names, but the row design relies on a name that may be absent); the ladder table is the only place the rarity ladder is visible in the whole app; `window.confirm` on last copy.
- **Mobile**: 32 px Burn/Sell/Re-roll buttons; five stacked panels of prose before the first action.
- **Visual**: stock shadcn buttons in a neon app — inconsistent but readable.
- **Changes**: 44 px row buttons; collapse the explanatory prose to one line each with "?"; lift the ladder into the profile/rarity guide; app dialog instead of `window.confirm`; show a card thumbnail on each row.
- **Priority: Medium.**

### League hub — `/league`

- **Works**: five clear tiles; fetches nothing.
- **UX/mobile**: 2-col tiles fine; the admin line is a 15 px link.
- **Changes**: absorb Board as the first tile; house Shop while dust is on; 44 px admin link.
- **Priority: Low.**

### Leaderboard — `/leaderboard`

- **Works**: readable (16–24 px), share per row, ranks computed from one rule.
- **Mobile**: 36 px share icons; 23 px name links.
- **Changes**: 44 px rows; move behind League.
- **Priority: Low.**

### Claim and Auth — `/claim`, `/auth`

- **Works**: 2-col name grid, big code input, clear failure copy, links between the two.
- **Mobile/visual**: `auth` has no `circuit-bg`, so it is the one light-feeling screen; the mode toggle is a 16 px text link; 36 px submit buttons.
- **Changes**: 48 px submit; 44 px toggle; theme consistent with the rest.
- **Priority: Low.**

### Global shell (header, tabs, toasts, errors)

- **Problems**: wordmark wraps at 320; no safe-area top; 32 px account icon; tab bar reflows 5↔6; `text-[10px]` tab labels; toasts top-centre; unthemed 404/error; white SSR error page.
- **Changes**: single-line wordmark; safe-area top; 44 px account target; fixed five tabs (Vault · Pack · Trade · League · You); 11 px labels; toasts bottom-centre above the bar; themed error pages.
- **Priority: High.**

---

## 23. Top 10 UX problems

| #   | Problem                                                                                                                                    | User impact                                                                                                            | Location                                               | Recommended fix                                                                                                       | Difficulty  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | **Label layer at 8–10 px uppercase, widely tracked** (28–54% of text nodes under 11 px on card screens)                                    | Tier, finish, level, counts and instructions are unreadable outdoors; every small control inherits the size            | Vault tiles, stand, summary, trade tiles, player chips | Type scale in §16: 11 px floor, 12 px metadata, tracking ≤ 0.08 em                                                    | Easy        |
| 2   | **Home does not say what to do now**                                                                                                       | Daily loop depends on remembering; claimable rewards and finished packs are invisible; guests never see the secret cue | `/players` hero                                        | "Today" card: pack state + countdown, streak strip with claimable rung, new-since-last-visit strip                    | Moderate    |
| 3   | **~40 controls under 44 px**, including 16 px mute and close                                                                               | Mis-taps, especially in a garden; the star navigates                                                                   | see §18                                                | `min-h-11` floor, `neon-btn` sizes, 44 px icon buttons                                                                | Easy        |
| 4   | **Trade builder is a form, not a table** — pills, 84 px strips, no tray, no review, no confirm, below the fold                             | Trades feel risky and fiddly; Accept moves two collections with one tap                                                | `/players/trade`                                       | Full-screen builder with Who → trays → Review; stacked You give / You get; confirm on Accept                          | Significant |
| 5   | **Pack summary shrinks the cards to ≈ 100 px** and shows no NEW/×N                                                                         | The payoff screen undersells the pull; dupes look like hits                                                            | `pack-summary.tsx:178`                                 | Secret full-width, roster snap row ≥ 140 px, NEW/×N ribbons                                                           | Moderate    |
| 6   | **Rarity of secrets is a 9 px coloured caption**; base foil = UI cyan; everything glows                                                    | A Mythic and a Common look alike on the shelf; base cards look like buttons                                            | tiles, stand, trade                                    | Level pips, edition corner tab, base hue shift, glow by rank only                                                     | Moderate    |
| 7   | **The room competes with the card** — circuit background, cyan bloom on every panel and control                                            | Art is not the centrepiece; the page reads as a HUD                                                                    | `styles.css` `circuit-bg`, `hud-glow`, `neon-btn`      | Flat ground on card screens; glow only on the primary CTA and ranked cards                                            | Easy        |
| 8   | **Card detail is a stats page with a card on top**; no trade entry from a card                                                             | Examining a collectible feels like reading a profile; trading starts from a blank form                                 | `/players/$id`, secret sheet                           | Full-screen viewer first; "Offer / Ask for this card"                                                                 | Significant |
| 9   | **Collection has no dupes on tiles, no filter/sort sheet, no skeleton**                                                                    | Trading decisions start blind; the page pops from locked to owned                                                      | `players.index.tsx`                                    | ×N pip, sort & filter sheet, skeleton tiles                                                                           | Moderate    |
| 10  | **Feedback surfaces are misplaced or missing**: toasts top-centre, no offline state, unthemed errors, degraded banner on the pack, no undo | Errors look foreign; the best screen gets interrupted; nothing is reversible                                           | `__root.tsx`, `error-page.ts`, `feed-state.tsx`        | Bottom toasts above the bar, offline banner, themed errors, banner hidden while presenting, undo on Decline/Take back | Easy        |

---

## 24. Quick wins

Each is a day or less and touches no data model.

1. **Type floor**: replace `text-[8px]`/`text-[9px]`/`text-[10px]` with `text-[11px]`/`text-xs` and cap `tracking-[0.3em]` at `0.08em` on labels, across `players.index.tsx`, `pack-summary.tsx`, `pack-stand.tsx`, `trade-offer-card.tsx`, `players.$id.tsx`.
2. **44 px everywhere**: `min-h-11` on sort chips, partner pills, action chips, Reveal all, Skip, Next, back links, "Claim your player", "Offer waiting"; pad the sound toggle and dialog close to 44 × 44; give `neon-btn` `sm/md/lg` classes and delete the `!px/!py` overrides.
3. **Roster ×N on tiles** (`players.index.tsx:574-591`) from `collected[id].count`.
4. **NEW / ×N ribbons** on the stand and summary: roster from the pack baseline, the secret from the pull result's `duplicate` flag. (The "new since last visit" strip is not a quick win; see §25 item 1.)
5. **Streak strip** with the five rungs and the next promise (`nextMilestoneLine`) on the vault hero and sealed pack.
6. **"Next pack in N h"** on the summary and the hero from `SecretDayStatus.resetsAt`.
7. **Mute on the stand**, same spot as the sealed screen.
8. **Flat ground on card screens**: remove `circuit-bg` from Vault, Pack, player, Trade, Shop; keep it on League/Board/TV.
9. **Glow by rank**: drop the per-tile tier glow for base/dnf/penalty; keep it for champion/podium, Gold+, Legendary+.
10. **Base foil hue** off primary; base border to 24% white.
11. **Toaster** to `bottom-center` with an offset above the tab bar; suppress while presenting.
12. **Fix `hover:text-danger`** → `destructive`; add a global `:focus-visible` ring; `aria-pressed` on sort chips and partner pills; `aria-label` on both navs; `aria-modal` + focus trap on `MilestoneReveal`.
13. **Single-line wordmark** below `sm`; `safe-area-inset-top` on the header.
14. **Skeleton tiles** until `mine.ready`; reserve the hero's line heights.
15. **Theme the 404, error boundary and SSR error page**; drop the unused Inter request or apply it.
16. **Lazy + thumb rendition** for the universal back on locked tiles.
17. **Secret sheet**: formatted date, set chip, 44 px close.
18. **Empty inbox**: add the Make an offer button under "Nobody wants your cards. Yet."

---

## 25. Larger redesign opportunities

1. **Home as "Today"** (§3): a fixed-height state card for the pack, streak and rewards, a new-since-last-visit strip backed by an acquisitions query (§12), then the binder. Replaces the hero.
2. **Collection browser** (§5): sort/filter/density bottom sheet, ×N pips, level pips and edition tabs on tiles, mystery slot per set, skeletons, Complete shelf first. Reuses `VaultSection` and `HoloCard`.
3. **Full-screen card viewer** (§6): one component for roster cards and secrets — dark room, svh-sized card, swipe, flip, pinch, bottom controls, pull to dismiss; details as a second step. Built from `ZoomPanFrame` + `HoloCard` + the stand's sizing rule.
4. **Trade builder** (§10): Who → trays → Review, stacked sides, confirm on Accept, Offers/Feed tabs, sticky Make an offer. Server functions unchanged.
5. **Navigation** (§4): five fixed tabs with a profile tab; Board and Shop rehoused; the profile holds account, code, streak ladder and history, dust, sound/haptics/tilt.
6. **Pack summary and reveal refinements** (§7): two-beat special reveal, ribbons, summary reflow, pending-secret treatment.
7. **Design system** (§26): tokens for type, spacing, control sizes, surfaces and glow, replacing ad-hoc utility strings; a `Button`/`Chip` API used by all card screens so the shop and the vault stop looking like two apps.

Suggested order: 7 (tokens) → quick wins → 1 → 2 → 3 → 4 → 5 → 6. Each step ships on its own.

---

## 26. Recommended mobile design system

All colours in `oklch()`, as the codebase requires. Values chosen to sit under card foils rather than beside them.

**Colour**

| Token                         | Value                                             | Use                                                                |
| ----------------------------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| `--bg`                        | `oklch(0.13 0.015 240)`                           | page ground on card screens                                        |
| `--bg-hud`                    | `oklch(0.14 0.02 240)` + `circuit-bg`             | League, Board, TV only                                             |
| `--surface`                   | `oklch(0.17 0.02 240)`                            | shelves, panels, sheets                                            |
| `--surface-raised`            | `oklch(0.21 0.02 240)`                            | the slab, the trophy plaque, the sealed pack                       |
| `--border`                    | `oklch(1 0 0 / 8%)`                               | panels                                                             |
| `--border-strong`             | `oklch(1 0 0 / 24%)`                              | base-tier card border, inputs                                      |
| `--text`                      | `oklch(0.97 0.005 240)`                           | body                                                               |
| `--text-2`                    | `oklch(0.78 0.02 230)`                            | metadata (raise from 0.74 for contrast at 12 px)                   |
| `--text-3`                    | `oklch(0.62 0.02 235)`                            | disabled, hints                                                    |
| `--accent`                    | `oklch(0.82 0.14 210)`                            | links, primary button, active tab (no glow except the primary CTA) |
| `--accent-2`                  | `oklch(0.75 0.13 195)`                            | secondary emphasis, progress                                       |
| `--focus`                     | `oklch(0.98 0.01 240 / 85%)`                      | focus ring, distinct from accent                                   |
| `--good` / `--warn` / `--bad` | `0.72 0.22 145` / `0.82 0.19 85` / `0.65 0.24 25` | status only                                                        |

**Rarity** (presentation tokens; ids unchanged)

|      | Tier bezel                                                  | Edition metal                    | Secret level                                 |
| ---- | ----------------------------------------------------------- | -------------------------------- | -------------------------------------------- |
| Top  | champion `0.88 0.17 90`                                     | platinum `0.93 0.03 210` + sheen | mythic `0.84 0.2 15` · 5 pips · ring shimmer |
|      | podium `0.85 0.14 95`                                       | gold `0.84 0.14 82`              | legendary `0.86 0.16 85` · 4 pips            |
|      | stationKing `0.8 0.16 300`                                  | silver `0.86 0.012 250`          | epic `0.82 0.16 300` · 3 pips                |
| Base | base `0.8 0.12 185` (shifted off UI cyan), border 24% white | bronze `0.72 0.1 55`             | rare `0.82 0.14 210` · 2 pips                |
| Low  | penaltyBox `0.82 0.19 85`, dnf `0.62 0.02 240`              | standard: none                   | common `0.72 0.02 240` · 1 pip               |

Glow: only champion/podium tiers, gold/platinum editions, legendary/mythic levels, and the primary CTA.

**Shape and size**

| Token                     | Value                                                           |
| ------------------------- | --------------------------------------------------------------- |
| radius-card               | 12 px (5:7 cards), 16 px for the viewer                         |
| radius-panel              | 12 px                                                           |
| radius-chip / pill button | 999 px                                                          |
| radius-secondary button   | 10 px                                                           |
| button-height             | 44 (sm) · 48 (md, default) · 56 (lg, Open Pack / Send / Accept) |
| icon-button               | 44 × 44                                                         |
| input-height              | 48                                                              |
| chip-height               | 44 (all tappable chips)                                         |
| page-padding-x            | 16                                                              |
| card-grid-gap             | 12                                                              |
| section-gap               | 24                                                              |
| stack-gap                 | 8                                                               |
| tab-bar                   | 56 + safe-bottom, five fixed tabs                               |
| header                    | 48 + safe-top                                                   |
| sheet                     | 16 px padding, 20 px top radius, 85 dvh max                     |

**Icons**: lucide, 1.75 stroke, 20 px in the bar, 18 px in chips, 16 px inline. Rarity uses shapes (pips, tabs), not icons.

**Typography**: the scale in §16 — Barlow Condensed for titles, names, badges and buttons; one body face (system or Inter, decide once) at 15/12; JetBrains Mono for numerals. 11 px floor.

**Animation**: keep every ceremony as is. Elsewhere: 160 ms ease-out for state changes, 260 ms for sheets, 460 ms spring for a card settling, no idle animation in grids, no glow transitions on hover for touch. Reduced motion removes transitions and holds; it never removes information.

---

## 27. The ideal mobile experience

**Opening the app.** The tab bar is where it always is. The first screen is a "Today" card: a sealed pack with "Open today's pack" — or "Next pack in 6 h" and the flame reading Day 5 with the next rung, "Day 7 pays Rare or better", in a line you can read from the hip. Under it, a strip of three cards you got yesterday and the Gold plaque from the set you finished on Tuesday. Then your binder: Favourites, the trophy shelf, Pets with two cards and one face-down "?" at the end, the Roster with a small ×3 in the corner of Bob's tile because you have spares.

**Seeing rewards.** "Three Days is waiting — claim it" sits in the Today card. Tap it and the flame swells, counts to 5, and a card lands and turns over. "Nice." You are back on Today, and the card is now the first thing in the new-since-last-visit strip.

**Opening a pack.** Unchanged in its bones: drag the strip, the ceremony, the stand. Bob turns over — a beat — then the frame blooms gold and a second note rings: a NEW ribbon on the first, ×3 on the third with "sell for 5" whispered underneath. "Pack Complete" lies for half a second, glitches, and the secret arrives with five pips under its name. The summary shows the secret full-width, the three roster cards big enough to admire in a row, the streak strip, "Next pack in 22 h", and Share.

**Discovering new cards.** The new strip on Today, the ribbon on the stand, and a one-time glow on a set shelf that just appeared. Nothing permanent; everything gone in a day.

**Browsing the collection.** Two big cards across, 12 px captions that say "Gold · ×3 · Packed by 7", pips on secrets, a tab in the frame's metal for a good finish. One "Sort & filter" chip opens a sheet: Newest, Rarity, Spares only, Missing only, 2-up/3-up. Tiles do not glow unless they earned it. The page behind the cards is dark and still.

**Inspecting a favourite card.** Tap a tile and the card fills the screen in a pool of light. Tilt it, pinch it, tap it to turn it. Swipe to the next. Bottom row: Close · Flip · More (Share, Pin, Compare, Offer this card). Swipe up for the slab, the splits, the trash talk.

**Trading with another user.** Make an offer is always at the bottom of Trade. Pick Bob from a list that says he has three spares. Your tray, his tray, cards big enough to recognise, ×N and pips visible, "last copy" in words. Review: "Your Gold Bob for his Epic Gary" and one green button. When Bob answers, a dot on Trade and a pill on Today; Accept asks once, then the card is in your new strip.

**Completing sets.** The gold curtain and the count-up stay exactly as they are; they are the best moment after the pack. The plaque goes to the trophy shelf at the top of the binder, the "?" disappears from that set's page, and the set's shelf header wears a small medal from then on.

The cards are the hero. The room is dark. Everything you can press is the size of a thumb, and everything you need to read is the size of a word.

---

## 28. Phased PR plan — prompts for a coding agent

Each phase below is one pull request. Run them in order: every phase builds on the tokens and sizes from the one before it, and each one is small enough to review on a phone in an evening. Paste the **Project guardrails** block at the top of every prompt, then the phase's prompt. The prompts are written for Claude Code; the tool notes at the end say what to change for Lovable or Codex.

### How to use these prompts

1. Start every phase from an up-to-date `main` on a new branch named in the prompt.
2. Paste the guardrails block, then the phase prompt, into the agent.
3. When the PR opens, read it on a phone at 390 px before merging: the "Done when" list in each prompt is what to check.
4. Merge, pull, move to the next phase. Do not run two phases at once; they touch the same files.

### Project guardrails (paste at the top of every prompt)

```text
Project guardrails for willyoubemyhero (read CLAUDE.md first):
- Package manager is Bun 1.3.11. Before you finish, run `bun run format`, then `bun run lint`, `bun run typecheck` and `bun run test`, and fix anything red. Lint includes Prettier and is the formatting gate.
- Never rename or remove the six tier ids (champion, podium, stationKing, penaltyBox, dnf, base), the edition ids (platinum, gold, silver, bronze, standard), the secret levels (mythic, legendary, epic, rare, common) or any award category id. They are persisted. Changing their colours, labels or presentation is fine.
- Colours are oklch() everywhere.
- Never show how many secret cards exist in a set, on any screen or in any response, except the existing completion trophy. No "x of N", no silhouettes of unpulled secrets, no empty set headers.
- Never hand-edit src/routeTree.gen.ts or anything under src/integrations/supabase/.
- Import the server Supabase client only dynamically inside a handler: `const { supabaseAdmin } = await import("@/integrations/supabase/client.server")`.
- Any new mutating server function starts with requireAdmin(eventId) or requireMember() from src/lib/require-auth.server.ts. Participant ids come from the verified token, never from the request payload.
- New migrations must replay from empty (IF NOT EXISTS, DROP POLICY IF EXISTS, CREATE OR REPLACE).
- Do not add npm dependencies. If a dependency must change, update both bun.lock and package-lock.json.
- Add or extend tests in the existing layers: src/**/*.test.tsx for components and hooks, src/lib/*.functions.test.ts with callServerFn + memberHeaders() for server functions, e2e/*.spec.ts for screens. Keep e2e stubs in e2e/fixtures.ts consistent (no stub key may be a substring of another).
- Respect prefers-reduced-motion for anything animated; keep aria labels and pressed/current states on controls.
- Comments explain why, not what. Match the existing tone.
- Never force-push, rebase or amend anything already pushed; the repo is connected to Lovable.
- When done, open a PR against main with the title given in the prompt, describe the change, attach a 390 px phone screenshot of each changed screen, and link the relevant section of docs/ux-audit-mobile.md.
```

### Phase overview

| PR  | Title                                           | Implements         | Touches                                                                    | Risk   |
| --- | ----------------------------------------------- | ------------------ | -------------------------------------------------------------------------- | ------ |
| 0   | Design tokens and control sizes                 | §16, §17, §18, §26 | `src/styles.css`, `site-nav.tsx`, every `neon-btn` caller                  | Low    |
| 1   | Readability and touch-target sweep              | §16, §18, §20      | vault, pack, player, trade, secret sheet, dialog                           | Low    |
| 2   | Quieter room, rarity by rank                    | §8, §15            | `styles.css`, `card-rarity.ts` colours, `holo-card.tsx`, tiles             | Medium |
| 3   | Pack ribbons, summary reflow, mute on the stand | §7, §12            | `players.pack.tsx`, `pack-stand.tsx`, `pack-summary.tsx`                   | Medium |
| 4   | Feedback surfaces                               | §19, §21           | `__root.tsx`, `error-page.ts`, vault skeletons, `milestone-reveal.tsx`     | Low    |
| 5   | Home "Today" card and streak strip              | §3, §11, §13, §5   | `players.index.tsx`, `vault-hero.tsx` → `today-card.tsx`                   | Medium |
| 6   | Acquisitions read and "new since last visit"    | §12                | new server function + test, vault, player page                             | Medium |
| 7   | Full-screen card viewer                         | §6, §9             | new `card-viewer.tsx`, `players.$id.tsx`, `secret-card-sheet.tsx`          | High   |
| 8   | Trade builder                                   | §10                | `players.trade.tsx` split, `trade-offer-card.tsx`, new `trade-builder.tsx` | High   |
| 9   | Navigation and profile                          | §4                 | `nav.ts`, `site-nav.tsx`, `league.ts`, new `routes/you.tsx`                | Medium |
| 10  | Two-beat reveal and set mystery slot            | §7, §9, §14        | `pack-stand.tsx`, `players.index.tsx`                                      | Medium |

### PR 0 — Design tokens and control sizes

Branch `ux/00-tokens`. Title: **Design tokens and control sizes**.

```text
Goal: give the app one type scale, one spacing scale and one set of control sizes, so the later UX phases change tokens rather than utility strings. Implements §16, §17, §18 and §26 of docs/ux-audit-mobile.md.

Do this in src/styles.css and the components named below only; do not change any screen's layout yet.

1. In @theme inline, add font-size tokens for the scale in §16 (title 30/32, section 18/22, card-name 15/18, viewer-name 22/24, body 15/22, label 12/16, meta 12/16, badge 13/16, nav 11/14, button 15/20) and spacing tokens for §17 (page-x 16, section-gap 24, stack-gap 8, grid-gap 12, control-gap 8). Add --focus: oklch(0.98 0.01 240 / 85%) and point --ring at it so focus rings stop matching --primary.
2. Decide the body face: apply Inter via --font-sans (it is already requested in src/routes/__root.tsx) OR remove the Inter family from that Google Fonts request. Pick one; do not leave an unused download.
3. Replace the neon-btn @utility's fixed padding/font-size with three size classes: neon-btn-sm (min-height 44px), neon-btn (48px) and neon-btn-lg (56px), all with a visible :focus-visible ring using --focus. Then update every caller that currently overrides with !px-* !py-* !text-* (vault-hero.tsx, pack-summary.tsx, players.trade.tsx, players.$id.tsx, collector-signup.tsx, milestone-reveal.tsx, bought-pull-reveal.tsx, claim.tsx, collection-complete.tsx) to use a size class and drop the overrides. Open Pack, Send offer and Accept get neon-btn-lg.
4. Add a global :focus-visible rule in @layer base (2px outline, 2px offset, colour --focus) so raw <button> elements get a ring without per-component classes.
5. In src/components/site-nav.tsx: aria-label="Primary" on the bottom <nav> and aria-label="Sections" on the desktop <nav>; make the account/sign-in control 44x44 (keep the icon size); prevent the wordmark from wrapping below 640px (single line, smaller tracking); add padding-top: env(safe-area-inset-top) to the sticky header.
6. Fix the stale "electric green accent" comment at the top of src/styles.css.

Done when:
- bun run lint, typecheck and test are green.
- grep -rn "neon-btn" src | grep -c "!py-" returns 0.
- The header is one line at a 320px viewport (check e2e mobile project or a manual screenshot).
- Tabbing through the vault shows a visible focus ring that is not the same colour as a selected chip.
- No screen's layout has changed beyond button heights and the header.
```

### PR 1 — Readability and touch-target sweep

Branch `ux/01-readability-targets`. Title: **Readability and touch-target sweep**.

```text
Goal: nothing a player reads is under 11px and nothing a player taps is under 44px. Implements §16, §18 and §20 of docs/ux-audit-mobile.md. Use the tokens from PR 0; do not restructure any screen.

Scope: src/routes/players.index.tsx, players.$id.tsx, players.pack.tsx, players.trade.tsx, players.shop.tsx, src/components/pack-stand.tsx, pack-summary.tsx, pack-opening.tsx, trade-offer-card.tsx, secret-card-tile.tsx, secret-card-sheet.tsx, zoom-pan-frame.tsx, vault-hero.tsx, vault-section.tsx, favourite-button.tsx, card-social.tsx, card-compare.tsx, feed-state.tsx, and src/components/ui/dialog.tsx (close button only).

1. Replace every text-[7px]..text-[10px] on player-facing surfaces with the label/meta tokens (12px) or, for badges, the badge token (13px). Cap letter-spacing at 0.08em below 14px. Keep uppercase for display, labels and buttons; metadata such as "Packed by 7" and "Pulled ×3" becomes sentence case. Do not touch admin panels or the TV route.
2. Give every tappable chip, pill and link min-h-11 with enough horizontal padding: vault sort chips and Shuffle, Rearrange, "Claim your player", "Offer waiting", back links ("← Vault", "← The Vault"), the player page action chips and its phone overflow trigger, award pills, the reveal stand's Next, Reveal all (keep its quiet styling, raise opacity to 60%), the ceremony Skip, trade partner pills, Decline and Take it back, the shop's Burn/Sell/Re-roll (Button size="default" instead of "sm"), the leaderboard share icons, reaction chips and Post.
3. Icon-only controls become 44x44 with the glyph centred: the pack screen's sound toggle, the dialog close in ui/dialog.tsx, the zoom-pan-frame buttons, the vault section move arrows in rearrange mode, the comment delete (also make it visible on touch, not hover-only).
4. The favourite star: 44x44, and give the tile link an inset so a star tap never navigates; keep aria-pressed and the existing labels.
5. Semantics: aria-pressed on the vault sort chips (or role="radiogroup"), aria-pressed on the trade partner pills, a visible text status ("Pending") on pending offer cards, aria-modal="true" and a focus trap on MilestoneReveal matching BoughtPullReveal, and replace hover:text-danger in players.trade.tsx with the destructive token.
6. Format dates shown to players (secret sheet "Pulled 2026-07-28") with the existing formatting helpers in src/lib/format.ts, adding one if none fits.

Done when:
- bun run lint, typecheck and test are green; update any test that asserted old text sizes or labels.
- rg -n "text-\[(7|8|9|10)px\]" src/routes/players*.tsx src/components/{pack,trade,vault,secret,holo,card}*.tsx returns nothing.
- A Playwright check (add it to e2e/smoke.spec.ts) asserts that on /players, /players/pack and /players/trade every visible button, link and [role=button] has a bounding box of at least 44px in height, excluding the skip link.
- Screenshots at 320 and 390 show the sort chips on one row and nothing clipped.
```

### PR 2 — Quieter room, rarity by rank

Branch `ux/02-room-and-rarity`. Title: **Quieter room, rarity by rank**.

```text
Goal: the page behind the cards goes quiet and rarity becomes readable at tile size without colour alone. Implements §8 and §15 of docs/ux-audit-mobile.md. Presentation only: no id, weight or odds changes.

1. Ground: remove circuit-bg from the card routes (players.index, players.pack, players.$id, players.trade, players.shop) and give them a flat --bg of oklch(0.13 0.015 240) with one soft top vignette. Keep circuit-bg on league, leaderboard, live, order, draft, awards, analytics and tv.
2. Glow budget: the primary CTA keeps --glow-primary. Remove hud-glow and glowing box-shadows from the active tab underline, waiting dots, selected partner pills, offer cards and the open secret set panel; use a 2px ring or a chip instead. On vault tiles, the tier glow renders only for champion and podium; a Gold or Platinum edition and a Legendary or Mythic secret get their own glow; base, penaltyBox, dnf and Standard get none.
3. Base tier: border to oklch(1 0 0 / 24%); holoA/holoB shifted about 20 degrees off the UI primary (toward teal-green) in src/lib/card-rarity.ts so base cards stop matching buttons. Add a unit assertion that the six tier ids are unchanged.
4. Level pips: a small LevelPips component (one to five filled diamonds in the level's accent, aria-label "Epic, 3 of 5") rendered under a secret's name on vault tiles, the reveal stand, the pack summary, the secret sheet, trade tiles and shop rows. Mythic forces the prism ring's shimmer at hero size.
5. Edition tab: a small 45-degree corner tab in the edition metal on tiles and trade tiles for bronze, silver, gold and platinum; nothing for standard. Reuse the --edn-* custom properties holo-card.tsx already sets.
6. Panels: one surface token (oklch(0.17 0.02 240), 1px border at 8% white, 12px radius) for shelves, panels and sheets; keep hud-bezel only on the sealed pack, the card slab and the trophy plaque.
7. Theme the 404 and error boundary in src/routes/__root.tsx (dark surface, display font, neon-btn) and make src/lib/error-page.ts dark to match.

Done when:
- lint/typecheck/test green; card-rarity.test.ts still passes with the id assertion added.
- On /players with the e2e stubs, a base card tile has no box-shadow glow and a champion tile does (add an e2e assertion using getComputedStyle).
- LevelPips has a unit test for 1..5 and an aria-label.
- Screenshots of vault, pack stand and trade at 390 attached, before and after.
```

### PR 3 — Pack ribbons, summary reflow, mute on the stand

Branch `ux/03-pack-payoff`. Title: **Pack ribbons, summary reflow, mute on the stand**.

```text
Goal: the pack's last screen is as big a moment as its first, and every pull says whether it is new. Implements §7 and §12 of docs/ux-audit-mobile.md. Do not change the ceremony timings, the stand's phase machine (src/lib/stand-phase.ts) or anything in src/lib/pack-ceremony.ts.

1. NEW / ×N ribbons, two predicates:
   - Roster cards: read packBaseline in src/routes/players.pack.tsx (keyed by event_participants.id). held === 0 shows "NEW"; held > 0 shows "×{held+1}". Pass the value into PackStand and PackSummary as a prop; do not recompute from the live collection (it already includes the pull once the record lands).
   - The secret: packBaseline holds no secrets. Use SecretPullResult.duplicate from the pull response: false shows "NEW", true shows "×N" with N from getMySecrets count for that card id.
   Render the ribbon as a small corner label on the card frame on the stand and in the summary, with aria text. Keep the existing "Already yours" caption and dust sell-hint for secret dupes; add the same sell-hint for roster dupes when dust is on (worth comes from src/lib/dust.ts MILL_BY_EDITION).
2. Summary reflow in src/components/pack-summary.tsx: the secret full-width first (same sizing rule as the stand, max 320px), then the three roster cards in a horizontal snap row with each card at least 140px wide (scrolls on 320px, fits at 430px), captions at 12px (tier word, finish, ×N), then the streak block, the collected counter, and two neon-btn-lg buttons: View collection (primary) and Share pack. Keep the share export unchanged.
3. Mute on the stand: render the sound toggle (44x44, aria-pressed) at the bottom-left of the stand and the summary as well as the sealed screen, outside the presentation fade, so it can be reached mid-reveal.
4. Pending secret: replace the plain pulse with a foil sweep on the sealed back every second and a hint that changes at 2s ("Still sealed…") and 4s ("Slow signal — it's yours either way"); keep the 6s timeout and inline retry exactly as they are.
5. Hide FeedDegradedBanner while presentation mode is active on the pack route.

Done when:
- lint/typecheck/test green; pack-summary.test.tsx and pack-stand.test.tsx cover both ribbon predicates (roster held 0 and 2; secret duplicate false and true).
- e2e/journeys.spec.ts or secrets.spec.ts asserts "NEW" on a first pull and "×2" on a duplicate secret using the existing withSecret helper.
- At 390px the summary's roster cards measure at least 140px wide (assert via boundingBox in e2e).
- Screenshots of stand and summary at 320 and 390 attached.
```

### PR 4 — Feedback surfaces

Branch `ux/04-feedback`. Title: **Feedback surfaces: skeletons, toasts, offline, errors**.

```text
Goal: every wait, failure and arrival is shown in the right place. Implements §19 and §21 of docs/ux-audit-mobile.md.

1. Toasts: in src/routes/__root.tsx move <Toaster> to position="bottom-center" with an offset above the tab bar (5rem + safe-area on phones, 1rem at md+), and suppress rendering while presentation mode is active (read useIsPresenting inside a small wrapper).
2. Skeletons: in src/routes/players.index.tsx, while !mine.ready render 5:7 skeleton tiles (use ui/skeleton.tsx, a slow shimmer, reduced-motion safe) in place of the locked→owned pop. Reserve the hero's heights: the dust chip, streak flame, packs line, secrets line, streak sentence and offer pill each keep a fixed slot (min-height) so the grid does not move as queries land.
3. Offline: a small hook (navigator.onLine + online/offline events) and a slim banner above the tab bar: "You're offline — the vault still works; packs record when you're back". Disable Send offer, Accept, Decline, Burn, Sell, Buy and Claim while offline, with that reason as a title/aria-description.
4. Error pages: theme NotFoundComponent and ErrorComponent in __root.tsx (dark surface, display font, neon-btn) and make src/lib/error-page.ts dark.
5. Locked tiles: src/components/pack-card-back.tsx takes loading="lazy" and the thumb rendition (VARIANT_WIDTHS.thumb) when rendered inside a grid; the sealed pack keeps large.
6. Undo: after Decline and Take it back, show a 5s toast with an Undo action that re-opens the offer through a new server function reopenTradeOffer (requireMember(), only the same actor, only within 60s, only if still declined/cancelled and every staked copy is still held). Add a unit test via callServerFn and a db test if a SQL helper is needed. If the server change is out of scope for you, leave the toast without Undo and say so in the PR.

Done when:
- lint/typecheck/test green.
- e2e: /players with a delayed getMyCardStats (server.delay) shows skeleton tiles before real ones; a toast on /players/trade renders above the tab bar (assert its y is above the nav's).
- Offline banner appears when page.context().setOffline(true) in a new e2e test.
- The 404 route screenshot matches the app's theme.
```

### PR 5 — Home "Today" card and streak strip

Branch `ux/05-today-card`. Title: **Home "Today" card, streak strip and sort sheet**.

```text
Goal: the home screen answers "what should I do right now" in one fixed-height card, and the binder starts within one screen height. Implements §3, §11, §13 and the sort/filter part of §5 in docs/ux-audit-mobile.md.

1. New src/components/today-card.tsx replacing the top half of VaultHero on /players. Fixed height (no layout shift; reserve slots). Three pack states from the data the vault already fetches (useSecretStatus, the stored pack state via the same helpers players.pack.tsx uses, useStreak):
   - sealed: "Open today's pack" (neon-btn-lg) with the secret-waiting ring/dot as today;
   - torn, unfinished: "Finish your pack · N cards left";
   - done: "Next pack in Nh" from SecretDayStatus.resetsAt (fall back to the device-local midnight the pack uses when resetsAt is null), plus the streak sentence.
   A guest sees the same three states; the secret cue stays members-only as it is now.
2. Streak strip inside the card (only when streak.current > 0): flame + "Day N", then five rung markers 3 · 7 · 14 · 30 · 100 from STREAK_MILESTONES with passed rungs filled and the next rung labelled from nextMilestoneLine. At-risk state (alive, not openedToday): amber outline and "Keep it alive". If a rung is claimable and canClaim, the strip becomes a "Claim {label}" button that opens MilestoneReveal here (reuse the claim flow from players.pack.tsx; move it into a hook if needed). If !canClaim, show "Sign in to claim" linking to /auth?mode=signup&next=/players.
3. Below the card: one line "Roster 3 / 13 · Secrets 3 across 2 sets · 1 set complete" (never a secret denominator), then the shelves. Remove "cards printed" and "packs opened" from the player-facing hero (keep the data for the profile later).
4. Sort & filter sheet: replace the Rearrange row and the sort chips with one "Sort & filter" chip on the Roster shelf header that opens a vaul Drawer (already in ui/drawer.tsx) containing sort (Name/Order/Pick/Rarity/Newest), filters (Owned, Missing, Spares), density (2-up/3-up) and the Rearrange toggle. Persist choices in the existing vault-layout storage.
5. ×N pip on roster tiles from collected[id].count when count > 1; never on locked tiles.
6. The Complete shelf moves above the set shelves by default (vault-layout default order only; user order still wins).

Done when:
- lint/typecheck/test green; today-card.test.tsx covers the three pack states, the at-risk state and the claimable state; use-my-collection and vault-layout tests still pass.
- e2e/favourites.spec.ts and secrets.spec.ts updated for the new sheet; a new assertion that at 390x844 the first roster tile's top is within the first viewport height.
- No secret set size appears anywhere (keep the existing "not.toContainText(/of \d+ secrets/)" assertion).
- Screenshots at 320 and 390 attached.
```

### PR 6 — Acquisitions read and "new since last visit"

Branch `ux/06-acquisitions`. Title: **Acquisitions read and "new since last visit" strip**.

```text
Goal: the app can say what arrived since you last looked, from server data rather than guesses. Implements the strip in §12 of docs/ux-audit-mobile.md and the first-view celebration in §6.

1. New server function getRecentAcquisitions in src/lib/acquisitions.functions.ts (method GET). First line requireMember(). Input: { eventId: uuid, since: ISO timestamp }. Reads, for the token's participant only: card_copies rows with acquired_on >= since (return event_participant_id, edition, source, acquired_on) and secret_card_pulls rows pulled on or after since (return the secret card id, name, art path signed the same way getMySecrets does, tier, and whether it was a duplicate). Never return a set id count, a set size, or another participant's rows. Cap at 50 rows, newest first. Cache-Control private, no-store like the streak function.
2. Test it in src/lib/acquisitions.functions.test.ts with callServerFn + memberHeaders(): a guest or anonymous caller is refused; the participant id is taken from the token, not the payload; the response has no key that could carry a set size (mirror the key-exact assertions the secret tests use).
3. Client: a hook useRecentAcquisitions(eventId, since) with the same query conventions as useMySecrets (staleTime 60s, refetch on focus, retry false). The device stores wwbh:vault-last-seen; the vault reads it before fetching and writes the current time when the strip is dismissed or after 24h.
4. Strip: inside the Today card from PR 5, a horizontal snap row of small cards (roster via HoloCard subtle, secrets with LevelPips) with a "NEW" or "×N" corner label from the response. Tapping a card opens it (route for roster, secret sheet for secrets) and marks the strip seen. Hidden when empty.
5. Player page celebration: in src/routes/players.$id.tsx replace the module-scoped revealed Set with a device-stored seen set keyed by event_participant_id + acquired_on from the acquisitions data (fall back to the current per-session guard when the data is missing). The chime and confetti fire the first time a card is opened after it was acquired and not again on reload. Keep the existing tier/edition gate for confetti.

Done when:
- lint/typecheck/test green; the new functions test passes; if you add SQL, tests/db replays it from empty.
- e2e: stub getRecentAcquisitions in e2e/fixtures.ts (check the substring rule) and assert the strip renders two items and disappears after tapping.
- No response from the new function contains a set size (assert exact keys).
```

### PR 7 — Full-screen card viewer

Branch `ux/07-card-viewer`. Title: **Full-screen card viewer**.

```text
Goal: tapping a card shows the card, as big as the phone allows, before anything else. Implements §6 and the sheet half of §9 in docs/ux-audit-mobile.md. Reuse ZoomPanFrame, HoloCard (tilt="hero") and useCardZoom; do not fork them.

1. New src/components/card-viewer.tsx: a full-screen layer (role="dialog", aria-modal, focus trap, Escape and pull-down to dismiss) on a dark wash with a vignette, the card sized by the same svh rule the reveal stand uses, name and tier/finish badge (or LevelPips for a secret) beneath. Bottom row of 44px controls: Close (left), Flip (centre), More (right: Share, Pin, Compare, "Offer this card" when the viewer has spares, "Ask for this card" when it is locked). Swipe left/right steps through the list the caller passes (roster in running order, or the visible secrets), wrapping. Pinch and double-tap zoom as on the player page. Presentation mode on while open. Reduced motion: no transitions.
2. Vault: a tap on a roster tile opens the viewer (locked cards open it face-down with "Rip a pack to see this card"); a tap on a secret tile opens the same viewer instead of SecretCardSheet. Keep the URL for roster cards: push /players/$id?view=1 so back closes the viewer; secrets keep no URL (they must not be shareable).
3. Player page (/players/$id): opens directly into the viewer when ?view=1; a "Details" swipe-up or chip reveals the existing slab, stats, filmstrip and social below. Landing celebration rules from PR 6 apply inside the viewer, not on the details page.
4. "Offer this card" navigates to /players/trade with the copy pre-staged (search param or in-memory store the trade route reads once); "Ask for this card" opens the partner picker filtered to owners (from getCardPullCounts) — if PR 8 is not merged yet, land on the existing compose panel with the card pre-selected.
5. Remove SecretCardSheet once the viewer covers it, and move its tests.

Done when:
- lint/typecheck/test green; card-viewer.test.tsx covers open/close, swipe wrap, flip, and that a secret never sets a URL.
- e2e: from /players, tapping a tile opens the viewer with the card at least 300px wide at 390x844; Escape closes it; the back button closes a roster viewer.
- The accessibility assertions in e2e/smoke.spec.ts still pass.
- Screenshots at 375 and 390 attached, roster and secret.
```

### PR 8 — Trade builder

Branch `ux/08-trade-builder`. Title: **Trade builder: trays, review and confirm**.

```text
Goal: building an offer reads as "you give / you get", never as a form, and answering one is deliberate. Implements §10 of docs/ux-audit-mobile.md. Server functions (createTradeOffer, acceptTradeOffer, decline, cancel) and their payloads do not change.

1. Split src/routes/players.trade.tsx into: trade-offers.tsx (inbox, outbox, receipts), trade-feed.tsx, and a new trade-builder.tsx. The route shows two tabs (Offers, Feed) and a sticky "Make an offer" neon-btn-lg above the tab bar. The signed-out and collector gates stay exactly as they are.
2. Builder as a full-screen flow (presentation mode, Escape/back closes, state kept in memory until sent or cancelled):
   - Who: a list, not pills — initials avatar, name, one line "N spares" from getTradeSpares (and "wants …" later). 56px rows, aria-pressed on the selected row.
   - Give / Get: stacked on phones. "You give" tray (staged cards 2-up with LevelPips/edition tab/×N, 44px remove buttons) with "+ Add your cards" opening a vaul Drawer picker: a 3-up grid of full cards, tap to toggle (aria-pressed), blocked cards greyed with the reason from BLOCKED_LABEL, last-copy in words, the 4-per-side cap shown as "3 / 4". Then "You get" tray with "+ Ask for their cards" on their spares, concealed art for cards you have not pulled exactly as today.
   - Review: both trays as small cards, the one-line summary from tradeItemsLabel at 16px, a last-copy warning, then Send offer (neon-btn-lg). On success return to Offers with the new outbox card highlighted.
3. Answering: TradeOfferCard stacks You give above You get on phones (each a snap row at ≥110px per card), shows a status chip at every state including Pending, uses "1 of 3" text instead of dot spans, Accept (neon-btn-lg) and Decline (quiet 44px). Accept opens a confirm sheet: "Swap your Standard Alice for Bob's Gold Bob?" with Confirm / Cancel. Decline and Take it back need no confirm.
4. Empty inbox keeps "Nobody wants your cards. Yet." and gains the Make an offer button beneath it.

Done when:
- lint/typecheck/test green; trade-builder.test.tsx covers step navigation, the 4-per-side cap, blocked cards not selectable, and the summary text.
- e2e/trades.spec.ts updated: composing posts the same recipientId/gives payload as before (keep the existing posted-body assertion); Accept requires the confirm; the signed-out redirect to /claim is unchanged.
- At 390px the give and get trays are stacked (assert the get tray's top is below the give tray's bottom).
- Screenshots of Who, trays, Review and an incoming offer at 390 attached.
```

### PR 9 — Navigation and profile

Branch `ux/09-nav-profile`. Title: **Five fixed tabs and a profile screen**.

```text
Goal: the tab bar never changes shape and every setting has one home. Implements §4 of docs/ux-audit-mobile.md.

1. src/lib/nav.ts: navTabs returns five tabs always — Vault (/players), Pack (/players/pack), Trade (/players/trade), League (/league), You (/you). Shop is no longer a tab; keep dustOn as an input only if a badge needs it. Update nav.test.ts (no 5↔6 reflow; activeTab rules unchanged; /players/shop lights Vault; /you lights You).
2. src/lib/league.ts: Board (/leaderboard) becomes the first hub tile; add a Shop tile (/players/shop) that exists only while dust is on. Update the hub test that guards against stranded screens.
3. Dust chip in the Today card keeps linking to /players/shop.
4. New src/routes/you.tsx: name and player code status (from useMemberSession and the claim helpers), account (sign in/out, reuse AccountMenu logic), streak ladder and history (from useStreak; history = milestones with claimed=true, each with the label; if PR 6 landed, show the card each paid), dust balance, sound (the mute toggle from card-sfx), haptics, tilt (gyro permission), the Admin link (PIN-gated route as today), and the collection numbers removed from the hero in PR 5. Title and meta like other routes. Header account icon links here.
5. site-nav.tsx: five columns, 11px labels, min-h-14 tiles; keep the two dots and their aria text; add the torn-pack glyph variant for the Pack tab while today's pack is mid-reveal (read the stored pack state the vault already reads).

Done when:
- lint/typecheck/test green; nav.test.ts and the league hub test updated; e2e/smoke.spec.ts renders /you and asserts aria-current on the You tab.
- e2e/dust.spec.ts: with dust on, the bar still has five tabs and Shop is reachable from the League hub and the dust chip.
- Screenshot of /you and the bar at 320 and 390 attached.
```

### PR 10 — Two-beat reveal and set mystery slot

Branch `ux/10-reveal-beat-mystery`. Title: **Two-beat reveal for special pulls; one mystery slot per set**.

```text
Goal: a good pull gets one more beat, and a set page has a horizon without a denominator. Implements the reveal pacing in §7 and the mystery slot in §9/§14 of docs/ux-audit-mobile.md. Do not change src/lib/stand-phase.ts or the ceremony table.

1. Two-beat reveal in src/components/pack-stand.tsx: for champion or podium tiers, Silver or better editions, and Rare or better secret levels, the flip lands on a face dimmed to 60% for 250ms, then the edition frame / prism ring blooms to full with the existing holo-shine sweep and the second cue (playEditionShine, or the secret's own chime) fires. Common pulls keep the current single beat. Reduced motion: no dim, one beat. The "known" guard stays: a card whose finish the server has not answered gets no second beat.
2. Mystery slot in src/routes/players.index.tsx: at the end of every open secret set shelf (not Favourites, not Complete, not the unsorted "Secrets" pile), render one face-down tile using the event's universal back with a "?" and the caption "More in this set". It is not a link, never counts toward the shelf's number, carries aria-hidden text only ("Unknown cards remain"), and is not rendered for a set that has a completion trophy. Add a comment explaining why this does not leak: one slot regardless of how many remain.
3. Set chip: print the set name (from the set list the vault already fetches, falling back to the shipped labels) as a small chip on secret captions in the viewer/sheet, trade tiles and shop rows, coloured with the set accent.

Done when:
- lint/typecheck/test green; pack-stand.test.tsx covers the two-beat path for a gold edition and the single beat for standard; players.index tests cover the mystery slot present on an incomplete set, absent on a completed one, and excluded from the count.
- e2e/secrets.spec.ts: the existing "no total, no empty slots" assertion is updated to allow exactly one "More in this set" tile per open set and still forbids /of \d+ secrets/.
- Screenshots of a set shelf and a gold reveal at 390 attached.
```

### Tool notes

- **Claude Code**: run from the repository root on a fresh branch; it reads `CLAUDE.md` automatically, and the guardrails block repeats the parts that matter. Ask it to run `/code-review` on its own diff before opening the PR. Keep one phase per session.
- **Lovable**: paste the guardrails and the phase prompt as one message. Lovable commits to the connected branch as it works, so add "work on branch `<name>` and do not push to the connected branch until I approve" and never let it rewrite history. Its preview will not show pack sounds or haptics; check those on a real phone after merge.
- **Codex**: same prompt. Codex may not read `CLAUDE.md`, so the guardrails block is load-bearing; add "run `bun run format && bun run lint && bun run typecheck && bun run test` and paste the output before finishing". Ask it for the 390 px screenshots explicitly; it will not attach them unprompted.
- **Any tool**: if a phase's "Done when" list cannot be met, the PR description must say which item was skipped and why, not silently narrow the scope.
