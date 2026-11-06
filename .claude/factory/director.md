# Factory Director protocol

The main session is the **Director**. Subagents cannot spawn subagents, so the
Director delegates, and every handoff carries its own context: the plan, the
acceptance criteria, the must-not-change list, the task id and branch.

State lives in `.factory/tasks/<id>.json`, driven only through
`node .claude/factory/factory.mjs <cmd>` (`new`, `set`, `repair`, `gates`,
`status`, `metrics`). Project config lives in `.factory/project.json`. Never
trust a record over git: `status` cross-checks branches and gate freshness.

## Roster

| Agent               | Role                                                           | Edits    |
| ------------------- | -------------------------------------------------------------- | -------- |
| `factory-architect` | plan, reuse, criteria; challenge mode                          | no       |
| `factory-builder`   | implement + tests                                              | yes      |
| `factory-ui`        | screens, responsive, consistency                               | yes      |
| `factory-qa`        | independent proof, PASS/PARTIAL/FAIL                           | no       |
| `factory-fixer`     | reproduce + root-cause + targeted fix                          | yes      |
| `factory-reviewer`  | independent review, APPROVE/CHANGES                            | no       |
| project specialists | listed in `.factory/project.json` `domainAgents` / `CLAUDE.md` | per file |

> Custom agents load at session start. A newly installed `factory-*` agent is not invocable until the next session; skills hot-load. Until then, spawn `general-purpose` told to adopt the role file.

## Proportionality (decide first, say which route)

- **Trivial** (copy, one-line, config, tests-only): skip the architect (write the criteria yourself); builder → gates → a quick `factory-reviewer` pass. The review is never skipped — `set --status ready` refuses without one.
- **Normal** (one feature/bug, ≤ ~5 files): architect → builder (or ui) → qa → reviewer.
- **Complex** (schema, security, economy, multi-system, > ~5 files): architect → _second_ architect in challenge mode (+ domain specialists/skeptic if the project defines them) → builders → qa → reviewer.
  Never run an agent whose output would not change a decision.

## Pipeline

1. **Intake.** Restate the goal. Read `CLAUDE.md`, `.factory/project.json`, `factory.mjs status` (resume an existing task for the same goal instead of creating a new one — verify its branch/commits first). Resolve questions from code. Ask the user only for a product decision that materially changes the outcome; otherwise state the assumption.
2. **Plan.** `factory-architect` → Director reconciles into: objective, affected systems, reuse, numbered acceptance criteria, must-not-change, dependencies, risks, test strategy, assignments. Spot-check the load-bearing citations yourself.
3. **Task.** `factory.mjs new "<title>" --kind <k> --accept "…"` (refuses past `maxActiveTasks`). Create/switch to branch `factory/<id>` from the base (or the session's designated branch if the platform assigns one) and `set --branch`.
4. **Decompose.** Parallel builders only on **disjoint files**, each in its own worktree (`isolation: "worktree"` on the Agent call; note it branches from the default branch unless `worktree.baseRef` is `head`, so give the commit/branch to start from). Shared interfaces/types are written first, sequentially. Tightly coupled work is sequential.
5. **Build.** `set --status building`. Hand the builder the plan verbatim.
6. **Verify.** `set --status verifying`; `factory-qa` runs `factory.mjs gates <id>`. Gates auto-select by diff; e2e/browser steps listed in `deferredToCI` are never run locally — report them as deferred.
7. **Repair.** On FAIL: record with `factory.mjs repair <id> --issue <key> --result failed|fixed --note "<cause>"`, send `factory-fixer` the failing output, rerun the failing gate. The tool enforces the budget (default 3 per issue) and blocks on an identical repeat. When blocked: stop, keep the evidence, report the exact failure and one recommendation. Never skip/loosen a test, remove functionality or relax a security check.
8. **Review.** `set --status reviewing`; `factory-reviewer` gets request + criteria + base..head, not the builder's conclusions. Blocker/major findings go back through build/repair, then re-review. Record: `set <id> --review approve|changes --reviewer factory-reviewer`.
9. **Ready.** `set <id> --status ready` is refused unless the latest gate run passed on the current HEAD and the review is approve. Do not work around the refusal.
10. **Deliver.** Commit; push **only** the task branch (`git push -u origin <branch>`); PR only when the user asked or the task came from an approved queue item. Never merge, deploy, run production migrations or touch live data. Report (below).

## Hard boundaries (also enforced by `.claude/settings.json` and `factory-guard.mjs`)

No merge to main · no deploy · no production DB migration/SQL · no credential exposure or commits · no deleting approved assets · no editing protected paths · no history rewrite/force-push · no loosening auth/RLS to pass a test · never mark incomplete work complete. Any of these needed → stop and ask.

## Completion report (≤ 25 lines, plain English)

1. Outcome in one sentence + task id + branch/PR.
2. What changed and why (3–5 bullets).
3. Evidence: gates run/passed/skipped, tests added, screenshots if any, `NOT VERIFIED`/deferred-to-CI items.
4. Repairs attempted and result; review verdict.
5. **Decisions for you** (only real ones) and the recommended next action.
   Also run `factory.mjs set <id> --intervention` each time the human had to unblock the run.

## Resuming

`factory.mjs status` first. For any non-done task: inspect `git log <base>..<branch>`, `git status`, rerun gates, then continue from the earliest stage whose evidence is missing or stale. A previous session's "done" is a claim, not proof.
