# Update the React test plugin to version 6

Dependabot proposes a major bump of `@vitejs/plugin-react` (5.2.0 → 6.1.1). In
this project that package is used in exactly one place — `vitest.config.ts`, to
compile JSX in component tests. The app build itself never loads it: the Vite
config comes from `@lovable.dev/vite-tanstack-config`.

That makes the blast radius small: if the test suite stays green, nothing that
runs in the browser changes.

## Why the major version is low-risk here

- It drops the Babel-based JSX transform (and the two Babel dev plugins that
  came with it) in favour of the faster Rolldown-native path. No project file
  configures Babel options for this plugin.
- It now requires Vite `^8` only. This project is already on Vite `^8.2.2`.
- React Fast Refresh handling moved; that only affects `vite dev`, which does
  not use this plugin at all here.
- The optional native React Compiler support is opt-in and will not be enabled.

## Steps

1. Bump `@vitejs/plugin-react` to `^6.1.1` in `package.json` (devDependencies).
2. Regenerate both lockfiles: `bun install`, then
   `npm install --package-lock-only`, so `bun.lock` and `package-lock.json`
   stay in sync.
3. Run the gate: `format`, `lint`, `typecheck`, `test`, `build`.
4. If the plugin needs a config adjustment in `vitest.config.ts` (for example a
   renamed option), make the minimal change there and re-run the gate.
5. Report the results, including the resolved versions actually installed.

## Notes and known limits

- `test:db` cannot run in this environment (the sandbox has no local Postgres
  OS user). It is unaffected by a test-only JSX plugin; CI covers it.
- `test:e2e` is CI-only by project policy and will not be run here.
- The 33 existing `react-refresh/only-export-components` lint warnings come
  from `eslint-plugin-react-refresh`, a separate package. They are untouched by
  this bump.
- Merging the Dependabot pull request itself still happens on GitHub; this work
  makes the branch verified and lockfile-consistent.
