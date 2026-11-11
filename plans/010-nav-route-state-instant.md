# 010 — Make nav route-state changes instant

- **Status**: DONE (code applied; device feel check still pending)
- **Commit**: 4df05ee
- **Severity**: LOW
- **Category**: Purpose & frequency
- **Estimated scope**: 1 file, 3 class edits

## Problem

The nav is the most-pressed control in the app (100+ taps/day). Its links carry
`transition-colors`, so on a tab change the old tab's label fades out and the
new one fades in over Tailwind's default 150ms while the route itself swaps
instantly, and the 2px indicator bar (conditionally mounted) snaps. Chrome lags
the page and disagrees with itself.

```tsx
// src/components/site-nav.tsx:188 — current (mobile bar)
"relative flex flex-col items-center gap-1 whitespace-nowrap rounded-md py-2.5 text-nav font-bold uppercase tracking-[0.08em] transition-colors active:bg-white/5",
active === l.to ? "text-primary" : "text-muted-foreground",
```

```tsx
// src/components/site-nav.tsx:132 — current (desktop row)
"relative inline-flex min-h-11 items-center rounded-md px-3 py-1.5 text-sm font-semibold uppercase tracking-wide transition-colors pointer-fine:min-h-0",
```

```tsx
// src/components/site-nav.tsx:272 — current (ProfileLink)
"flex h-11 w-11 items-center justify-center transition-colors hover:text-primary md:w-16 md:justify-end",
```

## Target

- Mobile bar: no colour transition; keep a short press fill only (`background-color`, 100ms, strong ease-out).
- Desktop row and ProfileLink: no transition at all (hover and route state both snap, as AUDIT requires for high-frequency navigation).

```tsx
// :188
"relative flex flex-col items-center gap-1 whitespace-nowrap rounded-md py-2.5 text-nav font-bold uppercase tracking-[0.08em] transition-[background-color] duration-100 ease-[cubic-bezier(0.23,1,0.32,1)] active:bg-white/5",
// :132  (remove `transition-colors `)
"relative inline-flex min-h-11 items-center rounded-md px-3 py-1.5 text-sm font-semibold uppercase tracking-wide pointer-fine:min-h-0",
// :272  (remove `transition-colors `)
"flex h-11 w-11 items-center justify-center hover:text-primary md:w-16 md:justify-end",
```

## Repo conventions to follow

- The comment above line 188 (about the press fill being `white/5`, "a fill, not a bloom (§15)") documents the press treatment: keep its meaning; only the transition changes.
- Do not touch the `fade` of the bars during ceremonies (`step` at `site-nav.tsx:60`), which is covered by plan 012.

## Steps

1. Apply the three edits above exactly (line numbers may shift by a few lines; match on the quoted strings).
2. `bun run format && bun run lint && bun run test` (`site-nav` tests, if any, must pass; none assert `transition-colors`).

## Boundaries

- Do NOT change colours, `aria-*`, `min-h-11` targets, the indicator bar markup, or `inert`/presentation logic.
- If a quoted string is missing, STOP and report.

## Verification

- **Mechanical**: commands in Step 2.
- **Feel check** (phone): tap between tabs rapidly; the label colour and indicator bar change on the same frame as the page. Press-and-hold shows the `white/5` fill fading in over ~100ms. Desktop: hovering a nav link changes colour instantly.
- **Done when**: `grep -n "transition-colors" src/components/site-nav.tsx` is empty.
