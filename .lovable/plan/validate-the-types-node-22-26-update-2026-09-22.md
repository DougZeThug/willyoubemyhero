# Validate the @types/node 22 → 26 update

Type definitions only — nothing changes for players at runtime. Risk is new type-check errors.

## Steps

1. Bump `@types/node` in `package.json` from `^22.16.5` to `^26`.
2. Regenerate both lockfiles: `bun install`, then `npm install --package-lock-only`. Accept the re-added platform-specific optional bindings — they come from the updated tree and are skipped on platforms that do not need them.
3. Run the gate: format, lint, typecheck, test, build.
4. If typecheck fails, fix only what the new Node typings broke (likely spots: Buffer/Uint8Array generics, `crypto`, `fetch`/undici types in server modules and test helpers), each with a short why-comment. No `any` casts or suppressions.
5. Re-run the gate until green; check the build log is clean.

## Out of scope

- No other dependency changes, no app features, no migrations.

## Known note

`test:db` fails in this sandbox (no local postgres user) — environmental; CI covers it.
