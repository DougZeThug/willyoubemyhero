# Validate and merge Dependabot production-dependency group update

Apply the 15-package production-dependency bump, run the full CI gate, fix any fallout, and prepare for merge.

## Scope

- Update only the 15 dependencies listed in the Dependabot PR, all minor/patch:
  @hookform/resolvers 5.5.7→5.9.1, @lovable.dev/cloud-auth-js 1.1.2→1.2.1,
  @supabase/supabase-js 2.110.9→2.116.0, @tanstack/react-query 5.101.4→5.103.1,
  @tanstack/react-router 1.170.32→1.170.38, @tanstack/react-start 1.168.49→1.168.56,
  @tanstack/router-plugin 1.168.35→1.168.40, input-otp 1.4.2→1.5.0,
  react 19.2.8→19.3.0, react-dom 19.2.8→19.3.0, react-hook-form 7.83.0→7.88.0,
  react-resizable-panels 4.12.2→4.12.4, sonner 2.0.7→2.0.8,
  tailwind-merge 3.6.0→3.7.0, zod 4.4.3→4.6.5.
- No package is on the major-version ignore list, so the grouped update is allowed as-is.
- Preserve both `bun.lock` and `package-lock.json`.

## Steps

1. **Update `package.json`**
   - Bump the 15 dependencies to the "To" versions from the PR body.
   - Note: `react` 19.3.0 already matches `@types/react` 19.3.x installed by the earlier dev-group update, so the type packages line up.

2. **Regenerate lockfiles**
   - `bun install` (updates `bun.lock`; postinstall normalizer runs automatically).
   - `npm install --package-lock-only` (updates `package-lock.json`).
   - If bun's 24-hour `minimumReleaseAge` guard rejects a very recent version, report which and stop for a decision rather than adding a `minimumReleaseAgeExcludes` entry without asking.

3. **Run the full gate**
   - `bun run format`
   - `bun run lint`
   - `bun run typecheck`
   - `bun run test`
   - `bun run build`
   - `bun run test:db`

4. **Fix failures**
   - Patch only what the update broke. Highest-risk items: `@supabase/supabase-js` 2.116 (auth/storage client behaviour), `@lovable.dev/cloud-auth-js` 1.2.1 (sign-in flow), `@tanstack/react-start` patch, `react` 19.3 minor, and `zod` 4.6 (validator behaviour used across server functions).
   - Re-run the full gate after any fix.

5. **Finish**
   - If all checks pass (with the known sandbox-only `test:db` environmental failure excepted), the changes are committed; the Dependabot PR merge itself happens on GitHub, as with the dev-group update.

## Out of scope

- No application feature changes.
- No migrations or database changes.
- No changes to `bunfig.toml` or `.github/dependabot.yml`.

## Risks

| Risk | Mitigation |
| --- | --- |
| React 19.3 minor changes behaviour | Full unit suite + build; types already at 19.3. |
| supabase-js / cloud-auth minor bumps alter session handling | Sign-in/session paths covered by unit tests; manual smoke of the live preview. |
| 24h release-age guard blocks a version | Stop and ask before any exclude-list change. |
| test:db fails on missing local postgres user | Known environmental blocker, not a regression. |
