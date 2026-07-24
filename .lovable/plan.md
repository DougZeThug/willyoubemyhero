## Goal
Redesign the Live dashboard (and shared chrome) to match the uploaded reference: a broadcast-grade "HUD" look with a hero circular timer, chrome bezels, a segmented progress bar with a heartbeat glyph, and a subtle circuit-board texture. Swap the current electric-green accent for a cool cyan/teal/blue palette so the app reads as bespoke sports-tech rather than default AI green.

## Scope (visual/frontend only)
- `src/styles.css` — retune `--primary`, `--accent`, `--ring`, `--chart-*`, `--field`, `--sidebar-*` to a cyan/teal system; add HUD tokens and utilities.
- `src/routes/index.tsx` — recompose Live page around a hero circular timer HUD.
- `src/components/big-timer.tsx` — add a circular ring variant (SVG progress ring + centered digits + status label).
- `src/components/site-nav.tsx` — centered two-line wordmark (no square logo tile); restyle bottom-nav active state as a neon-cyan underline + glow.
- `src/routes/leaderboard.tsx`, `order.tsx`, `draft.tsx`, `admin.tsx` — apply the shared new header/section styling for cohesion (no logic changes).

No changes to data, timing logic, routing, auth, or Supabase.

## Palette (cool cyan/teal/blue, dark-first)
- `--background`: near-black with a faint blue tint (oklch ~0.14 0.02 240).
- `--card`: slate-navy (~0.19 0.02 240).
- `--primary`: electric cyan (~0.82 0.15 210) — used for timer digits, ring stroke, active nav.
- `--accent`: teal (~0.72 0.13 195) — secondary highlights, dividers.
- `--chart-*` remapped to cyan / teal / sky / ice / warn-amber.
- `--warn` (penalty) stays amber for contrast.
- `--destructive` stays red.
- New: `--glow-primary` (cyan soft shadow), `--gradient-bezel` (dark chrome ring), `--gradient-hud` (radial cyan bloom).

All color usage stays on semantic tokens; no hardcoded hex in components.

## Key design moves (from the reference, recolored)
1. **Hero HUD**: large circular timer, dual-ring bezel (outer dark chrome, inner cyan glow), tick marks at cardinals, avatar/silhouette centered behind digits, status label ("ON DECK" / "ON THE CLOCK" / "FINISHED").
2. **Progress bar**: full-width hatched bar showing `done / total athletes completed`, small ECG/heartbeat SVG + % on the right cap. Replaces the current Users badge.
3. **Wordmark**: two-line centered "WILL YOU BE MY HERO? / DRAFT COMBINE" in Barlow Condensed; no square logo tile.
4. **Primary actions**: two cyan-outlined pill buttons under the HUD — "VIEW RUNNING ORDER" and "LEADERBOARD".
5. **Background**: subtle circuit-trace SVG + vignette behind the hero on the Live route (replaces `field-lines` there).
6. **Telemetry strip**: Up Next + Top 5 demoted into two slim panels below the HUD so the HUD owns the first mobile screen.
7. **Bottom nav**: keep 5 items, restyle with thin-stroke icons and a cyan underline-glow for the active item.

## Technical notes
- Circular ring built as inline SVG with `stroke-dasharray` for progress; digits absolutely centered; wrapper uses `aspect-square` + `max-w-[22rem]` for clean 360px scaling.
- New `@utility` classes: `hud-ring`, `neon-btn`, `progress-hatched`, `circuit-bg` (SVG data-URI).
- Mobile-first: verify at 360×629 before scaling up.

## Out of scope
- Timing engine, admin controls, Supabase, auth, routes.
- Light mode.
- Reference image's phone status bar / device frame.
