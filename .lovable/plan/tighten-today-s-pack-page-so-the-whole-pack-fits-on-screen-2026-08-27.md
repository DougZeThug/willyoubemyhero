# Tighten Today's Pack page so the whole pack fits on screen

## Problem
On a phone viewport the sealed pack page has too much vertical padding and the pack itself is too large, so users have to scroll to see the whole pack. The goal is to make the pack and its caption visible without scrolling.

## Changes

### 1. Shrink the sealed pack
- In `src/components/pack-wrapper.tsx`, reduce the sealed pack wrapper from `max-w-xs` to `max-w-[260px]` (or `max-w-64` if 256px reads better). Keep `aspect-[5/7]` and the ceremony measurement logic intact — `PackOpening` already measures the rendered width, so a smaller pack scales the fan proportionally.

### 2. Reduce vertical padding on the pack page
- In `src/routes/players.pack.tsx`:
  - Drop the outer container's `py-6` to `py-2` or `py-3` on small screens (keep a bit more on desktop if desired).
  - Drop the sealed pack inner container's `py-6` to `py-2` or `py-3`.
  - Reduce the `mb-5` on the top nav/stats row to `mb-3` and its `pb-4` to `pb-2`.

### 3. Compact the "Today's Pack" heading block
- Reduce the title from `text-3xl` to `text-2xl` and its top/bottom margins.
- Tighten the description paragraph's `mt-2` and max-width, or shorten the text slightly.
- Keep the streak line but reduce its margin if needed.

### 4. Keep the hint line small
- The "Drag across the tear · or press Enter" line is already small; just ensure its top spacing is not adding extra room.

### 5. Preserve behaviour
- Do not change the pack aspect ratio, the tear gesture, the ceremony timing, or the card-dealing logic.
- The `CollectorSignupGate` stays above the pack; if it pushes the pack down on short screens, consider reducing its bottom margin from `mb-5` to `mb-3`.

## Verification
- Run `bun run lint` and `bun run typecheck`.
- Open the preview at a phone viewport (360×640 or similar), navigate to the Pack tab, and confirm the sealed pack and its caption are fully visible without scrolling.
- Tear open a pack to confirm the ceremony still scales and the cards fan correctly from the smaller starting size.
