# Pinch-to-zoom and swipe navigation on full-size cards

Make a single card easier to actually read on a phone: pinch to zoom in on the art or the
back text, drag to pan while zoomed, and swipe sideways to move to the next card without
closing anything.

## Where it applies

- **Secret card sheet** — swipes through the secrets you have pulled, in the order the
  vault shows them.
- **Player card page** — swipes through the roster in running order, updating the URL so
  back/forward and sharing still work.

Grid thumbnails and the pack-opening cards are untouched.

## Gestures

- **Pinch** (two fingers) or double-tap zooms the card between 1x and 4x, anchored on the
  point under your fingers so the bit you are reading stays put.
- **One-finger drag while zoomed** pans the card. Swipe navigation is disabled at that
  point, so panning never skips to the next card.
- **Horizontal swipe at 1x** goes to the next / previous card. Vertical drag still scrolls
  the page.
- **Tap flips the card.** This replaces today's flick-to-flip on full-size cards, since the
  flick gesture is now the swipe. Flipping while zoomed resets zoom to 1x.
- Zoom resets to 1x whenever you land on a different card or close the sheet.
- Reduced-motion users get the same behaviour without the animated transitions.

## Affordances

- Small prev / next arrows and a position line ("3 of 11") under the card, so the gesture is
  discoverable and there is a mouse path on desktop.
- A hint line the first time a card opens: "Pinch to zoom · swipe for the next card".
- Keyboard: left/right arrows navigate, `+` / `-` zoom, `0` resets.

## Technical notes

- New `useCardZoom` hook plus a `ZoomPanFrame` wrapper in `src/components/`. Pointer Events
  with two-pointer pinch, `touch-action: none` on the frame, and a non-passive native
  `wheel` listener for trackpad pinch (`ctrlKey`) using `Math.exp` delta scaling with
  `deltaMode` normalisation and cursor-anchored offset correction. Transform applied as
  `translate(...) scale(...)` with `transform-origin: 0 0`.
- The frame sits *around* `HoloCard`, not inside it. At 1x it passes gestures through so the
  existing tilt behaviour is unchanged; above 1x it captures the pointer and suppresses tilt.
- `HoloCard` gains a `flickToFlip` prop (defaulting to today's behaviour) so only these two
  callers switch to tap-to-flip. No change for the pack or the grids.
- `SecretCardSheet` takes the owned-secrets list plus an index instead of a single card;
  `players.index.tsx` passes them and tracks the open index.
- `players.$id.tsx` already sorts participants by running order — reuse that list and
  `navigate` to the neighbouring id on swipe.
- Tests: unit tests for the zoom math (clamp, anchor, delta normalisation) and next/prev
  index wrapping, plus a component test that a swipe at 1x navigates while a swipe when
  zoomed pans instead.