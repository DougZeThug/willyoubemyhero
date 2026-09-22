# Update motion 12.42.2 -> 13.1.1

## Findings
- `motion` is a runtime dependency (`^12.42.2`), imported in 15 files under `src/`.
- Nothing in the app uses `@emotion/is-prop-valid` or `isValidProp`, so dropping it has no effect on this app.

## Steps
1. Set `"motion": "^13.1.1"` in package.json, keeping the caret style.
2. Regenerate both lockfiles: `bun install`, then `npm install --package-lock-only`. If the 24-hour minimumReleaseAge guard blocks 13.1.1, stop and ask before adding an exclusion.
3. Run format, lint, typecheck, test and build. Watch the motion-driven tests: reveals, the collection-complete ceremony, milestone reveal, MotionConfig reducedMotion in the root.
4. If v13 changed any API that these files use (props, `MotionConfig`, `AnimatePresence`, types), fix it at the call site with the smallest change.
5. Check the package-lock resolved URLs for private-mirror entries, as with the earlier bumps.
6. Load /players and a pack reveal in the preview to confirm the animations still run.

No database, server or behaviour changes.
