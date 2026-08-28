# Dependabot Setup Plan

Add GitHub-native Dependabot, the Dependabot CLI for local testing, and a CI auto-approve/merge workflow for this Bun + TanStack Start project.

## Goals

1. **GitHub-native Dependabot** — open PRs for npm/Bun dependency updates and GitHub Actions updates.
2. **Dependabot CLI** — let developers dry-run Dependabot updates locally before they hit the repo.
3. **Dependabot CI automation** — auto-approve and enable auto-merge for safe Dependabot PRs (patch/minor, passing CI).

## Current State

- Package manager: **Bun 1.3.11** with both `bun.lock` (text) and `package-lock.json` tracked.
- CI already runs lint, typecheck, unit tests, and build on every PR/push to `main`.
- `bunfig.toml` uses `minimumReleaseAge = 86400` (24h supply-chain guard) and `saveTextLockfile = true`.
- No `.github/dependabot.yml` or Dependabot workflows exist.
- Past TanStack Start upgrades broke builds, so major version bumps need human review.

## Plan

### 1. GitHub-native Dependabot configuration

Create `.github/dependabot.yml` with:

- **Bun/npm ecosystem** monitoring `package.json`, `bun.lock`, and `package-lock.json`.
  - Weekly schedule.
  - Separate groups for production and development dependencies.
  - Ignore major-version bumps for packages known to break the build (`@tanstack/react-start`, `@tanstack/react-router`, `@tanstack/router-plugin`, `nitro`, `@lovable.dev/vite-tanstack-config`).
  - Ignore patch-level bumps for `js-yaml` because it is already pinned via `overrides`.
  - Limit open PRs to 10.
- **GitHub Actions ecosystem** monitoring `.github/workflows`.
  - Weekly schedule, grouped by action major version.

Because Dependabot updates `package-lock.json` but may leave `bun.lock` out of sync, add a companion workflow (see step 3) that regenerates `bun.lock` on Dependabot PRs.

### 2. Dependabot CLI for local testing

Add the Dependabot CLI as a dev dependency so the team can dry-run updates locally:

- Install `@dependabot/cli` (or use `bunx` if preferred).
- Add a script: `test:dependabot` that runs a dry-run update for the npm ecosystem.
- Add a short `docs/dependabot.md` note explaining how to run the CLI and interpret the output.

The CLI requires Docker. The script will warn if Docker is unavailable and exit gracefully.

### 3. CI automation for Dependabot PRs

Create `.github/workflows/dependabot-auto-merge.yml`:

- Trigger: `pull_request` when actor is `dependabot[bot]`.
- Fetch metadata with `dependabot/fetch-metadata`.
- Conditions for auto-approval + auto-merge:
  - Update is `patch` or `minor`.
  - Not a major-version bump.
  - Not in the ignored/blocked package list.
  - CI status is passing (use the built-in GitHub auto-merge requirement, not a separate status check in the workflow).
- For all Dependabot PRs, add a post-processing job that runs `bun install` and commits the regenerated `bun.lock` back to the PR branch if it changed.
  - This keeps `bun.lock` and `package-lock.json` in sync.
  - Uses `stefanzweifel/git-auto-commit-action` or equivalent with a restricted `contents: write` permission.

### 4. Validation

- Run `bun run lint` after adding the new files.
- Verify Dependabot config is valid via GitHub's UI once pushed (no syntax errors).
- Run the Dependabot CLI dry-run locally to confirm it can parse the repo.

## Files to Create/Modify

- Create `.github/dependabot.yml`
- Create `.github/workflows/dependabot-auto-merge.yml`
- Create `.github/workflows/dependabot-bun-lock.yml` (or merge into auto-merge workflow)
- Create `docs/dependabot.md`
- Modify `package.json` to add `@dependabot/cli` dev dependency and `test:dependabot` script

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Dependabot does not natively support Bun lockfiles | Regenerate `bun.lock` in CI after each Dependabot PR. |
| Major TanStack/nitro updates break the build | Ignore major-version bumps for those packages. |
| Auto-merge merges a broken update | Only enable auto-merge; GitHub will not merge until required status checks pass. |
| Docker unavailable for CLI | Script exits with a helpful message; CLI is optional. |

## Out of Scope

- Switching package managers or removing `package-lock.json`.
- Enabling Dependabot security alerts (assumed already on at the repo level; this plan configures version updates).
- Custom vulnerability scanning beyond Dependabot's native alerts.
