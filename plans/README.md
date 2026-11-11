# Animation plans

Audit of the Draft Combine app's motion (`deep`, 8 read-only auditors, every
finding re-read at its file:line before it was written down). Commit stamp:
`4df05ee`. Each plan is self-contained: exact paths, current code, exact target
values, boundaries and a feel check.

## Plans

| #   | Title                                                      | Severity | Status                                     |
| --- | ---------------------------------------------------------- | -------- | ------------------------------------------ |
| 001 | Replace `transition-all` on step dots and picker tiles     | LOW      | DONE (feel check pending)                  |
| 002 | Stop the foil recoil tween when the pack is grabbed again  | MEDIUM   | DONE (feel check pending)                  |
| 003 | Cut per-frame paint cost of the live HUD timer             | MEDIUM   | TODO (profile first; may be WONTFIX)       |
| 004 | Soften the reaction chip's press scale                     | LOW      | DONE (feel check pending)                  |
| 005 | Gate the two `animate-pulse` icons behind `motion-safe:`   | LOW      | DONE (feel check pending)                  |
| 006 | Let a re-grabbed card catch up instead of snapping         | MEDIUM   | TODO (feel-dependent)                      |
| 007 | Shorten the field-comparison bar transition                | LOW      | DONE (feel check pending)                  |
| 008 | Make the skeleton shimmer constant-speed                   | LOW      | DONE (feel check pending)                  |
| 009 | Make the shelf-tile press scale perceptible                | LOW      | DONE (feel check pending)                  |
| 010 | Make nav route-state changes instant                       | LOW      | DONE (feel check pending)                  |
| 011 | Write card tilt as a direct `transform`, not CSS variables | MEDIUM   | TODO (profile first; may be WONTFIX)       |
| 012 | Introduce one shared ease-out and swap the weak curves     | LOW      | DONE (feel check pending)                  |
| 013 | Make the finish celebration leave quickly, arrive no pop   | LOW      | DONE (feel check pending)                  |
| 014 | Make the pack-stand swipe follow the finger (spike)        | MEDIUM   | TODO (spike; keep only if it feels better) |
| 015 | Animate leaderboard rows when a finish reorders them       | LOW      | DONE (feel check pending)                  |
| 016 | Give staged trade cards a short enter                      | LOW      | DONE (feel check pending)                  |
| 017 | Add press feedback to vote and draft tiles                 | LOW      | DONE (feel check pending)                  |

015–017 and 014 are missed opportunities (additive); the rest correct existing motion.

## Recommended order

1. **Safe one-liners** (any order, can be one PR): 001, 005, 008, 007, 004, 009, 010, 013.
2. **Interaction fixes**: 002, then 017, 016, 015.
3. **Profile-gated**: 003 and 011 start with a mandatory on-device profile and may be closed WONTFIX with numbers. Do 011 **before** 006 (same function in `holo-card.tsx`).
4. **Feel-dependent**: 006, then 014 (spike). Verify both on a real phone; revert if they feel worse.
5. **Last**: 012. It touches lines other plans edit (`card-social.tsx`, `site-nav.tsx`, `styles.css`), so run it after them; its steps skip rows that have already changed.

## Dependencies and overlaps

- 011 -> 006 (both edit `applyTilt` in `src/components/holo-card.tsx`).
- 012 after 004, 010 (same files, different lines).
- 009 changes a comment in `src/styles.css` that 012 also edits near; independent hunks.
- 014 is independent but the riskiest; do it alone in its own PR.

## Deliberately NOT planned (vetted and rejected)

- Sticky-hover claims (`dust-chip.tsx:58`, `pack-stand.tsx:1019`, trade buttons): wrong; `styles.css:25-44` already promotes `hover:` to `:active` on touch.
- Vault card-grid "no press feedback": unverified (depends on `group-hover:` under that promotion). Needs a phone before any plan.
- `.holo-settle` at 460ms: a physical release on a showpiece card; only its interruptibility is planned (006).
- `sheet.tsx` `ease-in`: unmodified shadcn, only caller is the admin result editor.
- Pack-stand springs, secret flip, tear choreography, CSS reduced-motion coverage: documented and deliberate.

## Needs a phone, not a plan

Streak-flame `drop-shadow` loop, the 64px `secret-seal` shadow, the pack-wrapper
god-ray blur stack, `finish-celebration`'s backdrop blur, and how long each
card step feels on the pack stand (`mode="wait"` plus two springs).

## Conventions every executor must follow

- `bun run format` then `bun run lint` (Prettier runs through ESLint), plus `typecheck` and `test`. **Do not run `test:e2e`** (CI only).
- Colours are `oklch()`; times in ms; never hand-edit `src/routeTree.gen.ts` or `src/integrations/supabase/`.
- If the code does not match a plan's quoted excerpt, stop and report rather than improvise.
