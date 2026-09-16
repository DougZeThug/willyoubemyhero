# Fix: pages won't scroll with a finger on Android Chrome

Reported on a Galaxy S24 in Chrome, on both the preview and the published site, on every
screen. Nothing in the code obviously locks the page: the background, the nav, the offline
strip and the ceremony layer are all click-through or unmounted, and the page body sets no
height or vertical-overflow limit. So step one is to reproduce it, not to guess.

## Step 1 — Reproduce it as a touch device

Drive the running app in a Chromium browser configured as a touch phone (360 px wide, touch
enabled, no mouse) and perform a real finger-style drag on the Vault, a player card page and
the pack page. Record whether the page moves, and which element the drag lands on.

This distinguishes the three plausible causes:

- the page genuinely cannot scroll for anyone on touch (a style or gesture bug we can fix),
- only drags that *start on a card* are swallowed (a card gesture bug), or
- neither reproduces, in which case the cause is the phone/browser layer rather than the app.

## Step 2 — Fix what the reproduction shows

Likely fixes, in the order they'd be tried:

1. **Cards swallowing the drag.** Full-size cards deliberately claim the whole gesture so they
   can be tilted, pinched and swiped. If a card fills most of the screen, a drag that starts on
   it can never scroll the page. Fix: let a clearly vertical drag on an unzoomed card fall
   through to the page, and only claim the gesture once it reads as a tilt, pinch or sideways
   swipe.
2. **Page-level overflow.** The page currently hides horizontal overflow on both the document
   and the body, which is a known way to break scrolling on some mobile browsers. Fix: move
   that to a single, safer rule.
3. **A stray full-screen layer.** If the reproduction shows the drag landing on an invisible
   overlay, make that layer click-through.

## Step 3 — Rule out the installed-app layer

The app registers a third-party progressive-web-app script whose service worker isn't part of
this codebase, and the preview currently logs that it fails to install. If Step 1 shows the app
scrolling fine in a touch browser, the next check is on your phone: open the site in a fresh
Chrome tab (not the installed app icon), and — if that scrolls — the installed copy is serving
an old cached build, which we clear rather than chase in code.

## Verification

- Touch-drag scrolling works on the Vault, a player card, the pack page and the trade screens.
- Card tilt, pinch-zoom, tap-to-flip and sideways card swipes still behave as they do today.
- `format`, `lint`, `typecheck` and the unit suite stay green; the card-gesture tests get a case
  covering "a vertical drag on an unzoomed card scrolls the page".

## Technical notes

- Repro harness: Playwright Chromium with `has_touch=True`, `is_mobile=True`, 360x800, using
  `page.touchscreen` / `dispatchEvent` touch sequences against `http://localhost:8080`; assert
  `window.scrollY` changes.
- Suspects already ruled out by reading the source: no document- or window-level `touchmove`
  /`pointermove` listener anywhere in `src`; `html`/`body`/`main` set no `height` or
  `overflow-y`; every `fixed inset-0` layer is either `pointer-events-none` or conditionally
  mounted.
- Remaining code suspects: `touchAction: "none"` on the hero tilt variant
  (`src/components/holo-card.tsx:675`) and on `ZoomPanFrame`
  (`src/components/zoom-pan-frame.tsx:62`); `overflow-x: hidden` on `html, body`
  (`src/styles.css:274-279`) — candidate replacement is `overflow-x: clip` on the body only.
- The fallthrough fix belongs in `use-card-zoom.ts` / `holo-card.tsx` gesture start: keep
  `pan-y` until a pointer has moved past the horizontal threshold, rather than `none` from the
  first touch.
