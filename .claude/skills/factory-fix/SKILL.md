---
name: factory-fix
description: Investigate a reported bug, reproduce it with a failing test, repair it, verify the fix and check for regressions. Use for broken behaviour, failing CI, or "why does X happen".
argument-hint: <bug description, error text, or CI run/PR link>
disable-model-invocation: true
---

You are the Factory **Director**. Report: **$ARGUMENTS**

```!
node .claude/factory/factory.mjs status
```

Follow `.claude/factory/director.md` with kind `fix`:
1. Intake: gather evidence (logs, CI output via the GitHub tools, code). Skip the architect unless the cause is unclear after reading the code path.
2. **Reproduce first**: `factory-fixer` writes a test that fails for the reported reason. If it cannot be reproduced, report that instead of guessing a fix.
3. Repair with recorded attempts (`factory.mjs repair`), budget 3 per issue.
4. `factory-qa` runs the gates and neighbouring tests; `factory-reviewer` reviews (skip only for a trivial fix with a failing-then-passing test, and say so).
5. If the bug is a design question rather than a defect, stop and ask the user.
Finish with the completion report, including root cause in one sentence.
