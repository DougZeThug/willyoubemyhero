# 017 — Add press feedback to vote and draft tiles

- **Status**: DONE (code applied; device feel check still pending)
- **Commit**: 4df05ee
- **Severity**: LOW (missed opportunity)
- **Category**: Missed opportunity / Press feedback
- **Estimated scope**: 2 files, 2 class edits

## Problem

Vote tiles and draft-position tiles are thumb targets that get tens of taps per
session, yet only have colour/border transitions. The vote's selected highlight
only appears after a server round trip (`await voteFn` + query invalidation), so
on a bad connection a tap shows nothing but `disabled:opacity-50`.

```tsx
// src/routes/awards.tsx:225-231 — current
<button
  key={p.id}
  onClick={() => vote(cat.id, pid)}
  disabled={!me || pending === key}
  className={cn(
    "flex min-h-11 items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors disabled:opacity-50",
```

```tsx
// src/routes/draft.tsx:229-232 — current
disabled={isTaken || !isAdmin || !currentPicker || busy}
className={cn(
  "aspect-square rounded-lg border p-2 text-left transition",
```

(Draft tiles are only interactive for an admin, so that half is lower value.)

Gotcha: bare `transition` in Tailwind v4 already includes `transform`, but
`transition-colors` does not.

## Target

Subtle press (0.97, 160ms strong ease-out), only on enabled buttons:

```tsx
// awards.tsx
"flex min-h-11 items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-[color,background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] enabled:active:scale-[0.97] disabled:opacity-50",

// draft.tsx (keep `transition`, add the press and an explicit curve)
"aspect-square rounded-lg border p-2 text-left transition duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] enabled:active:scale-[0.97]",
```

## Repo conventions to follow

- `hover:` utilities are promoted to `:active` on touch by the variant at `src/styles.css:25-44`; an explicit `active:` utility outranks it (that comment explains the cascade). Keep `active:` after any `hover:` in each class list (it already is).

## Steps

1. Edit both class strings as in Target (match on the quoted prefixes; the rest of each string stays).
2. `bun run format && bun run lint && bun run test`.

## Boundaries

- Do NOT touch the `chosen`/`isTaken` colour logic, `disabled` handling, or the avatars.
- If either quoted string has changed, STOP and report.

## Verification

- **Mechanical**: commands in Step 2.
- **Feel check** (phone): on Awards, press a nominee tile: it dips instantly even before the vote lands; disabled tiles (not signed in / pending) do not dip. As admin on Draft, press an open position: same.
- **Done when**: both tiles dip on press only when enabled, and checks pass.
