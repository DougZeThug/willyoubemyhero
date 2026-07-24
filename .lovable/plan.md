## Where things stand

Phase 1 MVP + core Phase 2 features are built (schema, PIN auth, participants, running order + randomize, timer with IndexedDB recovery, splits/penalties, leaderboard, draft board, admin console). The "Cool HUD" visual redesign is partially applied:

Done
- Cyan/teal palette + HUD utilities in `src/styles.css`
- New `src/components/hud-timer.tsx` circular timer
- `SiteNav` centered wordmark + neon bottom nav
- `src/routes/index.tsx` rebuilt around the HUD hero
- `__root.tsx` fonts/metadata

Not yet done (from the same redesign plan)
- Cohesion pass on `leaderboard.tsx`, `order.tsx`, `draft.tsx`, `admin.tsx` — headers still use plain `font-display` titles with no HUD framing, no shared section styling, no circuit background.

## Proposed next step: finish the redesign cohesion pass

Purely visual — no logic, data, or timing changes.

1. **Shared page header treatment.** Introduce a small `PageHeader` pattern (inline per route, no new component file needed) with:
   - Eyebrow label ("LIVE", "STANDINGS", "ORDER", "DRAFT", "CONSOLE") in cyan tracking-widest
   - Big condensed title
   - Optional right-aligned status chip (e.g. finished count on leaderboard)
   - Thin cyan hairline divider underneath

2. **Route-specific polish**
   - `leaderboard.tsx`: rank medallions use `hud-bezel` for top 3; leader row gets a subtle cyan glow border; time column uses `timer-digits` for consistency with HUD.
   - `order.tsx`: current/up-next/on-deck get a cyan left-border accent; running-order number chips restyled as small bezel tiles.
   - `draft.tsx`: available position tiles get the `neon-btn` outline treatment; selected picks use filled cyan.
   - `admin.tsx`: Timing Console card wrapped in `hud-bezel`; station split buttons restyled to match neon HUD language; PIN gate card gets the same header treatment.

3. **Background.** Apply a lighter `circuit-bg` wash to the outer page container on Leaderboard/Order/Draft (already on Live) so the app reads as one broadcast surface. Admin stays plain for readability.

4. **Verify.** Screenshot each route at 360×629 via Playwright after edits to confirm nothing regressed.

### Out of scope for this step
- Timer/admin logic, Supabase, auth, routing.
- Phase 3+ features (TV mode, intro screens, awards, rivalries, records, result cards, sound, exports). Those come next once the visual system is consistent.

Want me to proceed with this cohesion pass, or jump straight into a Phase 3 feature (TV/spectator mode, shareable result cards, or records/awards) instead?