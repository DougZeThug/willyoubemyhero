# Clear the 108 lint warnings

## What they are

| Rule | Count | What it means |
| --- | --- | --- |
| react-refresh/only-export-components | 33 | Hot-reload hint: a file exports something that isn't a component. 30 of them are in route files. |
| react-hooks/set-state-in-effect | 41 | State set inside an effect: an extra render, sometimes a flash of the wrong value |
| react-hooks/refs | 22 | A ref is read during render (pack-wrapper 7, zoom-pan-frame 5, pack-stand 4) |
| react-hooks/immutability | 6 | A value is changed after React has taken it |
| react-hooks/purity | 5 | `Date.now()` / random called during render (the timers, live HUD) |
| react-hooks/preserve-manual-memoization | 1 | pack-opening |

All five react-hooks rules were set to "warn" during the ESLint 10 bump so they could be cleaned up gradually. That's what this plan does.

## Phases (each one runs the full gate before the next starts)

1. **Route-file noise (about 30).** TanStack route files have to export `Route`, so that warning is a false alarm. Add `allowExportNames: ["Route"]` to the rule config. Move the other shared exports (helpers in admin.tsx, __root.tsx, players.$id.tsx, players.trade.tsx, locked-card.tsx) into small modules next to the routes. No behaviour change.
2. **Mechanical hooks fixes (about 25).** Values worked out in an effect become plain values computed during render. Mount-only flags (reduced-motion, device-id, auth/claim/you) move to `useSyncExternalStore` or `useHydrated`. Prop-to-state resets use a `key` or work out the value during render. One file per commit-sized step, tests run after each.
3. **Timing and the live clock (purity 5, related refs and effects).** big-timer, hud-timer, use-live-hud, use-run-console, live.tsx. The current time goes into state on a tick instead of being read during render. This is the riskiest area (live race timing), so only proven-equivalent rewrites go in, and the existing timing and race tests have to stay green.
4. **Pack animations (refs, immutability, memoization).** pack-wrapper, pack-stand, zoom-pan-frame, pack-opening, card-prompt-tools, edit-result-sheet. Refs are read only in handlers and effects, and objects are copied instead of changed in place. Then a phone-sized smoke of opening a pack and of zoom/pan.
5. **Lock it in.** Set each react-hooks rule back to "error" once it's at zero, and remove the explanatory comment in `eslint.config.js`. Any rule that can't reach zero safely stays "warn", with the remaining sites listed.

## Not touched

- `src/components/ui/carousel.tsx` (unmodified shadcn): suppressed with one targeted line, not rewritten.
- No change to timing results, pack odds, rewards or any stored data.
- Formatting is checked with lint in each phase. `test:e2e` stays CI-only.

## Verification

After every phase: format, lint (warning count must drop and stay at 0 errors), typecheck, all tests, build. Browser smoke after phases 3 and 4: the live timer running, opening a pack, zooming into a card.
