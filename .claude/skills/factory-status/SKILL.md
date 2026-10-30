---
name: factory-status
description: Concise factory overview — active tasks, completed work, blockers, failures and next actions, cross-checked against actual git state. Read-only.
disable-model-invocation: true
allowed-tools: Bash(node .claude/factory/*) Bash(git *) Read Grep Glob
---

Verified factory state (derived from `.factory/tasks` and git, not from memory):

```!
node .claude/factory/factory.mjs status
node .claude/factory/factory.mjs metrics
git branch --list 'factory/*' 'claude/*' | head -20
```

Summarise for a non-technical reader in ≤ 15 lines: what is running, what is ready for their approval (with branch/PR), what is blocked and exactly why, any `⚠` warnings (a record that git contradicts is a finding — say so), and the single recommended next action. Do not modify anything.
