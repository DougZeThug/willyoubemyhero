# 012 — Introduce one shared ease-out and swap the weak curves

- **Status**: TODO (run LAST: it touches lines other plans also edit)
- **Commit**: 4df05ee
- **Severity**: LOW
- **Category**: Cohesion & tokens
- **Estimated scope**: 1 new file (`src/lib/motion.ts`), 1 CSS variable, ~10 call sites

## Problem

The app has no easing or duration tokens. Hand-typed curves drift, and several
motion/react transitions use the library default or the weak built-in `easeOut`/
`easeIn`.

```css
/* src/styles.css:500-503 and 559-563 — button chrome */
transition:
  transform 120ms ease,
  box-shadow 120ms ease,
  background 120ms ease;
/* src/styles.css:774 — */
.holo-settle {
  transition: transform 460ms cubic-bezier(0.22, 1, 0.36, 1);
}
```

```tsx
// src/components/milestone-reveal.tsx:189
transition={{ duration: 0.35 }}
// src/components/bought-pull-reveal.tsx:116
transition={{ duration: 0.35 }}
// src/components/pack-summary.tsx:187
transition={{ duration: 0.4 }}
// src/components/pack-summary.tsx:293-295 (caption, no transition prop)
initial={{ opacity: 0 }} animate={{ opacity: 1 }}
// src/components/pack-wrapper.tsx:732
transition={{ duration: 0.42, ease: "easeIn" }}
// src/components/card-social.tsx:387
transition={{ duration: 0.55, ease: "easeOut", delay: i * 0.02 }}
// src/components/site-nav.tsx:60
const step = { duration: reduced || !presenting ? 0 : 0.3, ease: "easeOut" } as const;
```

## Target

One source of truth in each world:

```ts
// src/lib/motion.ts (new)
/** Strong ease-out for entrances/exits and UI feedback. */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
```

```css
/* src/styles.css, inside the existing :root { ... } block (line ~134), next to --gradient-hud */
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
```

Swap exactly these call sites (values spelled out):

| File:line                                                | Change                                                                                    |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `milestone-reveal.tsx:189`, `bought-pull-reveal.tsx:116` | `transition={{ duration: 0.35, ease: EASE_OUT }}`                                         |
| `pack-summary.tsx:187`                                   | `transition={{ duration: 0.3, ease: EASE_OUT }}`                                          |
| `pack-summary.tsx:293-295`                               | add `transition={{ duration: 0.2, ease: EASE_OUT }}`                                      |
| `pack-wrapper.tsx:732`                                   | `transition={{ duration: 0.42, ease: EASE_OUT }}` (was `"easeIn"`)                        |
| `card-social.tsx:387`                                    | `transition={{ duration: 0.3, ease: EASE_OUT, delay: i * 0.02 }}` (was 0.55s `"easeOut"`) |
| `site-nav.tsx:60`                                        | `ease: EASE_OUT` (keep `0.3` and the asymmetric `0` snap-back)                            |
| `styles.css:774` `.holo-settle`                          | `transition: transform 460ms var(--ease-out);` (duration unchanged)                       |

Do NOT change the button chrome (`120ms ease`): hover/colour/press use bare
`ease` per AUDIT, and the app's own comments document it. Do NOT add
duration tokens.

## Repo conventions to follow

- `src/lib/` holds domain logic and small helpers; `src/lib/motion.ts` fits (no `.server`/`.functions` suffix).
- Colours are `oklch()`; this is a curve, so CSS custom property naming `--ease-out` matches `--gradient-hud`.
- Intentionally different showpiece curves stay as they are: `FLIP_CURVE` `cubic-bezier(0.5, 0, 0.25, 1.18)` and the `0.33, 0.9, 0.3, 1` shine glide (`styles.css:813, 887`).

## Steps

1. Create `src/lib/motion.ts` with `EASE_OUT`.
2. Add `--ease-out` to the `:root` block in `src/styles.css`.
3. For each row of the table: re-read the line; if it still matches the quoted code apply the change and add `import { EASE_OUT } from "@/lib/motion";`; if an earlier plan has already changed it, skip that row and note it.
4. `bun run format && bun run lint && bun run typecheck && bun run test`.

## Boundaries

- Do NOT add `--duration-*` tokens or a motion config object.
- Do NOT touch `FLIP_CURVE`, ceremony timing constants (`CEREMONY`, `BEAT_MS`, `SLAM_MS`), or any `ease-in-out` loop.
- Do NOT change reduced-motion handling.
- If three or more rows do not match, STOP and report.

## Verification

- **Mechanical**: commands in Step 4. `grep -rn '"easeIn"\|"easeOut"' src --include=*.tsx | grep -v components/ui` returns nothing.
- **Feel check**: run a pack open + milestone reveal + bought-pull reveal: entrances start slightly snappier, nothing else shifts. Fire reactions on a card: burst is shorter (0.3s) but still reads. Open/close a ceremony and watch the nav fade (still 0.3s out, instant back).
- **Done when**: every row applied or skipped with a note, and checks pass.
