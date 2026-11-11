# 013 — Make the finish celebration leave quickly and arrive without a pop

- **Status**: DONE (code applied; device feel check still pending)
- **Commit**: 4df05ee
- **Severity**: LOW
- **Category**: Physicality / Easing
- **Estimated scope**: 1 file, ~8 lines

## Problem

The live-timing finish takeover dismisses with the same underdamped spring it
enters with (damping 18 gives a visible bounce on exit), the card and backdrop
exit on different curves, and the inner card has no `opacity: 0` on enter, so
it pops in at full opacity at scale 0.85 while the backdrop fades in around it.
It can also be replaced by the next finisher within seconds, so a slow exit
holds the old card on screen.

```tsx
// src/components/finish-celebration.tsx:80-102 — current
<motion.button
  key="celebration"
  ...
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  exit={{ opacity: 0 }}
  className="fixed inset-0 z-50 grid place-items-center bg-background/85 pt-safe pb-safe backdrop-blur"
>
  <motion.div
    initial={{ scale: 0.85, y: 20 }}
    animate={{ scale: 1, y: 0 }}
    exit={{ scale: 0.9, opacity: 0 }}
    transition={{ type: "spring", stiffness: 220, damping: 18 }}
    className="hud-bezel hud-glow mx-4 max-w-lg rounded-3xl border border-primary/40 p-8 text-center"
  >
```

## Target

Keep the celebratory entrance spring exactly as it is (it is a rare, high-emotion
moment: delight is allowed). Only fix the exit and the missing opacity:

```tsx
<motion.button
  ...
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  exit={{ opacity: 0, transition: { duration: 0.15, ease: [0.23, 1, 0.32, 1] } }}
  ...
>
  <motion.div
    initial={{ opacity: 0, scale: 0.85, y: 20 }}
    animate={{ opacity: 1, scale: 1, y: 0 }}
    exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15, ease: [0.23, 1, 0.32, 1] } }}
    transition={{ type: "spring", stiffness: 220, damping: 18 }}
```

(Per-target `transition` inside `exit` overrides the component-level spring for
the exit only.)

## Repo conventions to follow

- `AnimatePresence` + `exit` already used in this file; reduced motion is handled globally by `<MotionConfig reducedMotion="user">` and confetti is skipped under reduced motion at lines ~39-40: do not touch either.
- The `runId` comment at lines ~68-74 explains why a stuck exit matters: keep that logic.

## Steps

1. Edit the outer `exit` and the inner `initial`/`animate`/`exit` as in Target.
2. `bun run format && bun run lint && bun run typecheck && bun run test` (`finish-celebration.test.tsx` must stay green).

## Boundaries

- Do NOT change the entrance spring, the confetti, the `backdrop-blur`, markup, or `role`/`aria-*`/focus handling.
- If the quoted code has changed, STOP and report.

## Verification

- **Mechanical**: commands in Step 2.
- **Feel check**: on `/live` finish a timed run (admin). The card should fade+rise in as one with the backdrop (no pop), and tapping to dismiss should clear in ~150ms with no bounce. Finish two athletes within a few seconds: the second card replaces the first without a lingering ghost.
- **Done when**: exit has no bounce and the inner card fades in.
