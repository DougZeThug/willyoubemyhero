# 002 — Stop the foil recoil tween when the pack is grabbed again

- **Status**: DONE (code applied; device feel check still pending)
- **Commit**: 4df05ee
- **Severity**: MEDIUM
- **Category**: Interruptibility
- **Estimated scope**: 1 file, ~10 lines

## Problem

When a tear is released short of the threshold, the foil springs shut with a
fixed-duration tween. Its controls are discarded, so grabbing the pack again
inside those 280ms leaves two writers on the same motion value: the old tween
and the new pointermove.

```ts
// src/components/pack-wrapper.tsx:436-445 — current
function end(e: React.PointerEvent<HTMLDivElement>) {
  if (dragRef.current?.id === e.pointerId && e.currentTarget.hasPointerCapture?.(e.pointerId)) {
    e.currentTarget.releasePointerCapture(e.pointerId);
  }
  dragRef.current = null;
  // Short of the threshold the foil springs shut. ...
  animate(front, 0, { duration: 0.28, ease: [0.22, 1, 0.36, 1] });
}
```

```tsx
// src/components/pack-wrapper.tsx:485-492 — current
onPointerDown={
  sealed
    ? (e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = { id: e.pointerId, x: e.clientX };
        tickRef.current = 0;
      }
    : undefined
}
```

Frequency is about once a day per person, but a nervous second grab right after
a failed tear is exactly when the pack must feel solid.

## Target

- The recoil's controls are kept in a ref and stopped the instant a new gesture starts (and on unmount).
- Curve changes from `[0.22, 1, 0.36, 1]` to the strong ease-out `[0.23, 1, 0.32, 1]`; duration stays `0.28`.

```ts
const recoilRef = useRef<ReturnType<typeof animate> | null>(null);

// in end():
recoilRef.current = animate(front, 0, { duration: 0.28, ease: [0.23, 1, 0.32, 1] });

// in onPointerDown, first line of the handler body:
recoilRef.current?.stop();
recoilRef.current = null;
```

## Repo conventions to follow

- The same file already stops its other animation on cleanup: `return () => controls.stop();` at `pack-wrapper.tsx:~429` (the rip effect). Imitate that pattern.
- `animate` is already imported from `"motion/react"` (line 2); no new import needed.

## Steps

1. Next to the other refs (`dragRef`, `tickRef`, `committedAt`), add `const recoilRef = useRef<ReturnType<typeof animate> | null>(null);`.
2. In `end()`, assign the `animate(...)` result to `recoilRef.current` and use the Target curve.
3. In the `onPointerDown` handler (inside the `sealed ? (e) => { ... }` arm), add `recoilRef.current?.stop(); recoilRef.current = null;` as the first two statements, before `setPointerCapture`.
4. Add `useEffect(() => () => recoilRef.current?.stop(), []);` near the other effects so an unmount mid-recoil does not write to a dead value.
5. `bun run format && bun run lint`.

## Boundaries

- Do NOT change the commit path (`p >= TEAR.threshold` branch), the rip effect, or `ripWaypoints`.
- Do NOT replace the tween with a spring in this plan (that is a feel decision for a device; see Feel check).
- Do NOT touch `front.set(p)` in `onPointerMove`.
- If the quoted code does not match, STOP and report.

## Verification

- **Mechanical**: `bun run typecheck && bun run lint && bun run test`. There is no `pack-wrapper` unit test; `pack-opening.test.tsx` and `pack-stand.test.tsx` must stay green.
- **Feel check** (real phone, `bun run dev`): drag the foil ~40% across and release; immediately re-grab during the snap-back. Confirm the foil follows the finger from the first frame with no fight or flicker. Repeat quickly 5 times. Confirm a full tear still commits and the ceremony runs. In DevTools slow-mo is not available for pointer drags: test by eye.
- Toggle `prefers-reduced-motion`; confirm nothing regresses.
- **Done when**: a re-grab during the recoil never shows the foil jumping back toward 0, and the checks pass.
