# Permanently prevent private registry URLs in bun.lock

## Confirmed cause

The project has no local npm registry configuration, and `bunfig.toml` does not set an install registry. As a result, dependency resolution inherits Lovable's sandbox registry; when Bun resolves or updates a package there, it writes that mirror's absolute tarball URL into `bun.lock`. The current lockfile contains two such entries, while CI only detects them after they have already been committed.

## Changes

1. **Pin dependency resolution to the public npm registry**
   - Add `registry = "https://registry.npmjs.org"` under `[install]` in `bunfig.toml`.
   - Preserve the existing text-lockfile and 24-hour supply-chain settings unchanged.
   - This project-level setting overrides the sandbox's inherited mirror during future `bun install` and `bun add` operations, preventing recurrence at the source.

2. **Regenerate both tracked lockfiles**
   - Re-resolve `bun.lock` with Bun 1.3.11 using the project registry setting, rather than manually replacing individual URLs.
   - Regenerate `package-lock.json` from the same public registry so it remains synchronized with `package.json`.
   - Do not change dependency versions or add any `minimumReleaseAgeExcludes` entries.

3. **Keep the CI guard as defense in depth**
   - Retain the existing pre-install portability check so any future tooling regression fails quickly with a clear message.
   - Expand the check to explicitly reject known private mirror hosts anywhere in `bun.lock`, while continuing to reject absolute package resolution URLs.

## Verification

- Confirm `bun.lock` contains no absolute tarball resolution and no `pkg.dev` host.
- Confirm `package-lock.json` contains no sandbox/private mirror host.
- Run `bun install --frozen-lockfile` to prove the regenerated Bun lockfile is valid.
- Run `npm install --package-lock-only --ignore-scripts` against the public registry and confirm it produces no diff.
- Run the same lockfile portability command used by CI.

## Files

- `bunfig.toml`
- `bun.lock`
- `package-lock.json`
- `.github/workflows/ci.yml`
