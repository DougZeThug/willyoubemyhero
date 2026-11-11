# 003 — Cut the per-frame paint cost of the live HUD timer

- **Status**: DONE, UNPROFILED (Steps 2, 3, 5 applied; the Step 1 profile gate was skipped, so the perf win is unmeasured. The halos are hard-edged bands, not a soft blur: eyeball the glow on a phone and revert if it looks worse)
- **Commit**: 4df05ee
- **Severity**: MEDIUM
- **Category**: Performance
- **Estimated scope**: 1–2 files (`hud-timer.tsx`, `hud-timer.test.tsx`), ~25 lines

## Problem

`/live` is watched continuously. `useElapsed` re-renders `HudTimer` on every
animation frame, and each frame changes the geometry of a circle that carries
two stacked `drop-shadow` filters, so the filter is re-rasterised ~60×/second
on a 340px SVG:

```ts
// src/hooks/use-elapsed.ts:20-25 — current
const tick = () => {
  setFrame({ anchor, delta: performance.now() - start });
  raf = requestAnimationFrame(tick);
};
```

```tsx
// src/components/hud-timer.tsx:92-105 — current (progress arc)
<circle
  cx={c}
  cy={c}
  r={r}
  fill="none"
  stroke="var(--color-primary)"
  strokeWidth={strokeW}
  strokeLinecap="round"
  strokeDasharray={`${progress} ${circ}`}
  style={{
    filter: paused
      ? "none"
      : "drop-shadow(0 0 8px var(--color-primary)) drop-shadow(0 0 16px oklch(0.82 0.14 210 / 0.6))",
  }}
/>
```

```tsx
// src/components/hud-timer.tsx:136-140 — current (digits, content changes every frame)
style={{
  textShadow: paused
    ? "none"
    : "0 0 20px oklch(0.82 0.14 210 / 0.55), 0 0 40px oklch(0.82 0.14 210 / 0.35)",
}}
```

`HudTimer` is used by `src/routes/live.tsx:274` (size 340) for the whole run.
Whether it actually drops frames can only be answered on a phone — hence the
profile gate. The auditors could not measure it from code.

## Target

If (and only if) the profile in Step 1 shows the arc/filter as significant
paint or raster time, replace the two blur filters on the _animating_ element
with **unfiltered stacked halo strokes** of the same dash geometry (vector
overdraw is cheap, blur is not):

```tsx
{
  /* halos: wider, translucent strokes of the same arc, no filter */
}
{
  !paused && (
    <>
      <circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth={strokeW + 16}
        strokeOpacity={0.12}
        strokeLinecap="round"
        strokeDasharray={`${progress} ${circ}`}
      />
      <circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth={strokeW + 8}
        strokeOpacity={0.25}
        strokeLinecap="round"
        strokeDasharray={`${progress} ${circ}`}
      />
    </>
  );
}
{
  /* crisp arc: no filter */
}
<circle
  data-testid="hud-arc"
  cx={c}
  cy={c}
  r={r}
  fill="none"
  stroke="var(--color-primary)"
  strokeWidth={strokeW}
  strokeLinecap="round"
  strokeDasharray={`${progress} ${circ}`}
/>;
```

(Halos render BEFORE the crisp arc so the arc stays on top; all three share the
same `strokeDasharray` string.) Leave the digit `textShadow` alone unless the
profile specifically blames it (then reduce to the single
`"0 0 20px oklch(0.82 0.14 210 / 0.55)"` layer).

## Repo conventions to follow

- Colours are `oklch()` (CLAUDE.md). Reuse `var(--color-primary)` and the existing `oklch(0.82 0.14 210 / …)` values; do not introduce hex.
- Times are ms everywhere; do not touch `formatTime`/`useElapsed` semantics.
- `src/components/hud-timer.test.tsx:78-86` selects the arc via `container.querySelectorAll("circle")[1]`; adding halos shifts that index.

## Steps

1. **Profile (mandatory gate).** On a real mid-range phone (or Chrome DevTools with 6× CPU throttle and Performance → Frames), open `/live` with a running clock for 10 seconds (use the admin timing screen to start one). Record: dropped frames, and in the flame chart the share of "Paint"/"Rasterize"/"Update Layer Tree". If frames hold ≥55 fps with no raster hot-spot, set this plan to **WONTFIX**, note the measurement in `plans/README.md`, and stop.
2. Edit `hud-timer.tsx` as in Target: remove the `style={{ filter: … }}` from the arc, add the two halo circles before it, add `data-testid="hud-arc"` to the crisp arc.
3. Update `hud-timer.test.tsx` "wraps the progress arc within one target sweep" to select the arc with `screen`/`container.querySelector('[data-testid="hud-arc"]')` instead of `querySelectorAll("circle")[1]`. This is the only test edit allowed.
4. Run the profile from Step 1 again and record the delta in the PR description.
5. `bun run format && bun run lint`.

## Boundaries

- Do NOT change `useElapsed`, `formatTime`, `ms % targetMs` maths, or the ticks/bezel/bloom markup.
- Do NOT move the timer to CSS animation or WAAPI in this plan.
- Do NOT add dependencies.
- If the profile does not justify the change, do not make it.

## Verification

- **Mechanical**: `bun run typecheck && bun run lint && bun run test` (all `hud-timer.test.tsx` cases pass, including "stops animating once paused").
- **Feel/visual check**: side by side with the old build, the arc must still glow in the same cyan, the glow must follow the arc head, and the paused state (amber digits, no glow) must be unchanged. At reduced CPU the ring must not stutter.
- **Done when**: profile shows a measurable reduction (or the plan is closed WONTFIX with numbers), and checks pass.
