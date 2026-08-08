# Make bun.lock registry-portable again

CI fails because two entries in `bun.lock` were resolved through the sandbox's private npm mirror, so their tarball host is baked into the lockfile instead of the portable empty resolution field.

## Affected entries

- `@lovable.dev/vite-plugin-hmr-gate@1.5.0` (line 287)
- `@lovable.dev/vite-tanstack-config@2.9.1` (line 289)

Both point at `https://europe-west4-npm.pkg.dev/lovable-core-prod/sandbox-npm-cache/...`.

## Fix

Replace the absolute tarball URL in those two entries with `""`, leaving the version, dependency metadata and integrity hash untouched. That is exactly what a resolution against the public registry produces, and it is the shape the CI guard checks for.

## Verification

- `grep -nE '", "https://' bun.lock` returns nothing (the CI check).
- `bun install --frozen-lockfile` still resolves cleanly, confirming the edit did not invalidate the lockfile.
- Confirm no other package picked up a mirror host.

## Note

This recurs whenever a dependency is re-resolved inside the sandbox. If it keeps happening, a follow-up option is a small post-install sanitize script, but that is out of scope here.
