# Software factory — operator guide

You describe; Claude Code plans, builds, tests, reviews and delivers a branch.

## Use it

```
/factory-build  Add a "streak flame" icon next to a player's name on the League screen
/factory-fix    The trade builder lets me add a card I already offered twice
/factory-review 214            (a PR number, a branch, or blank for current changes)
/factory-polish The Vault grid feels cramped on my phone
/factory-maintain dependencies
/factory-status
```

You get a short report: what changed, evidence (gates, tests, what could _not_
be verified), repairs, review verdict, and only the decisions that are really
yours. You approve; the factory never merges or deploys.

## Moving parts

| Piece                                         | Job                                                           |
| --------------------------------------------- | ------------------------------------------------------------- |
| `.claude/skills/factory-*`                    | the six commands; the main session becomes the Director       |
| `.claude/factory/director.md`                 | the pipeline, routes, retry rules, report format (one source) |
| `.claude/agents/factory-*`                    | architect, builder, ui, qa, fixer, reviewer                   |
| `.claude/factory/factory.mjs`                 | task state, gate runner, repair budget, `ready` enforcement   |
| `.claude/hooks/factory-guard.mjs`             | blocks protected paths and push-to-main / force / deploy      |
| `.claude/settings.json`                       | allow/deny permission rules, hook wiring                      |
| `.factory/project.json`                       | **the only per-project file**: gates, protected paths, limits |
| `.factory/tasks/*.json`, `.factory/evidence/` | durable memory: task records and gate-run evidence            |
| `.github/workflows/factory-*.yml`             | opt-in unattended runs (inert by default)                     |

What the tool enforces rather than asks: a task cannot be `ready` without a
passing gate run on the current HEAD and a recorded `approve` review; a second
active task is refused past `maxActiveTasks` (1); an issue is blocked after 3
failed repairs or one identical repeat; `status` flags records git contradicts.

## Unattended operation (opt-in, off until you switch it on)

1. Add secret `CLAUDE_CODE_OAUTH_TOKEN` (run `claude setup-token`) — or edit the workflows to use `anthropic_api_key`.
2. Set repository variable `FACTORY_ENABLED=true` (issue + maintenance) and/or `FACTORY_CI_REPAIR=true`.
3. Label an issue `factory` → branch `factory/issue-N` + PR + report comment.
4. In GitHub settings, protect `main` (require PR + the CI checks) — this is the real merge boundary.
5. Maintenance is manual (`workflow_dispatch`); uncomment the cron only after reviewing a manual run.

All three share one concurrency group, so only one factory run is live at a time.
**Status: written and syntax-checked, not yet run on GitHub** (needs steps 1–2).

## Install in another app

```bash
node .claude/factory/install.mjs /path/to/other-repo      # add --dry-run to preview
```

Copies the portable kit, generates `.factory/project.json` from that repo's
`package.json` scripts, union-merges its `.claude/settings.json`, appends a
pointer to its `CLAUDE.md`. Then edit `project.json`: real gates, `protectedPaths`
(e.g. approved artwork directories, production data files), `deferredToCI`,
`domainAgents`. Project-specific specialists (FloorForge asset alignment, 717REC
data integrity, game-system checks) belong in that repo's own `.claude/agents/`.

## Limits worth knowing

- Custom agents load at session start; restart after install.
- Local e2e/browser runs are disallowed by this repo's `CLAUDE.md`, so visual verification here is CI artifacts or your phone, and reports say so.
- Hook/permission rules are guardrails, not a sandbox; branch protection is the hard stop.
- Agent teams are experimental and unused; worktree isolation is available per Agent call.
