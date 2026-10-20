# Fix: pages slide sideways a little on phones

Your screenshot shows the Vault pushed to the left: the "Roster 18 / 18" line and the collection rows are cut off at the left edge, so something on the page is wider than the screen.

## Likely cause
The recent touch-scrolling fix changed the page's "cut off anything wider than the screen" rule so it only applies to the page body. On Android Chrome that rule doesn't stop the whole screen from sliding sideways any more. The "new since your last visit" card strip, which runs off the right edge on purpose, is the most likely thing pushing the page wider.

## Steps
1. **Find the culprit.** Load the Vault, the pack page, the trade screens, the shop, the league page and the You page in a 360px-wide touch-phone browser. List every element that sticks out past the right edge, and check whether the page can be dragged sideways.
2. **Fix it at the source.** Make each element that sticks out stay inside its own box. Card strips keep scrolling sideways inside themselves, but the page as a whole stays still.
3. **Add a backstop that keeps touch scrolling working.** Apply the same "cut, don't scroll" rule to the outer page as well as the body. This rule doesn't create its own scroll area, so it doesn't bring back the earlier bug where the page wouldn't scroll by finger.

## Verification
- On a 360px touch phone, no page can be dragged sideways on any of the screens above.
- Vertical finger scrolling still works, and the card strips still swipe sideways.
- Formatting, lint, type check and unit tests stay green. Add a style test that checks the outer page and the body both use the "cut" rule, and that neither uses the old rule that broke scrolling.

## Technical notes
- `src/styles.css` sets `overflow-x: clip` on `body` only. The likely fix is to also set `overflow-x: clip` on `html`. Never use `hidden` there: that is what broke touch scrolling before.
- For the measurement, run Playwright with `is_mobile`/`has_touch` at 360x800. Compare `document.documentElement.scrollWidth` with `innerWidth`, and log every element whose `getBoundingClientRect().right` is greater than `innerWidth`.
