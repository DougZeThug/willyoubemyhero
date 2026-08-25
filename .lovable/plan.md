# Polish the Make an Offer partner chips

Apply the selected "Neon HUD selection" direction to the partner-selection pills in the Trading Post so they feel like a live, tactile part of the HUD instead of flat outline buttons.

## What changes

Only the counterpartychip list in `src/routes/players.trade.tsx` (the "Make an offer" panel) changes. No server functions, routes, hooks, or schema are touched.

- **Unselected chip**: keep the rounded-full pill shape, but add a subtle inner shadow (`shadow-inner`) and a slightly more defined border (`border-white/10`) over a near-transparent background (`bg-white/5`). Text stays muted-foreground.
- **Hover state**: border brightens toward primary (`hover:border-primary/40`), text lifts toward primary (`hover:text-primary`), and the chip still feels active rather than disabled.
- **Selected chip**: becomes the HUD "live" state — a cyan border (`border-primary/60`), a low-opacity cyan fill (`bg-primary/10`), primary text, a thin ring (`ring-1 ring-primary/20`), and a soft cyan glow (`shadow`). The selected chip also includes a small electric-green dot (`bg-success` with a glow) before the name, as requested.
- **Layout**: keep the existing `flex flex-wrap gap-1.5` container and the same 10px uppercase/tracking label styling. No new chip sizes or shapes.

## Implementation notes

- All colours come from the existing semantic tokens in `src/styles.css` (`primary`, `success`, `muted-foreground`, `background` equivalents) so the change stays in the HUD theme and works in dark mode.
- The chip remains a `<button>` with the same `onClick` and `key` props; only the `className` changes.
- The selected-state dot is rendered as a simple inline span with a shadow, not a new component, to keep the change minimal.

## Verification

- Run `bun run format`, `bun run lint`, `bun run typecheck`, and `bun run build` to confirm the styling-only change does not break anything.
