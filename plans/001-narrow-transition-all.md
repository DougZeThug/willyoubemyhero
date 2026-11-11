# 001 — Replace `transition-all` on the step dots and picker tiles

- **Status**: DONE (code applied; device feel check still pending)
- **Commit**: 4df05ee
- **Severity**: LOW
- **Category**: Performance
- **Estimated scope**: 2 files, 2 one-line class edits

## Problem

`transition-all` animates every property that changes, including ones that were
never meant to move. Both uses are on elements tapped constantly.

```tsx
// src/components/pack-stand.tsx:170 — current (StepDots, inside StepDots())
className={cn("h-1 rounded-full transition-all", i === at ? "w-4" : "w-1")}
style={{ background: i <= at ? accent : "oklch(1 0 0 / 18%)" }}
```

The dot's active/inactive state changes `width` (layout) and `background`.
Nothing else should animate.

```tsx
// src/components/trade-offer-card.tsx:190 — current
"shrink-0 rounded-md p-1 text-left transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
selected ? "bg-primary/15 ring-2 ring-primary" : "hover:bg-white/[0.04]",
```

Only `background-color` and the ring (`box-shadow`) change here. A future
`width`/`transform` class would start animating by accident.

## Target

```tsx
// src/components/pack-stand.tsx:170
className={cn(
  "h-1 rounded-full transition-[width,background-color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
  i === at ? "w-4" : "w-1",
)}

// src/components/trade-offer-card.tsx:190
"shrink-0 rounded-md p-1 text-left transition-[background-color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
```

(Keep the `width` transition on the dots: it is a 4px-tall, three-element
indicator and the width change is the point. It is deliberately NOT converted
to `scaleX`.)

## Repo conventions to follow

- Tailwind v4 arbitrary transition lists, e.g. `transition-[width] duration-700 ease-out` at `src/components/field-comparison.tsx:73`.
- `StepDots` is documented as "deliberately faint" (`pack-stand.tsx:~160`): do not change `opacity-55`, sizes, or colours.

## Steps

1. In `src/components/pack-stand.tsx` find `className={cn("h-1 rounded-full transition-all", i === at ? "w-4" : "w-1")}` (line 170) and replace it with the Target block above. Prettier will want the multi-line `cn(` form shown.
2. In `src/components/trade-offer-card.tsx` line 190, replace `transition-all` with `transition-[background-color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]`.
3. Run `bun run format` then `bun run lint`.

## Boundaries

- Do NOT touch any other `transition-*` class in either file.
- Do NOT change markup, sizes, colours or the `aria-*` attributes.
- Do NOT add dependencies.
- If line 170 / 190 no longer matches the quoted code, STOP and report.

## Verification

- **Mechanical**: `bun run format && bun run lint && bun run typecheck && bun run test` all pass. `grep -rn "transition-all" src --include=*.tsx | grep -v components/ui` returns nothing.
- **Feel check** (`bun run dev`): open a pack to the stand, advance cards, and confirm the active dot grows and recolours smoothly without any other jitter. On the trade offer picker, tap a tile and confirm the ring/background change still fades in ~150ms. In DevTools Animations at 10% speed, confirm only `width`/`background-color` (dots) and `background-color`/`box-shadow` (tiles) animate.
- **Done when**: no `transition-all` remains outside `src/components/ui`, and the checks above pass.
