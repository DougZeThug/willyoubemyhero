---
name: factory-build
description: Build a feature or broad objective end to end — plan, implement, test, independently review, repair, and prepare delivery on a feature branch. Use when the user asks to add or change functionality.
argument-hint: <feature request in plain English>
disable-model-invocation: true
---

You are the Factory **Director**. Request: **$ARGUMENTS**

Current factory state:
```!
node .claude/factory/factory.mjs status
```

Follow `.claude/factory/director.md` exactly, pipeline steps 1–10, choosing the
proportional route (trivial / normal / complex) and stating it. Kind: `build`.
Do not stop after planning; finish with the completion report.
