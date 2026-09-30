# Dependabot fetch-metadata v2 -> v3

## Current state
- `.github/workflows/dependabot-auto-merge.yml` line 28 uses `dependabot/fetch-metadata@v2`.
- The job runs on `ubuntu-latest` (GitHub-hosted).

## Change
- Line 28: `dependabot/fetch-metadata@v2` -> `dependabot/fetch-metadata@v3`. Nothing else changes.

## Node 24 check
- An action's `runs.using: node24` is run by the Node bundled with the GitHub Actions runner, not by any `setup-node` step. GitHub-hosted `ubuntu-latest` runners ship Node 24, so no extra setup is needed.
- No self-hosted runners are used, so there is no runner to upgrade.

## Verify
- Lint/format gate unaffected (YAML not linted). The real proof is the next Dependabot PR: the "fetch metadata" step should succeed and auto-merge behave as before.
