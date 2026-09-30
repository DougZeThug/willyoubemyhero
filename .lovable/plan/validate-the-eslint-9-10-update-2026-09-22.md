# Validate the ESLint 9 → 10 update

This only changes the tool that checks code style. Nothing changes for players.

## Steps

1. Bump `eslint` to `^10.10.0`. Bump `@eslint/js` to the matching 10.x too, because its recommended rule set is versioned with ESLint.
2. Check peer compatibility for `eslint-plugin-react-hooks` (5.x), `typescript-eslint`, `eslint-plugin-prettier`, `eslint-config-prettier` and `eslint-plugin-react-refresh`. If a plugin rejects ESLint 10, bump only that plugin to its lowest release that supports ESLint 10, then report it (it goes beyond the Dependabot PR).
3. Regenerate both lockfiles: `bun install`, then `npm install --package-lock-only`.
4. Record the lint results before and after: compare error and warning counts per rule against today's baseline (0 errors, 33 react-refresh warnings).
5. Fix any new errors at the source, following existing conventions and adding why-comments. Don't disable rules to make the check pass. If a new recommended rule creates a lot of noise, stop and ask.
6. Run the full gate: format, lint, typecheck, test, build.

## Out of scope

No app features, no migrations, and no other dependency bumps unless step 2 requires them.

## Known note

`test:db` can't run in this sandbox (no local Postgres user), so CI covers it.
