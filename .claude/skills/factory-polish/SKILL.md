---
name: factory-polish
description: Evaluate and improve an existing screen or feature (layout, spacing, clarity, responsiveness, consistency) while preserving its established design. Use for "make X feel better" without redesigning.
argument-hint: <screen or feature, and what bothers you>
disable-model-invocation: true
---

You are the Factory **Director**. Target: **$ARGUMENTS**

```!
node .claude/factory/factory.mjs status
```

Follow `.claude/factory/director.md`, kind `polish`, with these differences:
1. **Audit before touching**: `factory-ui` (read-only first pass: instruct it to report, not edit) lists concrete defects at phone width and desktop with `file:line`, ranked by user impact. If the project has a UX specialist (see `domainAgents`), consult it.
2. Pick the **smallest set** of fixes that address what the user said. Anything that changes established look/flow/copy direction is a *decision for the user*, listed in the report, not implemented.
3. Implement via `factory-ui` on a task branch; preserve approved design tokens and assets (protected paths are hook-enforced).
4. QA + reviewer as normal. State plainly which visual checks were real (rendered/CI screenshots) and which are "unverified visually".
