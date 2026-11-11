# 004 — Soften the reaction chip's press scale

- **Status**: TODO
- **Commit**: 4df05ee
- **Severity**: LOW
- **Category**: Physicality (press feedback)
- **Estimated scope**: 1 file, 1 class edit

## Problem

The reaction chip shrinks to 90% on press. It is small and tapped in rapid
succession during trash-talk, so the dip reads as a lurch, not a press.

```tsx
// src/components/card-social.tsx:356 — current
"inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm transition-transform duration-150 active:scale-90 disabled:opacity-50",
```

Duration (150ms) and property (`transform`) are already right and interruptible.

## Target

Subtle press (0.95–0.98 range) with the strong ease-out:

```tsx
"inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.96] disabled:opacity-50",
```

## Repo conventions to follow

- `src/components/card-social.tsx` already uses `transition-transform duration-150`; keep both.
- Press scales elsewhere in the repo: `src/routes/players.index.tsx:986` (`active:scale-[0.99]`, being corrected by plan 009).

## Steps

1. In `src/components/card-social.tsx` line 356, replace `active:scale-90` with `active:scale-[0.96]` and add `ease-[cubic-bezier(0.23,1,0.32,1)]` after `duration-150`.
2. `bun run format && bun run lint`.

## Boundaries

- Do NOT touch the burst particles (`card-social.tsx:~387`, covered by plan 012).
- Do NOT change `min-h-11` (touch target), borders, colours, or `disabled:opacity-50`.
- If the quoted line has changed, STOP and report.

## Verification

- **Mechanical**: `bun run typecheck && bun run lint && bun run test` (`card-social.test.tsx` does not assert this class).
- **Feel check** (phone): tap a reaction chip rapidly 6×. It should acknowledge each tap with a quick dip that is visible but not a lurch, and never get stuck small. Spam taps must retarget smoothly (it is a transition, so it will).
- **Done when**: `grep -n "active:scale-90" src/components/card-social.tsx` is empty and the above holds.
