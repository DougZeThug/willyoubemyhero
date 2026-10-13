# Dependabot PR #189 — development-dependencies group (10 updates)

Apply the 10 dev-dependency bumps from Dependabot PR #189, keeping both lockfiles in sync.

## Updates

| Package | From | To |
| --- | --- | --- |
| @lovable.dev/vite-tanstack-config | 2.25.3 | 2.26.6 |
| @playwright/test | 1.63.0 | 1.64.0 |
| @types/node | 26.6.4 | 26.6.5 |
| @vitejs/plugin-react | 6.1.1 | 6.1.2 |
| drizzle-orm | 0.45.3 | 0.45.4 |
| eslint | 10.11.0 | 10.12.0 |
| jsdom | 30.1.1 | 30.1.2 |
| prettier | 3.9.9 | 3.9.10 |
| typescript-eslint | 8.71.0 | 8.71.1 |
| vite | 8.3.3 | 8.3.4 |

## Steps

1. Bump all 10 versions in `package.json` (devDependencies).
2. Run `bun install` to update `bun.lock`. If any target is newer than bun's 24-hour `minimumReleaseAge` guard allows, accept bun's resolved version and note it.
3. Regenerate `package-lock.json` pinned to bun's resolved versions (`npm install --package-lock-only`; use npm 11.9.0 from the local prefix if the sandbox npm 10.9.4 crashes on peer resolution, as it did last time).
4. Run the gate: `bun run format`, `bun run lint` (expect 0 errors, ~108 pre-existing warnings), `bun run typecheck`, `bun run test` (~3,080 tests), `bun run build`.
5. Smoke the preview on a phone-sized viewport (/players, /players/pack, /league) since vite-tanstack-config and plugin-react touch the build pipeline.
6. Report resolved versions, any packages held back by the release-age guard, and gate results. The merge itself happens on GitHub.

## Notes

- No source-code changes expected; if the jsdom or eslint bump breaks tests/lint, fix only what the bump broke.
- Do not run `test:e2e` (CI only).
- Known unfixable security findings inside `@lovable.dev/mcp-js` are out of scope for this PR.
