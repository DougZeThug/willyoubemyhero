# Dependabot

This project uses GitHub-native Dependabot for dependency updates, plus the Dependabot CLI for local dry-runs.

## GitHub-native Dependabot

Configuration lives in `.github/dependabot.yml`. It opens weekly PRs for:

- npm/Bun production and development dependencies
- GitHub Actions

Major-version updates for TanStack Start, TanStack Router, the router plugin, nitro, and the Lovable TanStack Vite config are ignored because they have historically broken the build. Update those manually after reading changelogs and running the full test suite.

## bun.lock sync

Dependabot updates `package.json` and `package-lock.json`. The project also tracks `bun.lock`, so `.github/workflows/dependabot-bun-lock.yml` runs on every Dependabot PR, calls `bun install`, and commits the regenerated `bun.lock` back to the PR branch.

## Auto-merge

`.github/workflows/dependabot-auto-merge.yml` approves and enables GitHub auto-merge for patch- and minor-version Dependabot updates. GitHub only merges once the required status checks in `ci.yml` pass.

## Dependabot CLI

The CLI lets you dry-run updates locally. It requires Docker.

```bash
bun run test:dependabot
```

This runs a dry-run update for the `npm_and_yarn` ecosystem and prints the proposed changes. No files are modified.

If Docker is not running, the script exits with a warning instead of failing.
