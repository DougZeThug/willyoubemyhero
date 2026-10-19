# Dependabot dev-dependency group — 9 updates

| Package | From | To |
| --- | --- | --- |
| @lovable.dev/vite-tanstack-config | 2.26.6 | 2.26.7 |
| @playwright/test | 1.64.0 | 1.64.1 |
| @testing-library/user-event | 14.6.7 | 14.6.8 |
| @vitest/coverage-v8 | 5.0.3 | 5.0.5 |
| eslint-plugin-prettier | 5.5.6 | 5.5.7 |
| fake-indexeddb | 6.2.5 | 6.2.6 |
| jsdom | 30.1.2 | 30.1.3 |
| typescript-eslint | 8.71.1 | 8.71.2 |
| vitest | 5.0.3 | 5.0.5 |

## Steps

1. Check bun.lock first; bump the 9 entries in `package.json` devDependencies, keeping each entry's existing version style.
2. `bun install` to update `bun.lock`. If the 24-hour release-age guard holds a target back, accept bun's resolved version and report it (no new excludes without asking).
3. Regenerate `package-lock.json` pinned to bun's resolved versions (`npm install --package-lock-only`, npm 11.9.0 from a local prefix if sandbox npm crashes on peers). Keep vitest and @vitest/coverage-v8 on the same version.
4. Gate: `format`, `lint` (expect 0 errors, ~108 pre-existing warnings), `typecheck`, `test` (~3,080), `build`.
5. Phone-sized preview smoke of /players, /players/pack, /league (vite-tanstack-config touches the build pipeline).
6. Report resolved versions, anything held back, and gate results. Merge happens on GitHub.

## Out of scope

- No source changes unless a bump breaks the gate; fix only that.
- No `test:e2e` (CI only); `test:db` not affected by these packages.
