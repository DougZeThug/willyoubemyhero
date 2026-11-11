# 011 — Write the card tilt as a direct `transform`, not via CSS variables

- **Status**: TODO (profile first — see Step 1; may end as WONTFIX)
- **Commit**: 4df05ee
- **Severity**: MEDIUM
- **Category**: Performance
- **Estimated scope**: 1 file, ~8 lines. Do before plan 006 if both are being done.

## Problem

Tilt angles are written as CSS custom properties on the _scene_ element and read
by the child tilt layer's `transform`. AUDIT: a variable written on a parent
invalidates style for every descendant (both faces, foil, glare, sparkle, prism,
edition layers) on every pointer frame. React does not re-render (good); the
cost is style recalc on a layered, blend-mode subtree on a phone.

```ts
// src/components/holo-card.tsx:397-400 — current
layer.classList.toggle("holo-settle", active === 0);
scene.style.setProperty("--holo-rx", `${rx.toFixed(2)}deg`);
scene.style.setProperty("--holo-ry", `${ry.toFixed(2)}deg`);
scene.style.setProperty("--holo-lift", `${(active * t.lift).toFixed(1)}px`);
```

```tsx
// src/components/holo-card.tsx:783-793 — current (tilt layer)
<div
  ref={tiltRef}
  className="h-full w-full [transform-style:preserve-3d]"
  style={{
    // translateZ leads: ...
    transform:
      "translateZ(var(--holo-lift,0px)) rotateX(var(--holo-rx,0deg)) rotateY(var(--holo-ry,0deg))",
    willChange: tilt === "hero" ? "transform" : undefined,
  }}
>
```

The three variables have exactly one consumer (verified by
`grep -rn -- '--holo-rx\|--holo-ry\|--holo-lift' src`): the line above.

## Target

Write the transform string straight onto the tilt layer; keep the other foil
variables (`--holo-gx`, `--holo-gy`, `--holo-pos`, `--holo-active`, …) on `card`
exactly as they are.

```ts
layer.classList.toggle("holo-settle", active === 0);
layer.style.transform = `translateZ(${(active * t.lift).toFixed(1)}px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
```

and in the JSX keep a constant, same-shape initial value (so the settle
transition always interpolates function-by-function):

```tsx
transform: "translateZ(0px) rotateX(0deg) rotateY(0deg)",
```

(React does not re-apply an unchanged style value, so imperative writes persist.)

## Repo conventions to follow

- The comment block above the tilt layer explains why `translateZ` leads and why lift must not live on the flip layer: keep it, updating "the var" wording if needed.
- Imperative writes + rAF coalescing are already the pattern for the other variables.

## Steps

1. **Profile (mandatory gate).** On a phone, open a vault card at hero tilt and drag continuously for 10s with DevTools Performance (or Safari Web Inspector Timelines) recording. If "Recalculate Style" per frame on the scene subtree is not a hot spot and frames hold ≥55 fps, mark this plan **WONTFIX** in `plans/README.md` with the numbers and stop.
2. Apply the Target to `applyTilt` (remove the three `scene.style.setProperty("--holo-…")` lines) and to the JSX initial transform.
3. Re-profile and record the delta.
4. `bun run format && bun run lint && bun run typecheck && bun run test` (`holo-card.test.tsx` must pass; if it asserts the `--holo-rx` variable on the scene, update only that assertion to read `tiltRef.style.transform`).

## Boundaries

- Do NOT change foil/glare/sparkle/prism variables, the flip layer, `FLIP_CURVE`, or `will-change` gating.
- Do NOT change tilt maths (`maxTilt`, `lift`, `rx`, `ry`).
- If the profile does not justify it, do not make it.

## Verification

- **Mechanical**: commands in Step 4.
- **Feel check**: tilt must look identical: same angles, same lift, same 460ms settle on release, 1:1 tracking. Foil bands still move with the finger. Reduced motion: unchanged.
- **Done when**: no `--holo-rx/ry/lift` references remain and the profile (or WONTFIX note) is recorded.
