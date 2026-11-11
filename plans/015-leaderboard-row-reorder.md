# 015 — Animate leaderboard rows when a new finish reorders them

- **Status**: DONE (code applied; device feel check still pending)
- **Commit**: 4df05ee
- **Severity**: LOW (missed opportunity)
- **Category**: Missed opportunity
- **Estimated scope**: 2 files, ~12 lines

## Problem

New finishes arrive over realtime. Rows are inserted and reordered with no
motion, so positions teleport at the moment the whole garden is watching the
board and nobody can tell where a bumped athlete went. The lists are small
(13 rows), so a layout animation is cheap.

```tsx
// src/routes/leaderboard.tsx:176-184 — current
<ol className="list-none divide-y divide-white/5">
  {rows.map((row) => (
    <li
      key={row.run.id}
      className={cn(
        "flex items-center gap-3 px-4 py-3 transition",
        row.place === 1 && "bg-primary/[0.06] shadow-[inset_3px_0_0_0_var(--color-primary)]",
      )}
    >
```

```tsx
// src/routes/live.tsx:373-380 — current
<ol className="space-y-1.5">
  {leaderboard.map((row) => {
    const art = avatarFor(row.ep, cards, photos);
    return (
      <li
        key={row.run.id}
        className="flex items-center gap-2 rounded-md border border-primary/5 bg-[oklch(0.16_0.02_240)] px-2 py-2"
      >
```

Gotcha: Tailwind v4's bare `transition` utility includes `transform` in its
property list, so on the leaderboard `li` it would run a CSS transition against
the inline transform Motion writes during a layout animation, producing laggy,
double-animated rows. It must become `transition-colors`.

## Target

```tsx
// leaderboard.tsx
<motion.li
  key={row.run.id}
  layout="position"
  transition={{ type: "spring", duration: 0.5, bounce: 0.2 }}
  className={cn(
    "flex items-center gap-3 px-4 py-3 transition-colors",
    row.place === 1 && "bg-primary/[0.06] shadow-[inset_3px_0_0_0_var(--color-primary)]",
  )}
>
...
</motion.li>

// live.tsx
<motion.li
  key={row.run.id}
  layout="position"
  transition={{ type: "spring", duration: 0.5, bounce: 0.2 }}
  className="flex items-center gap-2 rounded-md border border-primary/5 bg-[oklch(0.16_0.02_240)] px-2 py-2"
>
...
</motion.li>
```

Both files add `import { motion } from "motion/react";`. No `initial`/`exit`
(only reorders animate; first paint and removal are instant).

## Repo conventions to follow

- `motion` v14 is already in the root chunk (`docs/confidence-report.md` notes `motion` rides on every page); no dependency change.
- `<MotionConfig reducedMotion="user">` at `src/routes/__root.tsx:~237` already strips layout/transform animation for reduced-motion users; no extra branch needed.
- Spring spec `{ type: "spring", duration: 0.5, bounce: 0.2 }` is the Apple-style config from AUDIT §4.

## Steps

1. `src/routes/leaderboard.tsx`: import `motion`, change the `li` to `motion.li` with `layout="position"` and the transition, and change `transition` → `transition-colors` in its class string. Close tag `</li>` → `</motion.li>` (find it at the end of the row JSX).
2. `src/routes/live.tsx`: same change for the row `li` at ~line 377 (leave `HudTimer` and everything else alone).
3. `bun run format && bun run lint && bun run typecheck && bun run test` (`live.test.tsx` and any leaderboard tests must pass; `motion.li` renders a plain `li`).

## Boundaries

- Do NOT add `AnimatePresence`, `initial`, or `exit`.
- Do NOT use `layout` (full) — `layout="position"` avoids stretching row contents.
- Do NOT touch row contents, ordering/ranking logic, or realtime hooks.
- If the markup differs from the quote, STOP and report.

## Verification

- **Mechanical**: commands in Step 3.
- **Feel check**: open `/leaderboard` and `/live` in two tabs; as an admin, record a finish that beats an existing time. Rows below the insertion point should slide down smoothly (~0.5s, tiny bounce) rather than teleport; a leader change should visibly swap. At 10% playback speed, confirm no row stretches or squashes. With reduced motion emulated, rows just update in place.
- **Done when**: reorders animate, first load does not, and checks pass.
