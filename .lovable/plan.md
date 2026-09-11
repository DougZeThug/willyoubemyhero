# Validate and merge Dependabot dev-dependency group update

Apply the 13-package development-dependency bump, run the full CI gate, fix any fallout, and merge.

## Scope

- Update only the devDependencies listed in the Dependabot PR.
- Keep `@lovable.dev/vite-tanstack-config` in the grouped update (2.13.1 → 2.21.0).
- Preserve both `bun.lock` and `package-lock.json`.

## Steps

1. **Update `package.json`**
   - Bump the 13 devDependencies to the "To" versions from the PR body.

2. **Regenerate lockfiles**
   - Run `bun install` to update `bun.lock`.
   - Run `npm install --package-lock-only` to update `package-lock.json`.

3. **Run the full gate**
   - `bun run format`
   - `bun run lint`
   - `bun run typecheck`
   - `bun run test`
   - `bun run test:db`
   - `bun run build`

4. **Fix failures**
   - If any check fails, diagnose and patch only what the update broke.
   - Pay special attention to the `@lovable.dev/vite-tanstack-config` jump and `eslint-plugin-react-refresh` 0.4 → 0.5, which are the most likely to introduce new lint/build rules.
   - Re-run the full gate after fixes.

5. **Merge**
   - If all checks pass, merge the Dependabot PR and confirm the branch is deleted.

## Out of scope

- No application feature changes.
- No new dependencies beyond the versions listed.
- No migrations or database changes.

## Risk note

`test:db` has previously failed in this sandbox because the local `postgres` OS user is missing. I will still run it; if it fails for that environmental reason, I will report it separately rather than block on it.
