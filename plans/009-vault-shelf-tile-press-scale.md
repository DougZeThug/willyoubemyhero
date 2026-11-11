# 009 — Make the shelf-tile press scale perceptible

- **Status**: DONE (code applied; device feel check still pending)
- **Commit**: 4df05ee
- **Severity**: LOW
- **Category**: Physicality (press feedback)
- **Estimated scope**: 2 files (one class edit, one comment)

## Problem

The collection-shelf tiles shrink to 0.99 on press: about 3px on a ~300px tile,
effectively invisible.

```tsx
// src/routes/players.index.tsx:986 — current
className={cn(shell, "transition-transform hover:scale-[1.02] active:scale-[0.99]")}
```

Context: `src/styles.css:5-44` redefines the `hover` variant so that `hover:`
utilities fire on `:active` on touch devices, with an explicit `active:`
utility outranking the promoted hover. That comment (lines ~21-24) says this
"keeps players.index.tsx's pressed tile shrinking to 0.99 rather than growing to
the 1.02 its hover asks for". The _mechanism_ is deliberate; the magnitude was
not chosen by feel.

## Target

```tsx
className={cn(
  shell,
  "transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:scale-[1.02] active:scale-[0.97]",
)}
```

and update the comment in `styles.css` from `0.99` to `0.97`.

## Repo conventions to follow

- Keep `active:` after `hover:` in the class list (cascade order is what the variant redefinition relies on).
- Press scale range 0.95–0.98 (AUDIT §3).

## Steps

1. `src/routes/players.index.tsx:986`: replace the class string with the Target.
2. `src/styles.css` (~line 22): change "shrinking to 0.99" to "shrinking to 0.97".
3. `bun run format && bun run lint && bun run test`.

## Boundaries

- Do NOT touch the vault _card grid_ links (`players.index.tsx:~1076-1105`, `group-hover:scale-[1.02]` on `HoloCard`). Whether that grid has press feedback on touch is unverified and needs a phone; that is a separate decision.
- Do NOT change `shell`, borders, or the trophy rarity style.
- If lines differ, STOP and report.

## Verification

- **Mechanical**: commands in Step 3.
- **Feel check** (phone): press and hold a collection-shelf tile: it should visibly sink (~3% each way ≈ 9px), release should spring back crisply, quick repeated taps should never stick.
- **Done when**: `grep -n "scale-\[0.99\]" src/routes/players.index.tsx src/styles.css` is empty.
