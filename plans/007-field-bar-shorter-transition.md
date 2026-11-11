# 007 — Shorten the field-comparison bar transition

- **Status**: DONE (code applied; device feel check still pending)
- **Commit**: 4df05ee
- **Severity**: LOW
- **Category**: Easing & duration (and performance)
- **Estimated scope**: 1 file, 1 class edit

## Problem

The per-station stat bar animates `width` (a layout property) for 700ms with the
weak built-in `ease-out`. It only fires when `ms` or `worst` changes after the
first paint, but when it does it is 2× the 300ms UI budget.

```tsx
// src/components/field-comparison.tsx:73 — current
className="block h-full rounded-full transition-[width] duration-700 ease-out"
style={{
  width: `${Math.max(4, ((row.ms ?? 0) / worst) * 100)}%`,
```

`src/components/field-comparison.test.tsx:172-187` asserts the inline `style.width`
values (`"50%"`, `"100%"`, `"4%"`). Therefore **keep `width`**; do NOT convert to
`scaleX` in this plan.

## Target

```tsx
className =
  "block h-full rounded-full transition-[width] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]";
```

## Repo conventions to follow

- Strong ease-out `cubic-bezier(0.23, 1, 0.32, 1)` is the project's chosen curve (see plan 012); inline it here so this plan stands alone.

## Steps

1. `src/components/field-comparison.tsx:73`: replace `duration-700 ease-out` with `duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]`.
2. `bun run format && bun run lint && bun run test`.

## Boundaries

- Do NOT change the `style.width` computation, the 4% minimum, colours, or the `hidden … min-[380px]:block` wrapper.
- If the line has changed, STOP and report.

## Verification

- **Mechanical**: `bun run typecheck && bun run lint && bun run test` (`field-comparison.test.tsx` green).
- **Feel check**: open a player profile with the field comparison, trigger a data change (admin edits a time, or reload with different results while the page is open). Bars should settle quickly (~0.3s) without overshoot.
- **Done when**: `grep -n "duration-700" src/components/field-comparison.tsx` is empty.
