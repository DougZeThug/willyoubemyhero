# Bump `globals` 15.15.0 → 17.12.0 (dev dependency)

## What this is

Dependabot opened a standalone major-bump PR for `globals`, the package that
supplies the ESLint global-variable lists. It is used in exactly one place:
`eslint.config.js`, which loads `globals.browser` for all `.ts`/`.tsx` files.
No runtime impact — it only feeds lint.

`globals` is not on the Dependabot ignore list, and this PR opened alone
because major bumps do not join the grouped minor/patch PRs.

## Plan

1. **Bump** `globals` to `^17.12.0` in `package.json` devDependencies.
2. **Regenerate both lockfiles** (`bun install`, then
   `npm install --package-lock-only`) — the project requires both to stay in
   sync. Bun's 24-hour `minimumReleaseAge` does not apply here unless the
   release is brand new; no exclude needed.
3. **Run the gate**: `format`, `lint`, `typecheck`, `test`, `build`.
   - `test:db` stays out — known environmental blocker in this sandbox (no
     local Postgres user); CI runs it.
4. **Verify lint specifically**: the new global list refreshes browser/node
   globals. Expect no change in results — the config only uses
   `globals.browser`, and removed/renamed globals would surface as new
   `no-undef` errors. The baseline is 110 pre-existing warnings (33
   react-refresh + 77 React-compiler hooks rules set to `warn`); only that
   count changing to something *other* than warnings needs a look.

## Risk

Very low. The only consumer is the lint config; a bad bump fails fast at
`bun run lint`, which runs first in the gate.

## Not included

- No dependency changes beyond this one package.
- No edits to `eslint.config.js` unless the gate shows a real new failure.
- Merge of the Dependabot PR stays with the user on GitHub — and as with the
  ESLint 10 bump, if any fix is needed it should ride along in the same merge.
