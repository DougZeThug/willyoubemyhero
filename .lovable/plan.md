# Dependabot dev-dependency bump — 5 updates

Routine dependency update, no code or migration changes expected.

## Current state (verified)

| Package | In package.json | Target |
| --- | --- | --- |
| @lovable.dev/vite-tanstack-config | 2.23.1 (already current) | — no change |
| @testing-library/dom | ^10.4.1 | ^10.4.2 |
| eslint-plugin-react-refresh | ^0.5.6 | ^0.5.7 |
| jsdom | ^30.0.1 | ^30.1.0 |
| prettier | 3.7.3 (pinned) | 3.9.8 (keep exact-pin style) |

The `@lovable.dev/vite-tanstack-config` entry of the PR is already satisfied.

## Steps

1. **package.json** — bump the four packages above, preserving each entry's existing version style (caret vs exact pin).
2. **Regenerate both lockfiles** — `bun install`, then `npm install --package-lock-only` (CI pins Bun 1.3.11 and both lockfiles must stay in sync). If bun's 24-hour `minimumReleaseAge` guard blocks one of these releases, note it and confirm with the user before touching `minimumReleaseAgeExcludes`.
3. **Gate before finishing** — `bun run format`, `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`. Prettier 3.9.8 may reformat a file or two; include only those formatting changes. No source changes unless the gate forces one.
4. `test:db` is not run here (sandbox has no postgres OS user — known environmental failure; CI covers it). `test:e2e` is CI-only.

## Out of scope

- No app code changes, no migrations, no lint-warning cleanup beyond what the new prettier/eslint-plugin versions introduce.
