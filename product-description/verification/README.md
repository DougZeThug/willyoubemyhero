# Hand verification

The feature documents were written from the code and the tests. This directory
is the protocol for checking them against the running product, one observable
claim at a time.

## What is here

| File                                 | Covers                           |
| ------------------------------------ | -------------------------------- |
| [foundations.md](foundations.md)     | `foundations/*` — prefix `FND`   |
| [cards.md](cards.md)                 | `cards/*` — prefix `VLT`         |
| [trading.md](trading.md)             | `trading/*` — prefix `TRD`       |
| [dust.md](dust.md)                   | `dust/*` — prefix `DST`          |
| [combine.md](combine.md)             | `combine/*` — prefix `CMB`       |
| [admin.md](admin.md)                 | `admin/*` — prefix `ADM`         |
| [accounts.md](accounts.md)           | `accounts/*` — prefix `ACC`      |
| [cross-cutting.md](cross-cutting.md) | `cross-cutting/*` — prefix `XCT` |

Each file has one table per document. Each row is an item with a stable ID, a
priority, what it needs, the claim with a link to the document section, the
setup, numbered steps, the expected result, and a Result column for the tester.
Items that cannot be checked by hand are listed under each document as "Not
checkable by hand".

Priorities: **P1** is an established fact, a claim many documents depend on, or a
suspected bug; **P2** is an ordinary claim; **P3** is a number, a colour, or a
timing.

## How to run a pass

1. **Bring up the surface.** `bun install` then `bun run dev`, and open it on a
   phone on the same network — this is a phone-first app and a desktop browser is
   not the surface. `bun run preview` does not work in this project; use the dev
   server. Alternatively use the deployed app, which is the real surface and the
   better choice for anything involving realtime or a second device.
2. **Get a clean state.** Most per-device state lives in browser storage under
   `wwbh:` keys and in two IndexedDB databases, `wwbh-cards` and `wwbh-combine`.
   Clearing site data resets a guest to a brand new guest — which also spends a
   fresh daily secret, so do it deliberately rather than between every item.
3. **Confirm the commit.** Every document says
   `Verified against willyoubemyhero commit b46f330`. Run `git rev-parse --short HEAD`;
   if it differs, the documents describe a different build and some failures will
   be drift rather than defects.
4. **Keep the documents open beside the app.** Read the linked section before
   each item; the item is a summary, the section is the claim.
5. Work through P1 first across all files, then P2, then P3.
6. Record `pass`, `fail`, or `blocked` in the Result column, with a note for
   anything other than a clean pass. A fail is something the document says that
   the product does not do; a blocked item could not be run.
7. File every fail in [bug-triage.md](../bug-triage.md): if the entry exists, add
   a Status line quoting the item ID; if not, add an entry with the item ID under
   "Raised by". **A fail is not automatically a product bug** — sometimes the
   document is wrong and the fix is to the document. Say which in the Status line.
8. When every P1 and P2 item for a document has passed or been filed, change its
   row in the [coverage table](../README.md#coverage) from `drafted` to
   `verified`.

## Devices and conditions

The Device column takes one or more of these:

- **phone** — the real surface. Almost everything is P1 on a phone and P3 on a
  desktop, because a desktop is not where this is played.
- **desktop** — for anything about wide layouts and the chip rows that become
  menus on a phone.
- **guest** — a browser with site data cleared and no player claimed. Note that
  becoming a guest spends nothing until you tear a pack.
- **member** — a browser holding a member token, claimed with a paper code.
- **account** — signed in with email and password. Needed for anything about a
  second device.
- **commissioner** — an admin session, from the PIN or from an admin account. It
  lasts 12 hours; several admin items are about what happens when it does not.
- **second device** — genuinely a second handset, not a second tab. A second tab
  shares storage and IndexedDB; a second device shares only what the server
  holds, and that difference is the point of several items.
- **second person** — someone else's member session, for trades and offers.
- **offline** — airplane mode on the phone. Devtools' offline toggle does not
  fail an in-flight websocket the way losing the radio does, which matters for
  every item about realtime going degraded.
- **reduced motion** — the OS-level setting, not a toggle in the app.
- **gyroscope** — a real phone with motion permission granted; there is a
  permission prompt in the way, and the prompt is itself an item.
- **race day** — items that can only honestly be checked while a combine is
  actually running. They are marked so rather than approximated.

## Driving the product from a script

There is a partial automation route and it is worth knowing its limits before
trusting it.

`e2e/fixtures.ts` intercepts the app's server-function calls in the browser and
answers them from fixed data, so Playwright can drive every screen without
touching Supabase. [`scripted/`](scripted/) holds a pass built on it — nineteen
items covering routing, the nav rules, the League hub, the dust switch, all six
favourites claims and three gated or empty states. Run it with:

```
bunx playwright test --config=product-description/verification/scripted/playwright.config.ts
```

It has its own config so it never joins `bun run test:e2e` and never gates CI.
It starts the dev server itself and points every Supabase variable at a dead
address, so a request that escaped the stub would fail loudly rather than reach
the live project.

**What a scripted pass can check:** routing, which screen renders, what is on it,
empty states, nav rules and which tab lights, what is written to `localStorage`
and IndexedDB, and anything whose expected result is a state read back rather
than something seen.

**What it cannot check:** anything with real data behind it, realtime arriving,
a second device, a gyroscope, sound, how long an animation feels, whether a foil
is distinguishable in daylight, or a phone in a garden with one bar of signal.
Those are most of what this app is.

**Use the script to observe, not to gesture, wherever the item is about input.**
The tear is a drag with a threshold in it, and a synthetic pointer sequence
proves the handler works rather than proving the pack opens under a thumb.

**No document is marked `verified` on the strength of a scripted pass alone.**

## Results so far

One scripted pass, against the stubbed app at commit `b46f330`, on an iPhone 13
viewport. **19 items, 19 passed, 0 failed.** They are marked
`pass (scripted)` across eleven rows in
[foundations.md](foundations.md) and [cards.md](cards.md), and nowhere else.

What it established:

- The root path redirects to the vault.
- Exactly one tab lights on each of the five bottom-bar paths, and it is the
  right one — including the longest-prefix rule that keeps `/players/pack` off
  the Vault tab.
- The League hub links to all five of Live, Order, Draft, Awards and Analytics.
- The Shop tab is absent while dust is off and present while it is on.
- All six favourites claims: the label wording and its pressed state, the storage
  key and its shape, appending rather than prepending, the shelf appearing and
  disappearing whole, and junk under the key reading as an empty shelf.
- The trading post and the admin console show their gates rather than their
  contents to a device with no token.
- A combine with no roster, and one whose roster failed to load, are both
  distinguished from a finished field — the failure that made the live screen
  congratulate nobody.

One thing was found while building the pass rather than by an item in it: **the
active navigation tab carries no `aria-current`**, and is conveyed by a colour
class alone. The probe written for it found nothing, and reading
`src/components/site-nav.tsx` confirmed there is none. It is filed as part of
[B-30](../bug-triage.md#b-30-accessibility-gaps-across-the-app).

What the pass did **not** cover, and what remains entirely unrun: everything
needing real data, a second device, a second person, realtime, sound, motion, the
gyroscope, race day, or an actual phone in a hand. That is the large majority of
every checklist in this directory.

**No document is marked `verified`.** Nothing here has been watched on a phone,
and a scripted pass is not grounds for marking one.
