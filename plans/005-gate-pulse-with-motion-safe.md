# 005 — Gate the two `animate-pulse` icons behind `motion-safe:`

- **Status**: TODO
- **Commit**: 4df05ee
- **Severity**: LOW
- **Category**: Accessibility
- **Estimated scope**: 2 files, 2 class edits

## Problem

Tailwind's `animate-pulse` is an infinite 1-second opacity loop. The app's
reduced-motion handling does not reach it: `<MotionConfig reducedMotion="user">`
only covers `motion/react`, and none of the ten `prefers-reduced-motion` blocks
in `src/styles.css` mentions it (`grep -n "animate-pulse" src/styles.css` hits
only two comments, lines 1421 and 1675).

```tsx
// src/routes/live.tsx:152 — current (spectator page, watched the longest)
<Radio className="h-4 w-4 animate-pulse" />
```

```tsx
// src/routes/admin.tsx:569 — current
slot.onClock ? "animate-pulse text-primary" : "text-muted-foreground",
```

Spinners (`animate-spin` in `feed-state.tsx:22`, `auth.tsx:231`, …) stay: they
aid comprehension (AUDIT: reduced motion = fewer, not zero).

## Target

```tsx
// src/routes/live.tsx:152
<Radio className="h-4 w-4 motion-safe:animate-pulse" />

// src/routes/admin.tsx:569
slot.onClock ? "motion-safe:animate-pulse text-primary" : "text-muted-foreground",
```

Under reduced motion the icon is simply static; the colour (`text-primary`) and
the "Live" heading already carry the meaning.

## Repo conventions to follow

- `src/components/pack-stand.tsx:782` gates its own pulse with `!reduced && "animate-pulse"`. For plain Tailwind class lists, `motion-safe:` is the equivalent.

## Steps

1. `src/routes/live.tsx:152`: change `animate-pulse` → `motion-safe:animate-pulse`.
2. `src/routes/admin.tsx:569`: change `"animate-pulse text-primary"` → `"motion-safe:animate-pulse text-primary"`.
3. `bun run format && bun run lint`.

## Boundaries

- Do NOT touch `animate-spin` usages or the skeleton sweep.
- Do NOT add a CSS override in `styles.css` for this.
- If a line no longer matches, STOP and report.

## Verification

- **Mechanical**: `bun run typecheck && bun run lint && bun run test` (`live.test.tsx` must stay green).
- **Feel check**: with `prefers-reduced-motion: no-preference` the radio icon still pulses on `/live` and on the admin "on the clock" row. In DevTools → Rendering → "Emulate CSS prefers-reduced-motion: reduce" both become static.
- **Done when**: both greps `grep -rn "animate-pulse" src --include=*.tsx | grep -v "motion-safe" | grep -v components/ui` show only `pack-stand.tsx:782` (already gated in JS).
