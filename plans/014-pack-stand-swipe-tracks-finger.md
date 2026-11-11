# 014 — Make the pack-stand swipe follow the finger (spike)

- **Status**: DONE (spike; code applied behind TRACK_SWIPE in pack-stand.tsx. MUST be feel-checked on a phone: set TRACK_SWIPE = false, or revert, if it feels worse. Design deviated from this file: see the notes at the end)
- **Commit**: 4df05ee
- **Severity**: MEDIUM (missed opportunity, not a defect)
- **Category**: Missed opportunity / Interruptibility
- **Estimated scope**: `src/components/pack-stand.tsx` (~40 lines); possibly `src/lib/zoom.ts` read-only. Highest effort and risk of the set: do last.

## Problem

The tear is excellent: it tracks the finger 1:1. The reveal stand's swipe-to-next
is the one gesture that is not tracked. The card does nothing until the finger
lifts; only then `swipeDirection` reads the throw:

```tsx
// src/components/pack-stand.tsx:487-501 — current
function handleSwipeDown(e: React.PointerEvent) {
  swallowClickRef.current = false;
  swipeRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, at: Date.now() };
}
function handleSwipeUp(e: React.PointerEvent) {
  const d = swipeRef.current;
  swipeRef.current = null;
  if (!d || d.id !== e.pointerId) return;
  const dir = swipeDirection(e.clientX - d.x, e.clientY - d.y, Date.now() - d.at);
  if (dir === 0) return;
  swallowClickRef.current = true;
  if (dir === 1 && canAdvance) onAdvance();
}
```

```tsx
// src/components/pack-stand.tsx:629-647 — current (column that owns the gesture)
<motion.div
  animate={slam && !reduced ? { x: [0, -3, 3, -2, 0], y: [0, 2, -2, 1, 0] } : { x: 0, y: 0 }}
  transition={{ duration: 0.18, ease: "linear" }}
  className="relative z-10 flex w-full touch-pan-y flex-col items-center gap-3"
  onPointerDown={handleSwipeDown}
  onPointerUp={handleSwipeUp}
  onPointerCancel={() => { swipeRef.current = null; }}
  onClickCapture={handleSwipeClickCapture}
>
```

```tsx
// src/components/pack-stand.tsx:731-754 — current (the card that leaves/arrives)
<motion.div
  key={shownKey}
  initial={landing ? false : gathered ? { opacity: 0, x: 0, scale: reduced ? 1 : 0.94 } : { opacity: 0, x: reduced ? 0 : 64, scale: 0.94 }}
  animate={{ opacity: 1, x: 0, scale: 1 }}
  exit={{ opacity: 0, x: reduced ? 0 : -64, scale: 0.94 }}
  transition={{ type: "spring", stiffness: 240, damping: 26 }}
  className="absolute inset-0"
>
  <motion.div layoutId={`pack-card-${current.slot.id}`} ... transition={{ duration: 0.9 }}>
```

`touch-pan-y` on the column is load-bearing (see its comment); a horizontal
throw must stay a pointer gesture, never a pan.

## Target

A rightward-to-leftward drag moves the **keyed card wrapper** with the finger
(1:1), dismissal is decided on release by velocity as well as distance, and an
undismissed drag springs back.

Design (the spike's hypothesis; validate before committing):

1. `const dragX = useMotionValue(0);` and pass `style={{ x: dragX }}` to the keyed `motion.div` (`pack-stand.tsx:731`). Motion animates the provided MotionValue for `animate`/`exit` `x`, so existing entrance/exit keeps working.
2. Add `onPointerMove` to the column: when `swipeRef.current` is set and the gesture is predominantly horizontal (reuse the same bias test as `swipeDirection`: `Math.abs(dx) >= Math.abs(dy) * SWIPE.bias`) and `dx < 0` (towards the next card) and `canAdvance`, set `dragX.set(dx * 0.9)`; otherwise rubber-band: `dragX.set(dx * 0.25)` (friction) for dx > 0 or when `!canAdvance`. Do NOT call `setPointerCapture` (it would steal the click the existing `swallowClickRef` logic relies on).
3. On pointer up: if the existing `swipeDirection(...)` says advance (`dir === 1`) OR `Math.abs(dx) / elapsedMs > 0.11` with `dx < -SWIPE.dist/2`, call `onAdvance()` (the exit animation carries it away). Otherwise `animate(dragX, 0, { type: "spring", duration: 0.4, bounce: 0.2 })` to settle back.
4. On pointercancel and on `shownKey` change: reset `dragX` to 0.
5. Reduced motion: keep today's behaviour (no tracking; the `reduced` flag already gates `x` offsets) — `if (reduced) return` in the move handler.

## Repo conventions to follow

- Motion values written straight from pointer events with no `setState`: `src/components/pack-wrapper.tsx:505` (`front.set(p)`).
- `SWIPE` thresholds and `swipeDirection` live in `src/lib/zoom.ts:82`; reuse the constants, do not invent new thresholds.
- Click swallowing after a swipe: `swallowClickRef` (keep exactly as is).
- Specs/tests that pin this: `src/components/pack-stand.test.tsx` and the e2e journeys (CI-only; do not run e2e locally).

## Steps

1. Read `src/lib/zoom.ts` (`SWIPE`, `swipeDirection`) and the swipe handlers; confirm the quoted code.
2. Implement items 1-5 above in `pack-stand.tsx` behind a single local constant `const TRACK_SWIPE = true` so it can be flipped off in one line.
3. Run `bun run format && bun run lint && bun run typecheck && bun run test`; update only unit tests that assert exact handler wiring, not behaviour.
4. **Device feel check** (below). If tracking feels worse than today's throw (fights vertical scroll, jitters, fights the flip tap), set `TRACK_SWIPE = false` and mark this plan WONTFIX with notes.

## Boundaries

- Do NOT use `drag="x"` on the card (it fights `layoutId`, `mode="wait"` and `touch-pan-y`); the plan uses a MotionValue on `style.x`.
- Do NOT add pointer capture, change the tap-to-flip behaviour, the secret/peek logic, `landing`, `StandDeck`, or the layoutId flight to the summary.
- Do NOT change `swipeDirection`'s thresholds or semantics.
- If the structure differs from the quoted code, STOP and report.

## Verification

- **Mechanical**: commands in Step 3. The e2e suite is CI's job (CLAUDE.md): do not run `test:e2e`.
- **Feel check (real phone)**: during a pack reveal, slowly drag a revealed card left: it follows the finger; release short: it springs back; flick quickly with a short distance: it advances; drag right or when it cannot advance: it resists (rubber-band). Tap to flip still works every time; a vertical scroll started on the card still scrolls the page. Spam swipes: no stuck offset after the next card arrives.
- Reduced motion on: swipe still advances by throw, no tracking.
- **Done when**: all of the above behave and `shownKey` changes always start at x = 0, or the plan is closed WONTFIX.

## Implementation notes (added after execution)

Exploration before execution corrected parts of the design above; the shipped code differs as follows.

- HoloCard already captures the pointer on touch and tilts on its own `onPointerMove`; its events bubble to the stand's column, so `onPointerMove` on the column works. The card tilts while it slides (unverified on a device).
- Tracking writes use `dragX.jump()` (stops an in-flight animation), not `.set()`.
- The exit is a variant (`exit="out"`) fed by `AnimatePresence custom={exitX}` so a committed swipe exits from where the finger left the card (`Math.min(dragX, -64)`); keyboard and Next-button advances still exit to -64. Motion keeps the `custom` it had when `isPresent` flipped, verified in `PresenceChild`.
- The planned `useLayoutEffect(() => dragX.jump(0), [shownKey])` was deliberately NOT added: in `mode="wait"` it would run while the old card is still exiting on the same value and snap it to 0. The incoming card resets `dragX` itself because Motion sets a style motion value to the element's `initial` on mount.
- A short, fast flick also commits (more than half of `SWIPE.dist` and faster than 0.11 px/ms, horizontal-dominant). Thresholds in `src/lib/zoom.ts` are unchanged.
- Known rough edges: no dead zone, so a tap with 1-2px of horizontal jitter nudges the card and springs back; an advance from the keyboard mid-drag leaves the gesture attached to the new card. `layoutId` projection under a moving `x` parent is unverified.
- Adds one lint warning (`react-hooks/set-state-in-effect` on the `setExitX` effect, same pattern as the existing `setSettled(false)` effect); `onExitComplete={() => setExitX(EXIT_X)}` would avoid it.
