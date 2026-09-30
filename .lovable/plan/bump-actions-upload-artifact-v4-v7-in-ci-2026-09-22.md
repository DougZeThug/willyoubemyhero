# Bump actions/upload-artifact v4 → v7 in CI

## What changes

One line in `.github/workflows/ci.yml` (line 166), in the e2e job's "Upload Playwright report" step:

```yaml
uses: actions/upload-artifact@v7
```

Nothing else changes — the step's inputs (`name`, `path`, `retention-days`) and the `if: failure()` condition are unchanged and remain valid in v7. No dependency, lockfile, migration or app-code changes.

## Why it's safe

- v6+ requires Actions Runner 2.327.1 or newer. This project uses GitHub-hosted runners, which ship a far newer runner, so no self-hosted setup to check.
- The step only uploads the Playwright report when the e2e job fails, so it never runs on green runs; the first real exercise is the next failed e2e run.
- Dependabot will open this as a PR; applying it locally keeps the sync ahead of that PR.

## Verification

- YAML lint / format pass.
- No local gate is affected (workflows aren't type-checked or tested); CI itself exercises the new version on its next run.
