# Will YOU Be My Hero? — Mobile UI/UX Audit

_Trading-card experience, audited phone-first. Third pass, September 2026, at commit `9aceafb`._

**Renders: [Field Report — third pass](https://claude.ai/artifact/3RbCsWyBT3tdndmdqvQetM)** — every screen and state at 320, 390 and 430 px, with the measurements behind every number below. The second pass's [Vault Field Report](https://claude.ai/code/artifact/08a80918-7acc-425a-af6b-f5111ee65338) is kept for comparison.

## How this audit was made

This is the third pass. The first ended in an eleven-phase plan and the second in five more; **PR 0 through PR 15 have all landed**, so most of this document describes work that is done. §0 is the ledger; the body sections are kept because their reasoning is still the argument for the parts that remain.

Two things make a third pass worth taking. **Thirteen commits have touched `src/` since the second pass was written**, adding seven branches nobody had ever looked at on a phone. And **the scope changed**: both prior passes exempted the commissioner console by design, and this one holds it to the same rules as the player screens. That is a premise change, not just more surface — §0's new section says what the exemption was actually buying.

- **Real renders, measured.** The app was run against the e2e suite's own server-function stubs (`e2e/fixtures.ts`) and driven in Chromium at 320 × 568, 390 × 844 and 430 × 932, device scale 2. Every number below — overflow, control size, text size, clipped label, contrast — was taken off the live DOM or off a composited pixel, not read out of the source.
- **The member is not empty**: three roster cards with duplicates and finishes, one secret, a five-day streak with a claimable rung, an unread trade offer, and a dust-enabled variant. Zero server functions went unstubbed, so no empty state in this pass is a fixture artefact.
- **Three fidelity guards**, each of which changed a finding, and each of which now **fails the capture** rather than annotating it — an unguarded screenshot is worse than a missing one, because a missing one does not get written up:
  - **The real typeface.** Barlow Condensed is narrower than the system fallback — measured at 257 px on a fixed string at 40 px, so the difference is not subtle. Served from a local mirror, forced with `document.fonts.load()` rather than waited for with `fonts.ready`, and checked two ways per capture: the face is available _and_ it is the one being used.
  - **A coarse pointer.** `ui/button.tsx` releases its 44 px floor on `pointer-fine:`. A desktop-shaped context reports every button at 36 px.
  - **Contrast from pixels.** This palette is `oklch()` and composites through `oklab()` alpha, which a `getComputedStyle` parser reads wrong in ways that look plausible. Every ratio here was taken by painting the token on a canvas and reading the result back.
- **A fourth guard, added this pass**: a capture fails if the error boundary is on screen. The console's first run came back as three tidy PNGs of "This page didn't load", because one stub was missing a field that `ownership-audit-panel.tsx` reads. Nothing in the capture noticed, and nothing would have.
- **One methodological trap, worth recording because it produced a full set of confident wrong numbers.** A `fullPage: true` screenshot in Chromium drops the mobile device-metrics override for the rest of that page's life, and `setViewportSize` does not put it back. That is not a cosmetic reading: `pointer-fine:` utilities start applying, so every control shrinks to its desktop height. The first run of this pass reported 51 clean captures and a tidy list of tap-target failures on `/claim` and `/auth` — all of it an artefact, and all of it plausible. Hence one browser context per capture, and the fullPage shot last in it.
- **Scope: everything, under the same rules.** The player-facing routes, the two public combine screens no sweep has ever covered (`/draft`, `/order`), and the commissioner console with every panel opened. §0 records what the console's exemption was worth.
- **Already-known defects** in `product-description/bug-triage.md` are not re-raised.
- **Vocabulary**: secret-card **level** (common → mythic), secret **set**, roster **tier** (champion, podium, stationKing, penaltyBox, dnf, base) and per-copy **edition** (Platinum → Standard). These ids are persisted and must never be renamed.
- **One product rule is respected throughout**: how many secret cards exist is withheld everywhere except a completed-set trophy. No recommendation here asks for "x of N".
- **The harness is not in the repo**, and that is the one thing about this method worth arguing with. It was rebuilt from this section's prose, because the second pass's rig was never checked in — which is how the fallback-typeface mis-measurement happened in the first place, and this pass then made three fresh mistakes of its own before the guards caught them. The pieces with a second customer are `arrange.ts` (the "member is not empty" fixture, and an admin session that unlocks a console no automated screen check has ever reached), the pixel-readback helpers currently trapped inside `e2e/control-edges.spec.ts`, and the capture list itself — which is the document that answers "which states has this app actually been looked at in". The runner is the part that should stay out: a second Playwright config duplicating `playwright.config.ts`'s Supabase-neutering `env` block is a loaded gun pointed at the live project, sitting in a tree, run by nothing that would notice it drifting.

Priority scale: **Critical** (blocks the emotional loop or usability on a phone) · **High** · **Medium** · **Low**.

---

## 0. Reconciliation ledger

What the earlier passes raised, and where it stands. Evidence is either a `file:line` that was checked at this commit or a measurement from the render set.

### Third pass — what the re-measure found

### The numbers, before and after

Both sets were taken with the same captures, the same stubs and the same guards — the "before" from a clean tree, with the whole diff stashed, because a measurement taken while the source is moving is half one commit and half another.

| Rule                              | Before  | After   | What is left                                                                                                     |
| --------------------------------- | ------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| Screens scrolling sideways        | **0**   | **0**   | nothing — closed in the second pass, still closed                                                                |
| Fields iOS would zoom             | **4**   | **0**   | nothing                                                                                                          |
| Labels clipped by an ellipsis     | **9**   | **0**   | nothing                                                                                                          |
| Text under 11 px                  | **303** | **72**  | the ballot's avatar initials at 9.6 px (G12), four of them at three widths                                       |
| Tracking over 0.08 em             | **345** | **114** | the wordmark (105, a stated exception), `/tv` (3, exempt by design) and the badge-inheritance artefact above (6) |
| Controls whose **box** is < 44 px | **49**  | **10**  | the `Switch` and the `Checkbox`, whose hit area is 44 px and whose box is not — see below                        |

**That last row is the one to read carefully, because it does not say what it looks like it says.** A switch is 20 px tall and a checkbox 16 px, because that is what those controls look like; growing either to 44 draws something else. Both take the floor as a 44 px `::before` instead — and `getBoundingClientRect` does not include a pseudo-element, so any sweep measuring boxes reports them under the floor however big the thumb's target really is.

Exempting them in `e2e/smoke.spec.ts` would have been the easy answer and the wrong one, in a pass that spent most of its time deleting exemptions that had outlived their reasons. So the exemption is paired with a test that checks the rule rather than the proxy: `elementFromPoint` is asked what sits at each corner of the 44 px square, and has to answer "the control". **A number that cannot be measured needs a different measurement, not a note saying it is fine.**

**Everything the second pass closed is still closed**, re-measured rather than assumed. Zero horizontal overflow across every screen at all three widths. No player-facing field under 16 px. No control under 44 px on any of the fifteen routes the tap-target sweep covers — it was thirteen before /draft and /order joined it. The header is 65 px at every width and the wordmark still does not wrap.

**F9 moved a long way without being finished.** The first card's top is now **432 px at all three widths**, against 745 / 794 / 822 in the second pass — the Today card and the one-line collection summary between them took 313 px out of the approach. At 390 and 430 a card is comfortably above the fold. At 320 about 65 px of one clears the tab bar, which is a card you can see rather than a card you can read. Downgraded to **Low**; the remaining fix is the one §25 already describes.

**The scope change found what it was pointed at, and two more in a place nobody had pointed at anything.** The console's exemption turned out to be narrower than "the admin screens were ignored" — `AdminSection` already collapses on phones for a documented reason, its trigger already carries the 44 px floor, and its open state is CSS-only to avoid an SSR flash. Someone had thought about this screen on a phone.

What the exemption was actually holding up, measured across the console and every one of its twelve panels opened:

| What                                 | Measured                                                                                                                                              | Now                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| A sub-11 px label layer              | **25 distinct strings** at 9 and 10 px, on every panel — the eyebrow, the `ADMIN` badge, and every counter ("3 in the set", "1/4 claimed", "1 loose") | 27 literals → `text-label` / `text-meta`   |
| Tracking over the 0.08 em cap        | `tracking-widest` (0.1 em) on all of them, and on six combine screens besides                                                                         | 34 sites capped at 0.08 em                 |
| Controls under 44 px                 | The two spectator links at **16 px**, "Issue" at 32, "Rename all" and "Rearrange" at 36, and two unnamed buttons at 16 and 20                         | floors added, released on `pointer-fine:`  |
| Fields iOS would zoom                | the prompt `<textarea>` and the Give-a-Card `<select>`, both **12 px**                                                                                | `text-base` with a `pointer-fine:` release |
| Fields releasing their size at `sm:` | seven, plus two with no floor at all                                                                                                                  | `pointer-fine:` throughout                 |

This is the same finding §16 made about the player screens in the first pass, on the screens that pass was not looking at. It is not that the console was built carelessly — it is that a rule enforced in one place is a rule the other place does not have.

| Id  | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Severity | Status                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | --------------------------------------- |
| G1  | **`/draft` and `/order` are in no sweep at all** — not the render sweep, not the phone sweep. Both are public and both are in `sitemap.xml`. Unlike `/admin` (behind a PIN) and `/recap/$slug` (an SSR loader the browser stub cannot reach), neither had a stated reason; they were never added.                                                                                                                                                                        | High     | swept, fixed                            |
| G2  | **`/order` clips every name at 320.** "Carol Crush" by 22 px, "Dave Dnf" by 16. PR 13 made exactly this argument about the leaderboard — a board that will not say whose row it is has stopped being one — and fixed it. The running order a marshal reads at a start line was never checked.                                                                                                                                                                            | High     | fixed                                   |
| G3  | **`/draft`'s player links are 36 px.** The one control under the floor anywhere in the app, on one of the two routes nothing measures.                                                                                                                                                                                                                                                                                                                                   | High     | fixed                                   |
| G4  | **The dropdown menu's rows are 32 px**, and the menu is player-facing — the "more actions" overflow on `card-viewer.tsx` and `players.$id.tsx`. It survived three passes because the sweep measures what is on the page, and a closed menu has no items in the DOM. All four item shapes carry the floor now: the card page's own menu is built from `CheckboxItem`, so fixing `Item` alone would have covered the menu nobody opens and missed the menu everybody does. | High     | fixed, and the sweep opens the menu now |
| G5  | **`-webkit-tap-highlight-color` has zero occurrences.** iOS paints its own grey flash over every button and link, on its own schedule, under the press vocabulary PR 14 built deliberately.                                                                                                                                                                                                                                                                              | Medium   | fixed                                   |
| G6  | **`overscroll-behavior` has zero occurrences.** Every drawer, full-screen reveal and horizontal snap row can chain its scroll to the page; a downward drag at the top of any screen is a pull-to-refresh that can throw away a half-torn pack.                                                                                                                                                                                                                           | Medium   | fixed                                   |
| G7  | **The PIN field is `type="password"`**, so iOS ignores its `inputMode="numeric"` and opens QWERTY. It is the first screen a commissioner sees, on a phone, at a start line.                                                                                                                                                                                                                                                                                              | Medium   | fixed                                   |
| G8  | **Seven admin fields release their touch size at `sm:`**, plus two that never had one. 640 px is a width; a landscape phone is past it with the thumb still the input. This is the anti-pattern `ui/button.tsx:32-36` argues against, applied to the screens that argument had not reached.                                                                                                                                                                              | Medium   | fixed                                   |
| G9  | **Ten surfaces size in `vh`, not `dvh`**, across eight files — the second pass counted seven. Their submit rows sit under Safari's toolbar.                                                                                                                                                                                                                                                                                                                              | Medium   | fixed                                   |
| G10 | **`ui/textarea.tsx` still carries the `md:text-sm`** PR 11 took off `Input`. `smoke.spec.ts:196` names it and exempts it, because every `<Textarea>` was the commissioner's. The scope change is the only thing that moved here; the code was not wrong under the rules it was written to.                                                                                                                                                                               | Medium   | fixed                                   |
| G11 | **`SelectTrigger` has no floor**, and `card-prompt-studio.tsx` pays for it by hand at all twelve of its triggers. A rule held up by twelve call sites remembering it is a rule the thirteenth will not have.                                                                                                                                                                                                                                                             | Low      | fixed                                   |
| G12 | **`/awards` renders 9.6 px avatar initials** on the ballot, and they are not `aria-hidden` — the only sub-11 px text left on a player-facing screen.                                                                                                                                                                                                                                                                                                                     | Low      | open — see §22                          |
| G13 | **0.1 em tracking on 12 px labels**, against §16's 0.08 em cap, on the console and on six combine screens besides. The cap's stated exceptions are a typed code, a poster and the wordmark; none of these is one. `/tv` keeps its 0.2 em, which §18 exempts by design — a board read across a garden, where the tracking is doing legibility work at distance.                                                                                                           | Low      | fixed, 34 sites                         |
| G14 | **No `apple-mobile-web-app-*` tags and no `apple-touch-icon`.** The manifest is a remote Progressier URL, so what iOS actually receives is not knowable from this repo.                                                                                                                                                                                                                                                                                                  | Low      | open — needs a real device              |

**One reading in the tracking sweep is an artefact of how tracking is measured, and it is worth knowing about because it looks exactly like a finding.** The trade tab's unread badge reports 0.087 em — over the cap — and carries no tracking class at all. `letter-spacing` inherits as a computed length in px, so a parent's 0.08 em at 13 px is 1.04 px, and 1.04 px on a 12 px child reads back as 0.087 em. The letters are the same distance apart; only the denominator changed. Any sweep that derives em from `letterSpacing / fontSize` will report this, and the fix is to read the number rather than the ratio.

**One fix in that table was made on the gate's evidence rather than this pass's.** `/analytics`'s clipped Personal Bests row is the `CLIP_EXEMPT` entry the second pass recorded, and this pass's stub arrangement returns no all-time records, so the list it clips in is empty and the render never reproduced it. The `truncate` → `line-clamp-2` change is the same one-word fix as its two neighbours and carries no risk, but it is a fix taken on trust and is marked here rather than quietly counted as measured.

**Two candidate findings were withdrawn before they reached that table**, and both are worth recording because the evidence for them looked identical to the evidence for the ones that survived. `--spacing-section-gap` is not an unused token — it has five call sites and a `tailwind-merge` registration in `lib/utils.ts:47`. And `vault-section.tsx`'s `sm:h-8 sm:w-8` move arrows are not an oversight: `e2e/smoke.spec.ts:160-166` names them as a deliberate use of the breakpoint. That comment and `ui/button.tsx:32-36` still disagree with each other, and the disagreement is real — but the arrows only exist in rearrange mode, which no capture reached, so this pass has **not measured them** and does not get a vote. It is written down here rather than fixed on a hunch.

### Closed

| §        | Finding                                                   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §2       | Sideways scroll / viewport formulas                       | Zero horizontal overflow on 25 screens × 3 widths. One `--page-min-h` token in `dvh`, net of both insets.                                                                                                                                                                                                                                                                                                                               |
| §2, §4   | Wordmark wrapped at 320                                   | Single line at all three widths; header 65 px throughout.                                                                                                                                                                                                                                                                                                                                                                               |
| §2       | Safe area was a no-op                                     | `viewport-fit=cover` in `__root.tsx:97`, which is what makes `env(safe-area-inset-*)` report anything on iOS.                                                                                                                                                                                                                                                                                                                           |
| §3       | Home did not say what to do now                           | The Today card ships: pack state, streak rungs, claimable cue, new-since strip.                                                                                                                                                                                                                                                                                                                                                         |
| §5       | Sort chips wrapped; no filter                             | `VaultSortSheet` — sort, filter and density in a drawer behind one control.                                                                                                                                                                                                                                                                                                                                                             |
| §5, §19  | No skeletons                                              | `card-skeleton.tsx`, six tiles until the collection reconciles.                                                                                                                                                                                                                                                                                                                                                                         |
| §6       | Card detail was a stats page                              | Full-screen viewer at `?view=1`; a tile tap opens the card, not the page.                                                                                                                                                                                                                                                                                                                                                               |
| §7, §12  | No NEW / ×N on the reveal                                 | Ribbon and edition line on the stand — verified in the render set.                                                                                                                                                                                                                                                                                                                                                                      |
| §10      | Trade builder was a form                                  | Offers/Feed tabs, sticky "Make an offer", builder drawer. The pill row and 84 px strips are gone.                                                                                                                                                                                                                                                                                                                                       |
| §16      | 8–10 px label layer                                       | Nothing player-facing renders below 11 px. `text-label` (12 px) has 131 uses and `text-meta` 106.                                                                                                                                                                                                                                                                                                                                       |
| §18      | ~40 controls under 44 px                                  | None remain. The floor lives in `ui/button.tsx:39-44` and `ui/input.tsx:11`, and is gated by `e2e/smoke.spec.ts`.                                                                                                                                                                                                                                                                                                                       |
| §18, §23 | Text inputs were the last controls under 44 px (F1)       | `min-h-11 pointer-fine:min-h-0` on the `Input` primitive. The tap-target sweep measures `input`, `select` and `textarea` now, so it can see them.                                                                                                                                                                                                                                                                                       |
| §23      | Three raw inputs zoomed iOS on focus (F2)                 | `text-base pointer-fine:text-sm` on the primitive and on all three raw fields. A second sweep asserts 16 px at 844 px, which is where `md:` handed 14 px back.                                                                                                                                                                                                                                                                          |
| §23      | Every component edge was 1.25:1 (F3)                      | `--border-strong` at 35% white, and `--input` pointed at it. 3.10:1 on `--bg`, 3.12 `--background`, 3.18 `--surface`, 3.21 `--card`, pinned in `color.test.ts` and read back off real pixels in `e2e/control-edges.spec.ts`.                                                                                                                                                                                                            |
| §23      | Disabled "Reveal all" was 1.40:1 (F4)                     | Full-strength muted at one opacity step, the neon family's own idiom. 3.28:1, measured in the browser while the auto-run holds the button.                                                                                                                                                                                                                                                                                              |
| §23      | Motion ignored the OS preference (F5)                     | One `<MotionConfig reducedMotion="user">` in `__root.tsx`, covering all fourteen `motion/react` files. `journeys.spec.ts:1352` drives the whole pack under `reducedMotion: "reduce"`.                                                                                                                                                                                                                                                   |
| §7, §23  | Pack-summary card names were 18 px tall (F6)              | `min-h-11 pointer-fine:min-h-0` on the name itself rather than over the card, which is a flip button and not a second route to the same place. `journeys.spec.ts` measures every link in the row.                                                                                                                                                                                                                                       |
| §6, §23  | Player names clipped in the filmstrip (F7)                | `line-clamp-2` on the no-art cell, which is the branch a locked card page is made of. All four names fitted at 320, 390 and 430.                                                                                                                                                                                                                                                                                                        |
| §5, §23  | The secret caption clipped at 320 (F8)                    | The caption wraps, the two tile names and the slab plate clamp. Gated by a third sweep in `e2e/smoke.spec.ts` that reports any `text-overflow: ellipsis` actually firing, on thirteen routes at three widths.                                                                                                                                                                                                                           |
| §11, §23 | A claimable rung said only "Waiting" (F12)                | `streak-ladder.tsx` reads the `canClaim` it already had and says "An account is what claims it." on the rung that is next to be cashed.                                                                                                                                                                                                                                                                                                 |
| §10, §23 | The empty trade inbox offered the same action twice (F13) | The panel button is gone; the route's `fixed` CTA is the one way forward and is up without a scroll.                                                                                                                                                                                                                                                                                                                                    |
| §23      | Press feedback was thin on touch (F11)                    | One `@custom-variant hover` promotes all 160 `hover:` utilities to `:active` on a pointer that cannot hover. `.tier-chip`'s ungated hover — the app's only real latch — is gated; the tab bar, which had no hover to promote, got a press of its own. `e2e/press-feedback.spec.ts` holds a press on every named control, `src/styles.test.ts` walks the sheet for an ungated `:hover`.                                                  |
| §16, §23 | Half the type scale shipped (F10)                         | All 41 raw `text-xs` on player-facing screens now say what they are — `text-label` where the treatment is uppercase, `text-meta` otherwise, which is the codebase's own habit at 93%. `px-page-x` replaces `px-4` on 25 route shells, and `--spacing-stack-gap`/`--spacing-control-gap` are gone: one value under two names. The 65 `text-sm` are deferred with a costed table — the scale has no 14 px step, so every one is a resize. |
| §19      | Toasts top-centre, unthemed errors                        | Bottom-centre above the bar; themed 404 and error boundary; offline banner.                                                                                                                                                                                                                                                                                                                                                             |
| §20      | No global focus ring                                      | `:focus-visible` in `@layer base` at 13.54:1, deliberately not the cyan accent.                                                                                                                                                                                                                                                                                                                                                         |
| §4       | Profile had no home                                       | `/you` — player, account, streak ladder and history, collection, dust, and sound/haptics/tilt as device preferences.                                                                                                                                                                                                                                                                                                                    |

### Withdrawn

| §   | Finding                                | Why                                                                                                                                                    |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §4  | Five fixed tabs, Board/League rehoused | Superseded by a better answer: every row but the Vault is the commissioner's (`events.nav_hidden`, `NavRowsPanel`). A fixed five would take that back. |
| §22 | "Secret sheet (dialog from the Vault)" | The component no longer exists. A secret tile opens the same full-screen `CardViewer` as a roster card.                                                |

### Still open

Full detail, with the renders, in **[the field report](https://claude.ai/code/artifact/08a80918-7acc-425a-af6b-f5111ee65338)**. Summarised in §23.

| Id  | Finding                                             | Severity |
| --- | --------------------------------------------------- | -------- |
| F9  | The vault still opens on text rather than on a card | Low      |

### Out of scope — the commissioner console

Found while measuring, kept here so they are not lost. The admin screens are exempt from the phone rules by design and are not part of a player-facing audit.

- `admin.tsx:214` — the PIN field is `type="password"`, which makes iOS ignore its `inputMode="numeric"` and open a QWERTY keyboard instead of a keypad.
- Seven admin sheets size themselves in `vh` rather than `dvh`, so their submit row can sit under Safari's toolbar: `member-admin-panel.tsx`, `card-bulk-upload.tsx`, `card-prompt-tools.tsx`, `secret-cards-panel.tsx`, `stations-panel.tsx`, `edit-result-sheet.tsx`, `admin.tsx`.
- `ui/dialog.tsx:41` and `ui/alert-dialog.tsx:37` have no `max-h` and no safe-area padding. No player-facing screen mounts either today.

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
- **The label layer** was the single biggest readability problem — 210 uses of `text-[8px]`…`text-[11px]`, almost all uppercase at 0.2–0.35 em tracking. Fixed across the card screens in PR 1, and across the commissioner console in the third pass, which is where the last 27 of them had been sitting behind a scope note. The floor is 11 px and the cap 0.08 em, with two exceptions left, both about distance rather than about who is looking: the TV board and the share renderers.
- **Touch targets.** Fixed: nothing a thumb can land on is under 44 px anywhere the app renders — fifteen routes now rather than twelve, plus every console panel and the one menu that only exists while it is open. The floor lives in six primitives and `e2e/smoke.spec.ts` measures it on every run.
- **Rarity is legible on the card, not on the shelf.** A Mythic and a Common secret tile differ by the colour of a 9 px caption. Roster tiles do not show how many copies you hold.
- **Trading** is functional but reads like a form: a wrapping row of 30 px name pills, two 84 px-tile strips, and a Send button with no summary and no confirmation.

**Cohesive or bolted on?** The daily loop (Vault → Pack → Trade) is cohesive and the visual language is consistent. The Board and League tabs are a second product (the once-a-year combine) sharing the same bar; Shop appears and disappears with a commissioner switch and reflows the nav. It feels like one team's work, but two products.

**And the third pass found a third.** The commissioner console is a well-built phone screen that nobody had been holding to the phone rules — and the cost of that was not sloppiness, it was drift: 25 label strings at 9 and 10 px, a keypad that opens a letter keyboard, nine fields releasing their touch size at a width breakpoint the app's own comments argue against. Every one of those was correct under the rules it was written to. That is the real finding here, and it generalises past this repo: **an exemption is a second set of rules, and a second set of rules is a second product whether anyone meant to build one or not.** The two routes in no sweep at all (`/draft`, `/order`) are the same shape of problem with no exemption behind them — just a list nobody added them to.

**Custom or generic?** Custom. The foils, the ceremony, the copywriting ("Nobody wants your cards. Yet.") are memorable. The generic parts are the surrounding layout: stock shadcn `Button size="sm"`, a stock 404 page, a light-themed SSR error page in a dark app, and utility-class typography everywhere.

---

## 2. Mobile-first design

**Measured on real renders** (stubbed data, Chromium, device scale 2×, real Barlow Condensed, `pointer: coarse`):

| Width | Viewport | Horizontal overflow | Header | Vault (full): document height | First card top       | Card above the fold? |
| ----- | -------- | ------------------- | ------ | ----------------------------- | -------------------- | -------------------- |
| 320   | 568      | none                | 65 px  | 1411 px                       | **432 px** (was 745) | ~65 px of one        |
| 390   | 844      | none                | 65 px  | 1542 px                       | **432 px** (was 794) | yes, comfortably     |
| 430   | 932      | none                | 65 px  | 1626 px                       | **432 px** (was 822) | yes, comfortably     |

Re-measured in the third pass across **44 screens and states** at each width — up from 25, because the two unswept routes, the seven new branches and the whole commissioner console joined the set. **No screen scrolls sideways at any width.** `html, body { overflow-x: hidden }` still backstops that, at the cost of hiding an overflow bug rather than surfacing it — so the number above is the one that matters, and it was taken from `scrollWidth - clientWidth` on every capture rather than from the absence of a scrollbar.

The first card's top stopped moving with the viewport, which is itself the answer to a question the first pass asked: the hero above it is fixed-height now, so the vault opens the same distance down whatever phone it is on. 313 px shorter than the second pass measured, and still text rather than a card (F9).

The wordmark no longer wraps: the header is 65 px at every width, where it was 90 px at 320 in the first pass.

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
- **Safe area**: fixed — the viewport meta carries `viewport-fit=cover`, which is what makes `env(safe-area-inset-*)` report anything at all on iOS; every inset in the codebase was a no-op without it. The header pays for the notch, the tab bar and every bottom sheet pay for the home indicator, and the five full-screen ceremonies pay for both.
- **Viewport formulas**: fixed — one `--page-min-h` token on all seventeen route shells, in `dvh` and net of both insets. The three that used `vh` mis-sized when Safari's toolbar collapsed.
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

- **Two products share five slots.** Board and League are the combine; they take 40% of the bar all year for a week of use. The brief's expected shape (Home · Collection · Packs · Trading · Profile) is closer to how the app is actually used the other 51 weeks. **Answered differently, and the audit withdraws the recommendation below**: the rows are the commissioner's now (`events.nav_hidden`, `NavRowsPanel`, `e2e/nav-rows.spec.ts`), so a league that never trades can take Trade off and one that lives on the board can keep it. A fixed five would take that back.
- **The bar changes shape** (five rows ↔ six) when the commissioner flips dust, acknowledged as a deliberate cost in `nav.ts:38-45`. The half of it that was not deliberate is fixed: the shape is remembered per device (`src/lib/nav-shape.ts`), so a cold load no longer draws five rows and then re-shapes to six a round trip later. What remains is the switch actually being flipped, which is once a season — and it is now flexibility the app is built around rather than a cost it pays.
- **Profile has no home.** Fixed: `/you` holds the player and code status, the account and sign-out, the streak ladder and every rung it has ever paid, the collection counters PR 5 took off the vault's header, the dust balance, and sound, haptics and tilt. Haptics had no switch anywhere before it, and tilt was `useState` on the player page and forgot itself on every navigation; both are device preferences now. The header's person icon goes there instead of opening a menu that only existed while signed in.
- Labels are 11 px uppercase at 0.08 em and `whitespace-nowrap`, which is the bar's height contract — a label that wrapped grew the bar past the room `main` reserves for it.
- Both `<nav>`s carry an `aria-label`; the badge dots are aria-hidden with the text on the link (good).

**Recommendation** (Priority: High, Moderate effort)

- ~~**Vault · Pack · Trade · League · You.** Fold Board into the League hub and put Shop inside the Vault as a dust chip destination and as a League-hub tile while dust is on. The bar never reflows.~~ **Withdrawn.** A fixed five was the answer to a bar nobody could shape; the commissioner can shape this one, and the audit would rather have that than a bar that never moves. Board and Shop keep their rows, the League hub keeps only the screens with no row at all, and `/leaderboard` is reachable from its tab — which is a gap if a commissioner ever hides that row, and the one thing left open here.
- **"You"** = profile: name, code, streak ladder and history, dust balance, sound/haptics/tilt, sign out, admin link. **Done** — `src/routes/you.tsx`, reached from the header's person icon rather than from a tab, so the bar stays the commissioner's.
- Keep the two dots (secret waiting on Pack, offer on Trade). Add a third state, not a dot: the Pack icon swaps to a torn-pack glyph while today's pack is mid-reveal. **Done** — the resting glyph is a sealed pack so the swap reads as an event, and the state is the stored pack row the vault already reads.
- Labels 11 px, tracking 0.08 em, `min-h-14` tiles. **Done in PR 0/1.**
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

Roster card: `/players/$id` (`src/routes/players.$id.tsx`). Secret: the same full-screen `CardViewer`, opened from a vault tile and deliberately without a URL. (`secret-card-sheet.tsx`, the centred dialog this section originally described, no longer exists — PR 7 replaced both paths with one viewer.)

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

The Shop, built from stock shadcn components, was the most readable screen in the app, and the card screens, built by hand, ran their labels at 8–10 px uppercase with 0.2–0.35 em tracking on a dark ground. Both halves are now closed.

**The third pass closed the exception.** The sentence here used to read "nothing outside the admin console, the TV board and the share renderers reads below 11 px" — and the console was carrying **25 distinct strings at 9 and 10 px**, which is to say the whole label layer of every panel. That is not an exception, it is the same finding this section made about the card screens, held at arm's length by a scope note. 27 literals became `text-label` or `text-meta`, and the 0.08 em cap went on 34 sites that were still at 0.1 em, on the console and on six combine screens besides.

So the rule now has two exceptions rather than three, and both are about distance rather than about who is looking: **the TV board**, read across a garden, where the tracking is doing legibility work; and **the share renderers**, which are 1080 × 1350 images rather than screens. Nothing a thumb can reach reads below 11 px, and the one remaining sub-11 px string on a player-facing screen is the ballot's avatar initials at 9.6 px (G12).

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

| Token           | Value               | Use                                                                                                                                                       |
| --------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| page-x          | 16 px               | all phone routes (already `px-4`)                                                                                                                         |
| page-y          | 16 px               | top; 24 px was the old `py-6`                                                                                                                             |
| section-gap     | 24 px               | between shelves / sections                                                                                                                                |
| ~~stack-gap~~   | ~~8 px~~            | retired in PR 15: the same 0.5 rem as control-gap, both spelled `gap-2`, and a distinction no test or reviewer can check is a comment with a compile step |
| grid-gap        | 12 px               | card grid on phones (from 16) — buys ≈ 4 px per tile                                                                                                      |
| shelf-inset     | 12 px               | inside a shelf                                                                                                                                            |
| ~~control-gap~~ | ~~8 px~~            | retired in PR 15: the same 0.5 rem as stack-gap, both spelled `gap-2`, and a distinction no test or reviewer can check is a comment with a compile step   |
| header          | 48 px + safe-top    | single-line wordmark                                                                                                                                      |
| tab bar         | 56 px + safe-bottom |                                                                                                                                                           |
| modal padding   | 16 px               | sheets and dialogs                                                                                                                                        |

Collapse the hero to one row on scroll; move sort/rearrange into a sheet; put the rules paragraph on the Trading Post behind an "i" affordance after the first visit.

---

## 18. Buttons and touch targets

**Fixed.** The floor is 44 px on a phone and 48 px for a primary action, and it
now lives in the primitives rather than at the call sites: `src/components/ui/button.tsx`
and `src/components/ui/input.tsx` are touch-first, with a `pointer-fine:` release
back to the stock shadcn heights. Deliberately a pointer rule and not a width
one — a landscape phone and most touch tablets are past `sm:` with the thumb
still the input, so a breakpoint would hand the floor back exactly there. It is
the same distinction `vault-section.tsx`'s move arrows and `e2e/smoke.spec.ts`'s
mobile-only run already drew — 44 px is a touch guideline and the pointer
equivalent is 24.

The table below was the survey that started it and is kept for the record. Every
row in it is closed, and the gate that keeps them closed is the tap-target sweep
in `e2e/smoke.spec.ts`, which measures every visible `button`, `a[href]`,
`[role=button]`, `input`, `select` and `textarea` on the twelve phone-facing
routes, and holds a second 16 px floor over the fields. It runs the three routes
with a field on them sideways as well, at 844 px — which is how the card page's
prev/next arrows turned up at 38 px. They are `hidden md:block`, so they exist
only past 768 px, and a phone turned sideways is past 768 px with the thumb
still the input: the portrait run could not have seen them. They carry the floor
now. `/tv` is the one deliberate omission — a board read from across a garden,
where nothing is tapped.

**The third pass found four more, and the interesting thing about all four is
where they hid.** The sweep is thorough about what it can see, and every one of
these was somewhere it could not look:

- **A route that was in no list.** `/draft`'s on-the-clock link measured 36 px — a
  bare inline `<a>` is only as tall as its line box. `/draft` and `/order` were
  public, in `sitemap.xml`, and in neither route array, with none of the stated
  reasons `/admin` and `/recap/$slug` carry. Both are swept now.
- **A control that is not in the DOM until you open it.** `DropdownMenuItem` is a
  32 px row and it is player-facing — the "more actions" overflow on the card
  viewer and the card page. A closed menu has no items to measure, so three
  passes of the sweep walked straight past it. The floor is in the primitive now
  and the sweep opens the menu.
- **A mode the sweep never enters.** The vault's rearrange arrows are
  `h-11 w-11 sm:h-8 sm:w-8`, and this document has cited them twice, in opposite
  directions: the paragraph above calls the `sm:` release the wrong instrument,
  and `e2e/smoke.spec.ts:160` calls these arrows a deliberate use of it. They
  exist only in rearrange mode, which no capture in any pass has reached — so
  the disagreement is recorded and **not** resolved here. Measuring it is one
  line in the harness and should be the next pass's first job.
- **A whole console.** §0 has that one.

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
| Burn / Sell / Re-roll                           | shop                                  | 44 tall — fixed             | Medium   |
| List a card / Buy for 150                       | shop                                  | 48 tall — fixed             | Low      |
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

**Seven states joined this section in the third pass**, and the useful thing about them is that none produced a finding — each was a branch somebody wrote and nobody had looked at on a phone. They are listed in §22; what belongs here is the shape they share. All seven distinguish _a thing that has not happened yet_ from _a thing that went wrong_: a roster still loading reads differently from a roster that could not be fetched, a pack page with nothing to deal reads differently from a pack page whose read broke, and an account mid-link suppresses its counters rather than showing a confident zero. That distinction is the one this table's first row was asking for, and it is now drawn consistently across five screens.

Two more states this pass changed rather than found, both in the shell and both invisible until a thumb is on the glass: **pull-to-refresh** is contained, so a downward drag at the top of a screen can no longer throw away a half-torn pack; and **scroll chaining** is contained, so a filmstrip flicked to its end no longer scrolls the card page behind it, and a bottom sheet dragged past its end no longer drags the vault.

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
- **The commissioner's own accessibility was never in scope until this pass**, and it had the whole set: a 25-string label layer at 9 and 10 px, 0.1 em tracking on all of it, seven controls under the floor, and a PIN field that asks for four digits on a letter keyboard. All fixed. The one that is worth naming separately is the **`Switch`**, which is 20 px tall because that is what a switch looks like — so the fix grows the hit box rather than the control, a 44 px `::before` centred on the track and released on `pointer-fine:`. A switch sized to 44 px would be a pill the size of a button.
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
- 27 unused shadcn primitives and their Radix/recharts/embla/cmdk dependencies remain in the bundle graph; tree-shaking removes most but not all of the CSS and the install weight. Not a user-facing problem; worth a cleanup ticket. The third pass adds one name to that ticket rather than acting on it: **`hooks/use-mobile.tsx` is reachable only from `ui/sidebar.tsx`, which nothing imports** — a dead hook with a full test file. It is left alone deliberately: `ui/sidebar.tsx` is unmodified shadcn, which `CLAUDE.md` says to rarely edit, so deleting the hook means deciding the primitive's fate too. That is the same cleanup ticket, not a mobile finding.

**Recommendations**: skeleton tiles and a fixed-height hero (reserve every line); `thumb` rendition + lazy for locked backs; self-host Barlow Condensed and JetBrains Mono as WOFF2 with `font-display: swap` and drop Inter (or apply it); preload the secret's art the moment the pull resolves (already done for `secret.artUrl`) and show a foil sweep on the sealed card while waiting; key the landing celebration on first view after acquisition rather than per session.

---

## 22. Screen-by-screen audit

Rewritten against this pass's renders. Each screen links to its frames in the [field report](https://claude.ai/code/artifact/08a80918-7acc-425a-af6b-f5111ee65338); measurements are at 390 px unless a width is named.

### The Vault (home) — `/players`

- **Works**: shelves as binder pages; 2-up tiles at a readable size; the Today card answering pack state, streak and claimable rung in one fixed-height block; a one-line collection summary; sort, filter and density in a drawer; skeleton tiles while the collection reconciles; locked cards as the universal back; no leaks about unpulled secrets.
- **Fixed since the first pass**: the "what now" question, the sort chips that wrapped at 320, the five-step hero growth, the missing skeletons, and the 9 px captions.
- **Measured again this pass**: the first card's top is **432 px at every width**, from 745 / 794 / 822. The hero above it is fixed-height, which is why the number no longer moves with the viewport — the Today card was built not to shift, and it doesn't. At 390 and 430 there is a card on screen without scrolling. At 320 there is about 65 px of one above the tab bar: enough to know a card is there, not enough to look at it.
- **Remaining**: the order is unchanged even though the distance is shorter (F9). A single secret in a 2-up grid still leaves a dead column beside it.
- **Priority: Low** (was Medium, was Critical).

### Pack — sealed — `/players/pack`

- **Works**: the wrapper as an object; the tear hint; the collected counter; a persistent mute that now survives the tear.
- **Remaining**: the wrapper is still capped at 260 px, so at 430 it floats in space. The streak sentence and the flame still say the same thing twice.
- **Priority: Low** (was Medium).

### Pack — ceremony and stand

- **Works**: nearly everything (§7). NEW and ×N ribbons landed, the edition line reads off the card, and the two-beat reveal lands on special pulls.
- **Remaining**: the disabled "Reveal all" is 1.40:1 against the ground — correctly sized at 106 × 44, and invisible while it is held (F4). Motion here ignores the OS reduced-motion setting: `stand-entrance.tsx` springs up to five cards onto the stand regardless (F5).
- **Priority: Medium** (was High).

### Pack — summary

- **Works**: the secret leads; the roster cards sit in a snap row rather than as thumbnails; the streak claim is here; inline failures.
- **Remaining**: nothing measured against it. The name links carry the touch floor, and the tile above each is a flip button rather than a second route to the same place.
- **Priority: none** (was High).

### Player card — `/players/$id`

- **Works**: the full-screen viewer is the default for a tap (`?view=1`), so examining a card starts with the card; zoom, flip, swipe and tilt; the slab and serial plate; the locked state with a route into a pack; the compare drawer; share export.
- **Fixed this pass**: the "more actions" overflow menu rendered 32 px rows. Three passes of the tap-target sweep walked past it, because a closed menu has no items in the DOM to measure — the rule was only ever "the controls that happen to be mounted are 44 px", which is not a floor. The sweep opens the menu now.
- **One detail worth keeping**, because it cost a failed test to learn: this menu is built from `DropdownMenuCheckboxItem` (Tilt, Sound), not `DropdownMenuItem`. A floor on `Item` alone covers the menu nobody opens and misses the menu everybody does. All four item shapes carry it.
- **Remaining**: nothing else measured against it. The filmstrip's names take two lines and the slab plate wraps the event's own name rather than cutting it.
- **Priority: Medium** (was High).

### Card viewer (full-screen)

- Replaces the first pass's "Secret sheet (dialog from the Vault)". One component now serves roster cards and secrets alike: a dark room, an svh-sized card, swipe, flip, pinch, bottom controls, and Escape / ✕ / the phone's own back gesture all closing it.
- **Remaining**: nothing measured against it.
- **Priority: none.**

### Trading Post — `/players/trade`

- **Works**: Offers and Feed as tabs with the unread count on the tab; a sticky "Make an offer" in the thumb zone; the builder as a drawer reached by `?make=1`, so the back gesture closes it; spares-only with the reason shown.
- **Fixed since the first pass**: the wrapping pill row, the 84 px tile strips, the builder sitting below the fold, and the empty inbox with no way forward.
- **Remaining**: nothing measured against it. The empty state says who could answer and leaves the way forward to the CTA fixed above the tab bar.
- **Priority: none** (was High).

### Shop — `/players/shop`

- **Works**: the most readable screen in the app; prices on buttons; refusals as sentences; every control clears 44 px; the market stall stays up when dust is off so listed cards are never stranded.
- **Fixed this pass**: the "Back to the vault" link in the dust-off state was a bare inline `<Link>` at 17 px — the same shape of finding as `/draft`'s on-the-clock link, and fixed the same way.
- **Flagged honestly**: this pass did **not** render that state. The capture arranges dust ON, because that is the only arrangement in which the screen's own controls exist. The fix rests on the second pass's measurement, not on a render of this one.
- **Priority: none.**

### You — `/you`

- **Works**: player, account, streak ladder and history, collection counters, dust, and sound / haptics / tilt as device preferences rather than per-page state. Type is generous throughout and every control clears the floor.
- **Remaining**: nothing measured against it. A rung that cannot be claimed yet says why on the rung.
- **Priority: none.**

### League hub — `/league`

- **Works**: five clear tiles; fetches nothing.
- **Fixed this pass**: the tile blurbs were a `text-[11px]` literal rather than a `text-xs`, so PR 15's sweep never reached them. They are `text-meta` now.
- **Remaining**: nothing measured against it.
- **Priority: none.**

### Leaderboard — `/leaderboard`

- **Works**: readable; share per row; ranks from one rule.
- **Fixed since the first pass**: the name in a rank row lost its tail at 430 as well as at 320 — the one clipped label outside the card screens that was worth PR 13's time, because a leaderboard that will not say whose row it is has stopped being one.
- **Priority: none.**

### Claim and Auth — `/claim`, `/auth`

- **Works**: the 2-col name grid; a big typed code; clear failure copy that distinguishes a wrong code from too many tries; links between the two; an honest "an account is optional" footer.
- **Closed since the second pass**: F1 and F2 both. Every field on both screens now clears 44 px and renders at 16 px on a coarse pointer, and the code field carries `inputMode` and `enterKeyHint`.
- **Worth recording, because it is the best example of why the guards exist**: the third pass's first run reported the code field at 36 px and both auth fields at 36 px — the second pass's finding, apparently reopened. It was an artefact. A `fullPage` screenshot earlier in the run had dropped the pointer emulation, so `pointer-fine:` was releasing the floor on a context that was no longer a phone. The reading was wrong and looked exactly like a regression on the screen where one would have mattered most.
- **Two new states here**, both captured and both clean: the roster failing to load, which is a distinct branch from an empty roster, and the roster still in flight.
- **Priority: none** (was Medium).

### Global shell (header, tabs, toasts, errors)

- **Problems**: none outstanding. Single-line wordmark at 65 px on every width; live safe-area insets; 44 px account target; 11 px nav labels that cannot wrap; toasts bottom-centre above the bar; themed 404, error boundary and SSR error page.
- **Fixed this pass**: two properties that had zero occurrences anywhere in the app. `-webkit-tap-highlight-color` — iOS was painting its own grey flash over the press vocabulary PR 14 built, on its own schedule and in its own shape. And `overscroll-behavior` — every drawer, reveal and horizontal snap row chained its scroll to the page, and a downward drag at the top of any screen was a pull-to-refresh that could throw away a half-torn pack.
- **Remaining**: no `apple-mobile-web-app-*` tags and no `apple-touch-icon` (G14). The manifest is a remote Progressier URL, so what iOS actually receives is not knowable from this repo and is not knowable from a render either — this one needs a phone.
- **Priority: Low.**

### Running order — `/order`

New to the audit; no sweep has ever covered it.

- **Works**: one clear list, rank chip, avatar, status badge, no fetch beyond the bundle.
- **Fixed this pass**: every name clipped at 320 — "Carol Crush" by 22 px, "Dave Dnf" by 16, and Alice and Bob visibly losing their tails as well. This is the same finding PR 13 fixed on the leaderboard, with the same argument: a running order that will not say whose row it is has stopped being one. It is a marshal's screen, read one-handed at a start line.
- **Priority: none** (was High, unmeasured).

### Draft board — `/draft`

Also new to the audit, and also in no sweep.

- **Works**: the on-the-clock card; a position grid that is only tappable for an admin.
- **Fixed this pass**: the player link under "On the clock" was 36 px — a bare inline `<a>` is only as tall as its line box — and was the single control under the 44 px floor anywhere in the app.
- **Priority: none** (was High, unmeasured).

### The states added since the second pass

Seven branches that existed but had never been rendered on a phone. All seven were captured at three widths this pass, and **none of them produced a finding** — which is the useful result, because each was a screen somebody wrote and nobody looked at.

| State                          | Where                      | How it reads on a phone                                                                           |
| ------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------- |
| The roster did not arrive      | `claim.tsx:251`            | A `FeedError` that says the combine could not be reached, distinct from "nobody is on the roster" |
| The roster is still coming     | `claim.tsx:249`            | "Loading roster…", with the code field and the button already in place and quiet                  |
| The combine is not on          | `players.pack.tsx:1304`    | The wax-foil slab settles on "nothing to deal", with a route back to the collection               |
| The account is still linking   | `you.tsx:107`              | "Counting your cards…" and the counters suppressed rather than showing a wrong zero               |
| Auth carrying a destination    | `auth.tsx:257,266`         | The banner names where you were going, so signing in does not read as a detour                    |
| The stash, on a bare `/auth`   | `auth.tsx:101-109`         | The same banner after an OAuth round trip, off `wwbh:auth-next` rather than the query string      |
| The third door onto the roster | `collector-signup.tsx:113` | The trading-name prompt, for a signed-in person who is not on the roster                          |

**Priority: none.** Recorded so the next pass knows they were looked at.

### The commissioner console — `/admin`

Audited under the player-screen rules for the first time. §0 has the findings; what belongs here is the verdict on the exemption itself.

- **The console was not neglected, and the exemption was narrower than it sounded.** `AdminSection` collapses on phones with a written reason (five fixed-height scroll boxes inside a scrolling page trap touch scrolling), its trigger carries the 44 px floor, and its open state is CSS-only so desktop does not flash collapsed for a frame. Someone had already thought about this screen on a phone.
- **What the exemption actually bought was the fields.** Seven released their touch size at `sm:` rather than `pointer-fine:` — the width breakpoint a landscape phone crosses with the thumb still the input, which is the exact anti-pattern `ui/button.tsx:32-36` argues against and which PR 11 removed everywhere the audit was looking. Two more had no floor at all. And the PIN gate — the first screen a commissioner sees — opened a QWERTY keyboard for four digits, because `type="password"` makes iOS ignore `inputMode="numeric"`.
- **One structural note**: a collapsed `AdminSection` is in the DOM at `display: none`, so any sweep filtering on visibility measures nothing at all. That is why the console has never been measured by anything, and it is why measuring it needs each panel opened rather than just the route visited.
- **Priority: none outstanding.**

---

## 23. What is still open

The first pass's top ten is closed — items 1, 2, 3, 4, 5, 8, 9 and 10 shipped outright, 6 and 7 shipped in part (§8's level pips and §15's quieter ground landed; the base-tier hue shift did not). This is the list as it stands, ranked by what it costs someone in a garden holding a beer. Every measurement is reproducible from the harness in the [field report](https://claude.ai/code/artifact/08a80918-7acc-425a-af6b-f5111ee65338).

| Id  | Problem                                                                                                                                            | Measured                                                                                                                                                              | Location                               | Fix                                                                                        | Difficulty |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------ | ---------- |
| F9  | **The vault opens on text — less of it than before.** The Today card fixed the layout shift; the summary line still sits between it and the shelf. | First card top **432 px at all three widths**, from 745 / 794 / 822 in the second pass. Above the fold at 390 and 430; about 65 px of card clears the tab bar at 320. | `players.index.tsx`, `vault-hero.tsx`  | Fold the summary line into the Today card, or start the first shelf higher                 | Moderate   |
| F10 | **The `text-sm` half is still literals.** The `text-xs` half, the page gutter and the dead spacing tokens shipped in PR 15.                        | 65 raw `text-sm` on player-facing screens, against a scale that steps 13 px (badge) → 15 px (body) with nothing at 14.                                                | `styles.css`, all screens              | Give the scale a 14 px step, or resize the 65 deliberately, by the group table in PR 15    | Moderate   |
| G12 | **9.6 px avatar initials on the ballot**, not `aria-hidden` — the only sub-11 px text on a player-facing screen.                                   | 9.6 px on four initials, at all three widths.                                                                                                                         | `awards.tsx`, `participant-avatar.tsx` | Scale the initials with the avatar, or hide them from the accessibility tree and grow them | Easy       |
| G14 | **No iOS web-app meta and no `apple-touch-icon`.** The manifest is remote (Progressier), so this is not answerable here.                           | Not measurable from a render — flagged from source, **unverified on a device**.                                                                                       | `__root.tsx:96-140`                    | Check what Progressier injects on a real iPhone before adding anything                     | Unknown    |

F9 and the `text-sm` remainder of F10 are what the earlier passes left, and neither is a redesign. G12 and G14 are this pass's. G12 is easy, and was left only because it is a judgement about the avatar's own type rather than a floor being missed — §16 should take it with the `text-sm` group. G14 is the one item in this document that cannot be settled from this repo at all: the manifest is a remote URL, so somebody has to open the app on an iPhone and look. F1 and F2 shipped in PR 11 — the input floor and the 16 px that stops iOS zooming. F3, F4 and F5 shipped in PR 12: the interactive edge, the disabled "Reveal all", and the OS reduced-motion setting. F6, F7, F8, F12 and F13 shipped in PR 13, F11 in PR 14, and F10's free half in PR 15. All twelve are recorded in §0.

PR 13 left a gate behind it as well as five fixes: a third sweep in `e2e/smoke.spec.ts` walks the same thirteen routes as the tap-target one at 320, 390 and 430 and fails on any node whose `text-overflow: ellipsis` is actually firing. Two of F8's three sites needed arranging before it could see them at all — a secret shelf exists only once you hold a secret, and the slab plate only squeezes its event line once there is a collection mark beside it — so both have a test of their own. The sweep also found four clips the render set had not: both of the vault's tile names, "Not packed yet" 6 px over at 320, and a leaderboard row losing the player's name at 430 as well as at 320. All four are fixed. Three findings on `/live`, `/analytics` and `/awards` were exempted by name with their reason rather than fixed — **and the third pass took all three back**, because the reason turned out not to survive a scope change. §0 has the argument; the short version is that two of the three were excused for being console screens, which this pass no longer accepts, and the third was excused for a reason that reads like a judgement and is actually a blind spot: _"nothing in §22 or §23 measures this screen"_. `/awards` is a player-facing ballot. `CLIP_EXEMPT` is now empty, and the shape is kept only so that an entry which earns its place later still has to name a path, a class and a reason.

One correction worth keeping, because this document was wrong and the code now disagrees with it on purpose: **F3's proposed 24% white measures 2.05:1, not the ~3.1:1 claimed here.** Compositing `oklch(1 0 0 / A)` over these grounds in gamma-encoded sRGB — which is what a browser does — 24% reaches 2.03–2.15 and **35% is the first value that clears 3:1 on all four** (3.10 `--bg`, 3.12 `--background`, 3.18 `--surface`, 3.21 `--card`). The same method reproduces every other measurement in this table, including F3's own 1.25:1 and F4's 1.40:1, so the error was in the target, not in the readings. §26 has been corrected.

And two more, from PR 14. **F11 was two findings wearing one sentence, and only one of them was true of the 160 utilities.** Tailwind v4 compiles every `hover:` inside `@media (hover: hover)`, so on a phone a hover utility does not latch after a tap — it never fires at all, which is the harder half to notice because nothing looks broken. The latch was real in exactly one place, `.tier-chip`, a hand-written rule this audit never measured; and its stuck state is within a hair of `.is-active`, so a chip you had finished with went on claiming to be the selected filter. Both halves are fixed, by different means, and the two gates that hold them are deliberately different instruments: a browser cannot see the latch (Chromium under touch emulation never applies `:hover` either) and a stylesheet cannot see the press. **And "165 `hover:` against 51 `active:`" counts strings, not utilities.** `hover:` is 160 — `grep -o` reads the tail of `group-hover:` as a hover — and the real `active:` count is **8**, on six elements, four of them in a `ui/sidebar.tsx` nothing imports. The press vocabulary this app had before PR 14 was three ad-hoc values on three controls, not fifty-one.

---

## 24. Quick wins

The first pass's eighteen are all shipped or superseded. What is left, in the order it is worth doing:

1. ~~**The input floor** — one line in `ui/input.tsx`, 28 call sites, including the app's front door (F1).~~ Shipped in PR 11.
2. ~~**`text-base pointer-fine:text-sm` on the three raw inputs, and on `Input` itself** (F2).~~ Shipped in PR 11: iOS no longer zooms on the comment box or either name prompt, on a landscape phone as well as a portrait one.
3. ~~**`<MotionConfig reducedMotion="user">` in `__root.tsx`** (F5). One line, fourteen files.~~ Shipped in PR 12.
4. ~~**Raise the interactive border token** (F3). The cheapest single change for sunlight.~~ Shipped in PR 12, at 35% rather than 24%; §23 says why.
5. ~~**Un-dim the disabled "Reveal all"** (F4).~~ Shipped in PR 12.
6. ~~**Pad the pack-summary name links to the tile's hit area** (F6).~~ Shipped in PR 13, on the link rather than over the card — the card is a flip button, and a link laid over it would be two targets doing different things.
7. ~~**`line-clamp-2` on filmstrip names** (F7).~~ Shipped in PR 13.
8. ~~**Let the secret caption wrap below 360 px** (F8).~~ Shipped in PR 13, and at every width rather than below 360: the caption is one of five fixed strings, and 3-up density clips it on a wide phone too.
9. ~~**Say what the streak rung is waiting for** (F12).~~ Shipped in PR 13.
10. ~~**Delete one of the two trade CTAs** (F13).~~ Shipped in PR 13; the panel's went, the fixed one stayed.

The third pass added eleven more and shipped all of them in one change, because every one was a class or a line rather than a decision:

11. ~~**`/draft` and `/order` into the sweeps** (G1).~~ Two entries in two arrays. The cheapest item on this list and the one that found three of the others.
12. ~~**`line-clamp-2` on the running order's names** (G2).~~ The leaderboard's own PR 13 fix, on the screen that needed it more.
13. ~~**A hit area on `/draft`'s on-the-clock link** (G3).~~ `inline-flex min-h-11 items-center`; a bare inline `<a>` is only as tall as its line box.
14. ~~**The floor on `DropdownMenuItem`** (G4).~~ In the primitive, with a `pointer-fine:` release, because neither player-facing call site was paying for it.
15. ~~**`-webkit-tap-highlight-color: transparent`** (G5).~~ On the elements that own a press, not on `*`.
16. ~~**`overscroll-behavior`** (G6).~~ `contain` on the body for pull-to-refresh, and on drawers, dialogs and scroll containers for chaining.
17. ~~**A PIN field that opens a keypad** (G7).~~ `type="text"` with `-webkit-text-security`, which keeps the masking and leaves `inputMode` alone.
18. ~~**`sm:` → `pointer-fine:` on nine admin fields** (G8).~~ The swap PR 11 made everywhere the audit was looking at the time.
19. ~~**`vh` → `dvh` on ten surfaces** (G9).~~ One character each.
20. ~~**`md:` → `pointer-fine:` on `ui/textarea.tsx`** (G10).~~ The line `smoke.spec.ts` had already written the argument for.
21. ~~**The floor on `SelectTrigger`** (G11).~~ Twelve call sites stop paying for it by hand.
22. ~~**The console’s sub-11 px label layer** (§0).~~ 27 literals to `text-label` / `text-meta`, by the codebase’s own 93 % habit: the token that says what a thing is, not the size it happens to be.
23. ~~**The 0.08 em tracking cap, everywhere it was not** (G13).~~ 34 sites. `/tv` keeps its 0.2 em, which §18 exempts by design.

What is left of the quick wins is G12, the ballot's 9.6 px avatar initials. It is easy, and it was left only because it is a judgement about the avatar's own type rather than a floor being missed — §16 should take it together with the `text-sm` group.

---

## 25. Larger redesign opportunities

All seven of the first pass's items shipped. Two things remain that are more than a quick win:

1. **The vault's opening screen** (F9). The Today card answers "what now"; it did not make the card the hero. Options, in increasing order of change: fold the one-line collection summary into the Today card; let the first shelf start above the fold once a collection exists; or make the Today card collapse to a single line on scroll with the pack action moving to a floating pill.
2. **Finish the design system** (F10). Half shipped in PR 15: every player-facing `text-xs` now names itself, the page gutter is `px-page-x` on 25 shells, and the two spacing tokens that were one value under two names are gone. What is left is the part that was never free — 65 `text-sm` against a scale with no 14 px step, so each one is a resize and not a rename. PR 15's table groups them by what they are (card name, body prose, control label) with the token that fits and what it costs; the control labels are the cheap group, because `text-button` is 15 px on the same 20 px line `text-sm` already has.

---

## 26. Recommended mobile design system

All colours in `oklch()`, as the codebase requires. Values chosen to sit under card foils rather than beside them.

**Two rules joined the system in the third pass, and both had zero occurrences anywhere in the app before it.** Neither is a token, which is why neither showed up in any audit of the token scale:

| Rule                                       | Where                                                | Why                                                                                                                                                                                             |
| ------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-webkit-tap-highlight-color: transparent` | `a, button, [role=button]`, the fields and `label`   | PR 14 built a press vocabulary out of 160 promoted `hover:` utilities, and iOS was drawing its own grey flash over all of it — wrong shape, wrong colour, its own schedule                      |
| `overscroll-behavior: contain`             | `body` (y only), drawers, dialogs, scroll containers | Every screen is live over realtime and none has a refresh affordance, so a downward drag at the top can only lose work. And a filmstrip flicked to its end should not scroll the page behind it |

Both are gated in `src/styles.test.ts` rather than in the browser suite, and deliberately: Chromium under touch emulation never paints the iOS flash, so a spec cannot see the first one at all. The stylesheet is the only place that rule is checkable — the same argument PR 14 made for its own `:hover` walk.

The third addition is the touch floor reaching three more primitives — `ui/dropdown-menu.tsx`, `ui/select.tsx`, `ui/textarea.tsx` — plus `ui/switch.tsx`, which takes the floor as a **hit box** rather than a size. A switch is 20 px tall because that is what a switch looks like; growing it to 44 draws a pill the size of a button. A 44 px `::before` centred on the track, released on `pointer-fine:`, gives the thumb the target without changing the drawing.

**Colour**

| Token                         | Value                                             | Use                                                                |
| ----------------------------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| `--bg`                        | `oklch(0.13 0.015 240)`                           | page ground on card screens                                        |
| `--bg-hud`                    | `oklch(0.14 0.02 240)` + `circuit-bg`             | League, Board, TV only                                             |
| `--surface`                   | `oklch(0.17 0.02 240)`                            | shelves, panels, sheets                                            |
| `--surface-raised`            | `oklch(0.21 0.02 240)`                            | the slab, the trophy plaque, the sealed pack                       |
| `--border`                    | `oklch(1 0 0 / 10%)`                              | panels, dividers, hairlines — decorative only                      |
| `--border-strong`             | `oklch(1 0 0 / 35%)`                              | any edge a thumb aims at: inputs, buttons, tiles, chips (3.10:1)   |
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

| Token                           | Value                                                                |
| ------------------------------- | -------------------------------------------------------------------- |
| radius-card                     | 12 px (5:7 cards), 16 px for the viewer                              |
| radius-panel                    | 12 px                                                                |
| radius-chip / pill button       | 999 px                                                               |
| radius-secondary button         | 10 px                                                                |
| button-height                   | 44 (sm) · 48 (md, default) · 56 (lg, Open Pack / Send / Accept)      |
| icon-button                     | 44 × 44                                                              |
| input-height                    | 48                                                                   |
| chip-height                     | 44 (all tappable chips)                                              |
| page-x (`--spacing-page-x`)     | 16                                                                   |
| grid-gap (`--spacing-grid-gap`) | 12                                                                   |
| section-gap                     | 24                                                                   |
| ~~stack-gap~~                   | ~~8~~ — retired in PR 15, see §17                                    |
| tab-bar                         | 56 + safe-bottom; rows are the commissioner's (§4), not a fixed five |
| header                          | 48 + safe-top                                                        |
| sheet                           | 16 px padding, 20 px top radius, 85 dvh max                          |

**Icons**: lucide, 1.75 stroke, 20 px in the bar, 18 px in chips, 16 px inline. Rarity uses shapes (pips, tabs), not icons.

**Typography**: the scale in §16 — Barlow Condensed for titles, names, badges and buttons; one body face (system or Inter, decide once) at 15/12; JetBrains Mono for numerals. 11 px floor.

All ten `--text-*` tokens are declared and nine are in use. `--text-title` is kept deliberately unused: the page h1s run `text-3xl`, which is the same 30 px on a 36 px line against the token's 32, so adopting it is a line-height change rather than a rename and is out of scope for a migration scoped to what renders identically. It is the target of a later pass, not a token nothing wants. The spacing scale is three, not five — §17 says why.

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

**And the commissioner is on a phone too.** This section has always been written from a player's side of the glass, which is correct — but the third pass established that the person running the combine is standing at the same start line, holding the same handset, with a beer in the other hand. They tap four digits into a keypad, not a letter keyboard. They read a panel's counter without holding the phone closer. They flip a nav row with a thumb rather than a cursor. None of that changes what the player sees; all of it is the same rule, applied to the half of the app that was carrying an exemption instead.

---

## 28. Phased PR plan — prompts for a coding agent

Each phase below is one pull request. Run them in order: every phase builds on the tokens and sizes from the one before it, and each one is small enough to review on a phone in an evening. Paste the **Project guardrails** block at the top of every prompt, then the phase's prompt. The prompts are written for Claude Code; the tool notes at the end say what to change for Lovable or Codex.

### How to use these prompts

1. Start every phase from an up-to-date `main` on a new branch named in the prompt.
2. Paste the guardrails block, then the phase prompt, into the agent.
3. When the PR opens, read it on a phone at 390 px before merging: the "Done when" list in each prompt is what to check.
4. Merge, pull, move to the next phase. Do not run two phases at once; they touch the same files.

**One rule the third pass would add, having broken it twice.** If a phase changes anything a render can see, take the capture set _before_ starting and again at the end, and diff the numbers. Editing source while a capture run is in flight produces a measurement set that is half one commit and half another, and nothing about the output says so. This pass did it twice and had to throw both runs away — the second time by stashing the whole diff and re-measuring from a clean tree, which is the only way to get a "before" that means anything. **A fix that does not move the number it was supposed to move has not landed, whatever its test says.**

### Project guardrails (paste at the top of every prompt)

```text
Project guardrails for willyoubemyhero (read CLAUDE.md first):
- Package manager is Bun 1.3.11. Before you finish, run `bun run format`, then `bun run lint`, `bun run typecheck` and `bun run test`, and fix anything red. Lint includes Prettier and is the formatting gate.
- Never rename or remove the six tier ids (champion, podium, stationKing, penaltyBox, dnf, base), the edition ids (platinum, gold, silver, bronze, standard), the secret levels (mythic, legendary, epic, rare, common) or any award category id. They are persisted. Changing their colours, labels or presentation is fine.
- Colours are oklch() everywhere.
- Never show or send how many secret cards exist in a set, or how many remain, on any screen or in any response, except the existing completion trophy. No "x of N", no per-card silhouettes or empty slots for unpulled secrets, no empty set headers. One deliberate exception: the single, non-counting "More in this set" marker specified in PR 10, which is the same one tile whether one card or twenty remain. Nothing else may hint at the unpulled part of a set.
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

### Phase overview — PR 0 to PR 10, shipped

The first pass's eleven phases are all merged. Kept as a record rather than as instructions; the prompts themselves have been removed now that the work is done.

| PR  | Title                                           | What landed                                                                                                                         |
| --- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Design tokens and control sizes                 | The type and spacing tokens, the `neon-btn` size classes, the global `:focus-visible` ring, and the 44 px floor in `ui/button.tsx`. |
| 1   | Readability and touch-target sweep              | The 11 px floor and the 0.08 em tracking cap, and the tap-target sweep in `e2e/smoke.spec.ts` that keeps them.                      |
| 2   | Quieter room, rarity by rank                    | Three levels of glow, a ring outside the bloom, and the per-tile tier glow dropped for the lower tiers.                             |
| 3   | Pack ribbons, summary reflow, mute on the stand | NEW and ×N on the stand and summary; the summary's snap row; a persistent mute.                                                     |
| 4   | Feedback surfaces                               | Skeleton tiles, bottom-centre toasts, the offline banner, and themed 404 / error / SSR pages.                                       |
| 5   | Home "Today" card and streak strip              | `today-card.tsx`, the streak rungs, and the sort-and-filter sheet.                                                                  |
| 6   | Acquisitions read and "new since last visit"    | `getRecentAcquisitions` and the new-since strip.                                                                                    |
| 7   | Full-screen card viewer                         | `card-viewer.tsx`, reached from a tile tap and from `?view=1`.                                                                      |
| 8   | Trade builder                                   | Offers/Feed tabs, the sticky CTA, and the builder drawer.                                                                           |
| 9   | Navigation and profile                          | `/you`. The five-fixed-tab half was withdrawn in favour of the commissioner-configurable bar.                                       |
| 10  | Two-beat reveal and set mystery slot            | The second beat on special pulls, and a single non-counting "More in this set" marker.                                              |

### Phase overview — PR 11 to PR 15, shipped

The second pass's five phases are all merged. Same treatment as the eleven above: kept as a record, prompts removed now that the work is done.

| PR  | Title                                             | What landed                                                                                            |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 11  | The floor the buttons got, and the inputs did not | The 44 px floor and the 16 px font on `ui/input.tsx`, released on `pointer-fine:` rather than a width. |
| 12  | Edges you can see in the sun                      | `--border-strong` at 35 %, the disabled "Reveal all", and `<MotionConfig reducedMotion="user">`.       |
| 13  | Words that fit the phone they are on              | Five clipped labels, the pack-summary link hit areas, and one of the two trade CTAs.                   |
| 14  | Something happens when you press it               | The `@custom-variant hover` that promotes 160 utilities to `:active` on a pointer that cannot hover.   |
| 15  | One vocabulary for type and spacing               | Every player-facing `text-xs` named, `px-page-x` on 25 shells, two duplicate spacing tokens retired.   |

### PR 16 — Two public screens nobody was measuring, and four rules nobody had written

Branch `ux/16-unswept`. Shipped with this pass rather than left as a prompt, because every item was a class or a line. Implements §0 G1–G11.

What landed, and the one thing to know about each:

- **`/draft` and `/order` into both sweeps.** They were public, in `sitemap.xml`, and in no route list — with no stated reason, unlike `/admin` and `/recap/$slug`. Adding them found a 36 px link and four clipped names the first time anything looked.
- **`CLIP_EXEMPT` emptied.** All three entries rested on the console being out of scope; two of them were console screens and this pass took the console in, and the third (`/awards`) was a player-facing ballot excused because _"nothing in §22 or §23 measures this screen"_. The shape is kept so a future entry still has to name a path, a class and a reason that survives a scope change.
- **The floor into three more primitives** — `DropdownMenuItem`, `SelectTrigger`, `ui/textarea.tsx` — each with a `pointer-fine:` release and a comment in `ui/input.tsx`'s voice. `ui/dropdown-menu.tsx` is the one that matters: it is player-facing and the sweep could never see it, because a closed menu has no items in the DOM.
- **Two properties with zero occurrences app-wide**: `-webkit-tap-highlight-color` and `overscroll-behavior`, both gated in `src/styles.test.ts` because a browser under touch emulation cannot see either.
- **The PIN keypad**, `type="text"` plus `-webkit-text-security`. The trade is written at the call site: Firefox does not implement the masking, and the phone is where the PIN is actually typed.
- **Nine admin fields off `sm:`, ten surfaces off `vh`.** Mechanical, and the reason the console needed a scope change rather than a bug report: none of it was wrong under the rules it was written to.

### What a PR 17 would carry

Not written as a prompt, because both remaining items are decisions rather than edits and should be taken together with §16's type scale:

- **G12** — the ballot's 9.6 px avatar initials, the last sub-11 px text on a player-facing screen.
- **G13** — 0.1 em tracking on 12 px labels across six combine screens, against a cap whose stated exceptions are a typed code, a poster and the wordmark.
- **G14** — the iOS web-app meta, which cannot be settled from this repo at all: the manifest is a remote Progressier URL and the only way to know what an iPhone receives is to look at one.
- **F9 and F10**, unchanged from §23 and §25.

### Tool notes

- **Claude Code**: run from the repository root on a fresh branch; it reads `CLAUDE.md` automatically, and the guardrails block repeats the parts that matter. Ask it to run `/code-review` on its own diff before opening the PR. Keep one phase per session.
- **Lovable**: paste the guardrails and the phase prompt as one message. Lovable commits to the connected branch as it works, so add "work on branch `<name>` and do not push to the connected branch until I approve" and never let it rewrite history. Its preview will not show pack sounds or haptics; check those on a real phone after merge.
- **Codex**: same prompt. Codex may not read `CLAUDE.md`, so the guardrails block is load-bearing; add "run `bun run format && bun run lint && bun run typecheck && bun run test` and paste the output before finishing". Ask it for the 390 px screenshots explicitly; it will not attach them unprompted.
- **Any tool**: if a phase's "Done when" list cannot be met, the PR description must say which item was skipped and why, not silently narrow the scope.
