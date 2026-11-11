# 006 — Let a re-grabbed card catch up instead of snapping

- **Status**: DONE (code applied; MUST be feel-checked on a phone, revert if the catch reads as lag)
- **Commit**: 4df05ee
- **Severity**: MEDIUM
- **Category**: Interruptibility
- **Estimated scope**: 2 files (`holo-card.tsx`, `styles.css`), ~20 lines. Do plan 011 first if both are being done; they touch the same function.

## Problem

Releasing a card eases it flat over 460ms via a class that is only present
while `active === 0`. Re-grabbing mid-settle removes the class, so the browser
cancels the in-flight transition and the transform jumps straight to the new
finger-driven target (up to `maxTilt` = 16° or 22° away).

```ts
// src/components/holo-card.tsx:385-400 — current
(px: number, py: number, active: number) => {
  const scene = sceneRef.current;
  const layer = tiltRef.current;
  const card = cardRef.current;
  if (!scene || !layer || !card) return;
  const rx = (0.5 - py) * 2 * t.maxTilt;
  const ry = (px - 0.5) * 2 * t.maxTilt;
  // Easing is switched on in the same style flush as the angle it belongs to. ...
  layer.classList.toggle("holo-settle", active === 0);
  scene.style.setProperty("--holo-rx", `${rx.toFixed(2)}deg`);
  ...
```

```css
/* src/styles.css:773-775 — current */
.holo-settle {
  transition: transform 460ms cubic-bezier(0.22, 1, 0.36, 1);
}
/* src/styles.css:777-780 — reduced-motion block */
@media (prefers-reduced-motion: reduce) {
  .holo-settle {
    transition: none;
  }
```

Important constraint documented in the file: tracking must stay **1:1 with the
finger** (a persistent transition on pointermove would make the card lag the
finger). So the fix is a brief, one-shot "catch" on the first tracked frame
after a settle, not a transition while tracking.

The 460ms settle length itself is a deliberate physical release on a showpiece
card: do not shorten it.

## Target

A new class `holo-catch` — a 100ms strong ease-out — added only on the first
tracking frame that interrupts a settle, and removed after 100ms (or
immediately when the card is released again).

```css
/* src/styles.css, directly after the .holo-settle rule */
.holo-catch {
  transition: transform 100ms cubic-bezier(0.23, 1, 0.32, 1);
}
/* and inside the existing prefers-reduced-motion block that holds .holo-settle */
.holo-catch {
  transition: none;
}
```

```ts
// holo-card.tsx, inside the callback, replacing the single toggle line:
const wasSettling = layer.classList.contains("holo-settle");
layer.classList.toggle("holo-settle", active === 0);
if (active === 0) {
  layer.classList.remove("holo-catch");
  if (catchTimer.current) window.clearTimeout(catchTimer.current);
} else if (wasSettling) {
  layer.classList.add("holo-catch");
  if (catchTimer.current) window.clearTimeout(catchTimer.current);
  catchTimer.current = window.setTimeout(() => layer.classList.remove("holo-catch"), 100);
}
```

with `const catchTimer = useRef<number | null>(null);` declared with the other
refs (~line 287) and a cleanup `useEffect(() => () => { if (catchTimer.current) window.clearTimeout(catchTimer.current); }, []);`.

## Repo conventions to follow

- Plain CSS rules added via `classList`, not `@utility` (comment at `styles.css:~768`: "a plain rule can never be dropped by the class scanner"). Keep `.holo-catch` a plain rule, next to `.holo-settle`.
- Reduced motion: transitions removed, tell kept — same as `.holo-settle`.

## Steps

1. Add `.holo-catch` and its reduced-motion override to `src/styles.css` as above.
2. Add the `catchTimer` ref, the cleanup effect, and replace the `classList.toggle` line in `holo-card.tsx` with the block above.
3. `bun run format && bun run lint && bun run typecheck && bun run test` (`holo-card.test.tsx` must stay green; if a test asserts the exact class list on the tilt layer, update only that assertion to allow `holo-catch`).

## Boundaries

- Do NOT add any transition while `active > 0` beyond the one-shot 100ms.
- Do NOT change `FLIP_CURVE`, the flip, `holo-flip-*`, or any foil/glare layers.
- Do NOT change the 460ms settle.
- If the quoted code differs, STOP and report.

## Verification

- **Mechanical**: commands in Step 3.
- **Feel check (real phone, vault → open a card, hero tilt)**: drag, release, and re-grab at ~150ms into the settle several times. Expected: the card eases onto the finger over ~100ms instead of snapping; once the catch ends, tracking is 1:1 (no lag when dragging fast). Compare to the old build; if the catch feels like lag, revert this plan.
- Reduced motion on: tracking and release unchanged (no transitions).
- **Done when**: re-grab during settle shows no visible snap, normal tracking is unchanged, and checks pass.
