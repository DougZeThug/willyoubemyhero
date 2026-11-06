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
4. QA + reviewer as normal.
5. **Before/after screenshots are mandatory on every polish run** (standing user instruction). Once gates pass, run `node .claude/factory/shots.mjs <task-id>` (add `--scenes a,b` to refresh only some). It captures the base commit and the branch at 320, 390, 430 and desktop, compares them pixel by pixel, and writes `.factory/evidence/<task-id>/shots/review/` (commit that directory; the raw sets stay local). Then **look at the images yourself** (Read them) before describing them: confirm the changed pairs show what you claim, and that the control pair is identical. A scene whose before and after are identical has proven nothing about that change.
   - If the screen you polished has no scene in `e2e/factory-shots.spec.ts`, add one (reuse `fixtures.ts` stubs); that is part of the polish, and it needs its own gates and review.
   - Put the review images in the report: for each changed pair, say what differs. If `compare.md` carries the typeface caveat, say so.
   - Capture fails or is flaky: fix the capture or say plainly it could not be made. Never substitute code-reading for the images, and never describe an image you did not look at.
   - The capture hides the "Live feed down" banner (an artifact of its dead backend). A polish that touches that banner, or anything wrapping it, cannot be evidenced this way: say so instead of showing a frame with it removed.
   - What is still "unverified visually" is whatever no scene covers (real device feel, safe-area insets on a notch, real network).
