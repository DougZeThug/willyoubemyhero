# Slow down the pack tear and card-hover ceremony

## Goal
Make the pack-opening moment feel satisfying instead of rushed. Give the user enough time to see the foil tear, watch the cards rise out of the opening, and enjoy them hovering in the fan before they square up for the reveal.

## Current state
- The pack ceremony is driven by `src/lib/pack-ceremony.ts` and rendered in `src/components/pack-opening.tsx` + `src/components/pack-wrapper.tsx`.
- Total runtime: **~2.24 s** (`rip` 300 ms → `peel` 420 ms → `mouth` 200 ms → `launch` 340 ms → `fan` 460 ms → `hold` 180 ms → `collapse` 340 ms).
- The `Skip` button stays available throughout, so power users can still bail out.
- The e2e suite relies on `CEREMONY_MS` and a `SKIP_DEAD_MS` dead zone; timing constants are referenced in `e2e/journeys.spec.ts`.

## Proposed options

Choose one of the following presets. Each keeps the same phase order and the same skip behaviour; only durations and a few spring constants change.

### Option A — "Theatrical" (recommended)
Stretch the ceremony to **~3.5 s** so every beat is readable without becoming a chore.

- `rip` 300 ms → **420 ms** — the user finishes the drag and the strip still visibly peels the rest of the way.
- `peel` 420 ms → **600 ms** — shards tumble longer and stay visible before they fade out.
- `mouth` 200 ms → **280 ms** — a clear pause where the pack is open and glowing before anything moves.
- `launch` 340 ms → **520 ms** — cards rise out of the mouth slowly, staggered by ~80 ms each.
- `fan` 460 ms → **640 ms** — the arc spreads gently and the cards hover in place.
- `hold` 180 ms → **380 ms** — the user actually gets to look at the fanned backs.
- `collapse` 340 ms → **460 ms** — the deck gathers without snapping shut.

Total: **~3.3 s**.

Also tune the per-card springs:
- Rise delay: `i * 0.055` → **i * 0.08**
- Fan delay: `i * 0.06` → **i * 0.085**
- Secret `SECRET_BEAT` 0.11 s → **0.22 s** so the fourth card arrives as its own moment.

### Option B — "Cinematic"
Stretch to **~4.8 s** for a much slower, deliberate reveal.

- `rip` 500 ms, `peel` 760 ms, `mouth` 360 ms, `launch` 720 ms, `fan` 840 ms, `hold` 560 ms, `collapse` 560 ms.
- Per-card delays roughly doubled (`i * 0.12`, `i * 0.13`).
- Secret beat 0.35 s.

Best for first-time users; may feel slow after the 3rd or 4th pack.

### Option C — "Keep it snappy, just a beat longer"
Stretch to **~2.9 s** — a modest bump that keeps the daily loop fast.

- `rip` 360 ms, `peel` 520 ms, `mouth` 240 ms, `launch` 440 ms, `fan` 520 ms, `hold` 280 ms, `collapse` 380 ms.
- Per-card delays: `i * 0.065` and `i * 0.07`.
- Secret beat 0.15 s.

## What else changes

1. **Spring stiffness/damping** — slower phases need slightly lower stiffness so the cards don’t overshoot and then sit still for ages. For `rise`, `fan`, and `deck` variants, drop stiffness by ~20 % and damping by ~1–2 points so the motion stays fluid.
2. **Sound timing** — `playPackOpen`, `playPackBurst`, and `playDeckGather` are scheduled against `CEREMONY_START`. They will stay tied to the same phase names, so they naturally shift with the new durations.
3. **E2E tests** — The skip-dead-zone test in `e2e/journeys.spec.ts` uses `CEREMONY_MS` and `SKIP_AFTER_MS`; it will continue to work as long as `SKIP_AFTER_MS` is kept well below the new `CEREMONY_MS`. Any hard-coded waits elsewhere should be replaced with the same constants.
4. **Reduced motion** — the fast path (`reduced === true`) is unchanged: it still calls `finish()` immediately.
5. **Skip button** — unchanged; it will simply stay on screen longer.

## Verification plan
- `bun run lint` and `bun run typecheck` after edits.
- `bun run test` to confirm unit tests still pass with new `CEREMONY_MS`.
- Run the targeted e2e spec: `bun run test:e2e -g "opening a pack"` and inspect the skip test specifically.
- Manual preview check: rip a pack on a phone-sized viewport and confirm the tear, shard tumble, mouth glow, card rise, fan hover, and collapse are all readable.

## Files to edit
- `src/lib/pack-ceremony.ts` — the timing table and spring constants.
- `src/components/pack-opening.tsx` — update `SECRET_BEAT` and card transition delays.
- `e2e/journeys.spec.ts` — only if any timing assertion is hard-coded; otherwise constants handle it.
