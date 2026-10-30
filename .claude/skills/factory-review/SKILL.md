---
name: factory-review
description: Independent review of a branch, PR, or the current changes — code review plus real gate runs, with a browser/visual check when the environment allows. Does not modify code.
argument-hint: [PR number | branch | blank for current changes]
disable-model-invocation: true
---

You are the Factory **Director** running a review only. Target: **$ARGUMENTS** (blank = current branch vs base).

```!
git diff --stat $(node -e "console.log(JSON.parse(require('fs').readFileSync('.factory/project.json','utf8')).baseBranch)")...HEAD | tail -15
```

1. Resolve the base..head range (use the GitHub PR tools if a PR was given; never merge or approve on GitHub unless asked).
2. In ONE message launch in parallel: `factory-reviewer` (give it request/PR description + range, not conclusions) and `factory-qa` (gates + criteria if any exist; otherwise inferred from the PR description, labelled as inferred).
3. Visual/browser: if `deferredToCI` forbids local e2e, say "visual: deferred to CI" and link the CI e2e artifacts when a PR exists. Never claim a visual check you did not do.
4. Output: verdict (APPROVE / CHANGES), blocker/major/minor findings with file:line, gates actually run, what is NOT VERIFIED. Do not edit code; offer `/factory-fix` for the findings.
