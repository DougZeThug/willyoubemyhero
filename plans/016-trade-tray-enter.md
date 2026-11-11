# 016 — Give staged trade cards a short enter

- **Status**: DONE (code applied; device feel check still pending)
- **Commit**: 4df05ee
- **Severity**: LOW (missed opportunity)
- **Category**: Missed opportunity
- **Estimated scope**: 1 file, ~10 lines

## Problem

Adding a card to a trade offer pops it into the tray instantly, and the "n / 3"
counter and the Add button jump with it. It is the one list-change seam in the
trade flow and the user is watching it as they build an offer.

```tsx
// src/components/trade-builder.tsx:556-577 — current
{staged.length > 0 && (
  <ul className="mb-3 grid grid-cols-2 gap-2">
    {staged.map((s) => (
      <li key={s.key} className="flex flex-col items-center">
        <TradeItemTile item={s.item} lookup={lookup} size="lg" concealed={conceal && s.item.viewerOwns === false} backUrl={backUrl} />
        <button type="button" onClick={() => onRemove(s)} ... >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </li>
    ))}
  </ul>
)}
```

## Target

A 150ms enter (opacity + subtle scale from 0.96), no exit, and no animation of
the cards that are already there on first render:

```tsx
<ul className="mb-3 grid grid-cols-2 gap-2">
  <AnimatePresence initial={false}>
    {staged.map((s) => (
      <motion.li
        key={s.key}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
        className="flex flex-col items-center"
      >
        ...unchanged children...
      </motion.li>
    ))}
  </AnimatePresence>
</ul>
```

with `import { AnimatePresence, motion } from "motion/react";`.

## Repo conventions to follow

- `AnimatePresence` + `motion.*` usage: `src/components/finish-celebration.tsx:~80` and `src/components/pack-stand.tsx:~729`.
- Reduced motion is covered globally by `MotionConfig` in `src/routes/__root.tsx`.
- Do NOT give the list an exit or `layout`: it is a high-frequency action on a busy page.

## Steps

1. Edit `trade-builder.tsx` as in Target, keeping every child of the `li` unchanged.
2. `bun run format && bun run lint && bun run typecheck && bun run test` (`trade-builder.test.tsx` must pass; `motion.li` renders `li`, queries by role/text keep working).

## Boundaries

- Do NOT change the picker drawer, its unmount timer (`trade-builder.tsx:~105-111`, a documented tradeoff), counters, or validation.
- Do NOT add an exit animation.
- If the markup differs from the quote, STOP and report.

## Verification

- **Mechanical**: commands in Step 2.
- **Feel check**: build an offer; add three cards in a row. Each new tile fades/grows in over ~0.15s; opening a prefilled counter-offer shows the existing tiles with no enter animation; removing a card is instant.
- **Done when**: new tiles animate in, existing tiles do not, and checks pass.
