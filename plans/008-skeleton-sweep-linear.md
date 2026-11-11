# 008 — Make the skeleton shimmer constant-speed

- **Status**: TODO
- **Commit**: 4df05ee
- **Severity**: LOW
- **Category**: Easing & duration
- **Estimated scope**: 1 file, 1 word

## Problem

The skeleton shimmer is a constant sweep. With `ease-in-out` each pass
accelerates and decelerates, so a dozen tiles hesitate at both ends of every
2.6s loop; AUDIT: constant motion takes `linear`.

```css
/* src/styles.css:1693-1699 — current */
.skeleton-sweep::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(
    100deg,
    transparent 20%,
    oklch(0.82 0.14 210 / 12%) 50%,
    transparent 80%
  );
  background-size: 220% 100%;
  animation: skeleton-sweep 2.6s ease-in-out infinite;
}
```

(The slow 2.6s duration, the reduced-motion block at ~1711 and the explanatory
comment at ~1672 are deliberate. The comment explains the _duration_, not the
easing.)

## Target

```css
animation: skeleton-sweep 2.6s linear infinite;
```

Do NOT convert the `background-position` keyframes to `transform` in this plan
(a follow-up only if a device profile shows paint cost).

## Repo conventions to follow

- Other constant sweeps in `styles.css` already use `linear`: `animation: holo-idle-sweep 6.5s linear infinite;` (~line 1122).

## Steps

1. In `src/styles.css`, in the `.skeleton-sweep::after` rule, change `ease-in-out` to `linear`.
2. `bun run format && bun run lint && bun run test` (`src/styles.test.ts` must pass).

## Boundaries

- Do NOT change the keyframes, duration, colours, or the `@media (prefers-reduced-motion: reduce)` block.
- Do NOT touch the other `ease-in-out` loops (`holo-prism-pulse`, `tear-hint-travel`, `secret-seal-breathe`, `streak-flame-breathe`): they are on-screen breathing/looping motion, deliberate.
- If the quoted rule has changed, STOP and report.

## Verification

- **Mechanical**: commands in Step 2.
- **Feel check**: throttle the network so the vault shows skeletons for several seconds. The sheen should glide at a constant speed without pausing at the tile edges. With reduced motion on, it stays the static/faint treatment.
- **Done when**: `.skeleton-sweep::after` uses `linear`.
