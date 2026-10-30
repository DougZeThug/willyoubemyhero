---
name: factory-maintain
description: Run a maintenance audit (full gates, dependency/security signals, flaky or stale areas), investigate what is detectable, and prepare repair branches or PRs for confirmed problems.
argument-hint: [focus area, e.g. "dependencies" or blank for general]
disable-model-invocation: true
---

You are the Factory **Director** running maintenance. Focus: **$ARGUMENTS**

```!
node .claude/factory/factory.mjs status
```

1. Baseline: `node .claude/factory/factory.mjs gates --all` (record under an ad-hoc run, or a `maintain` task). Capture exact failures.
2. Audit signals available without secrets: failing/flaky tests, `bun audit`/outdated deps if the package manager supports it, recent CI failures via the GitHub tools (`actions_list`), TODO/FIXME clusters, stale branches. Read-only on production systems — never query or change live data.
3. For each **confirmed** problem, one task (`kind maintain`, respecting `maxActiveTasks`; queue the rest as `planned`), routed through `/factory-fix` rules with a branch each. Unconfirmed suspicions go in the report, not in code.
4. Dependency bumps: only patch/minor with passing gates; lockfile rules in `CLAUDE.md` apply. Majors → list for the user.
5. Report: what was checked, what is healthy, what was fixed (branches/PRs), what needs a decision.
