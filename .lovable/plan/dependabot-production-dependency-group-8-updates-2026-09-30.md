# Dependabot production-dependency group — 8 updates

Routine grouped update, all minor/patch. No code or migration changes expected.

## Current state (verified)

package.json floors are below the PR's "From" column because the two lockfiles have drifted — `bun install` last resolved older versions than npm did for three packages:

| Package | bun.lock | package-lock.json | Target |
| --- | --- | --- | --- |
| @supabase/supabase-js | 2.116.0 | 2.117.0 | ^2.117.2 |
| @tanstack/react-query | 5.103.2 | 5.103.2 | ^5.104.0 |
| @tanstack/react-router | 1.170.38 | 1.170.38 | ^1.170.40 |
| @tanstack/react-start | 1.168.56 | 1.168.57 | ^1.168.59 |
| @tanstack/router-plugin | 1.168.40 | 1.168.40 | ^1.168.41 |
| motion | 13.4.0 | 13.4.0 | ^13.4.4 |
| react-hook-form | 7.88.0 | 7.88.0 | ^7.89.0 |
| react-resizable-panels | 4.13.1 | 4.13.2 | ^4.14.1 |

No package is on the major-version ignore list, so the grouped update is allowed as-is.

## Steps

1. **package.json** — bump the 8 dependencies to the target versions above, preserving each entry's existing caret style.
2. **Regenerate both lockfiles** — `bun install`, then `npm install --package-lock-only`. This also reconciles the three drifted packages. If bun's 24-hour `minimumReleaseAge` guard blocks one of these releases (13.4.4 and 4.14.1 are candidates), pin npm to bun's resolved version so the lockfiles match; if an exclusion would be needed, stop and confirm first.
3. **Gate** — `bun run format`, `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`. Watch the motion-driven tests (reveals, collection-complete ceremony, milestone reveal) and the TanStack Start/router patch bumps (server functions, route tree).
4. **Smoke** — load /players and a pack reveal in the preview to confirm animations and routing still work.
5. `test:db` not run (known sandbox environmental failure — no local Postgres user; CI covers it). `test:e2e` is CI-only.

## Out of scope

- No app code changes, no migrations, no changes to `bunfig.toml` or `.github/dependabot.yml`.
- Existing 110 lint warnings and pre-existing dependency advisories are unchanged.

## Risks

| Risk | Mitigation |
| --- | --- |
| 24h release-age guard blocks a version | Pin lockfiles to the newest allowed; ask before any exclude-list change. |
| motion 13.4.x patch changes animation behaviour | Motion test coverage + preview smoke of a pack reveal. |
| TanStack Start patch breaks server fns | Full unit suite + build + preview smoke. |
| Lockfile private-mirror addresses | Same as prior bumps — count stays ~278; CI failure would be environmental. |
