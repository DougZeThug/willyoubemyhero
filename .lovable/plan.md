# Quiet the vault tile rarity/pull line so names read first

## Problem

On the vault grid (phone-width, two columns), the line under each card that shows rarity / pull percentage is:

- larger/heavier than the team/player name above it;
- long enough to wrap onto a second row on narrow tiles (e.g. "COMMON · 70% PULL");
- drawing attention away from the card name, which should be the primary label.

The screenshot shows this on secret collection tiles, but the same style is used on roster tiles.

## Change

1. **In `src/routes/players.index.tsx`**
   - Roster tile badge line (around line 989): change `text-badge font-bold uppercase tracking-[0.08em]` to `text-meta font-semibold uppercase tracking-[0.08em] truncate`, and keep the tier/finish colour. Add `truncate` so the caption never wraps.
   - Secret tile tier caption line (around line 887): change `text-badge font-bold uppercase tracking-[0.08em]` to `text-meta font-semibold uppercase tracking-[0.08em] truncate`, keeping the secret tier accent colour.
   - Leave the name line unchanged (`font-display text-sm font-black uppercase tracking-wide text-foreground`) so it stays the dominant label.
   - Leave the league/pack-count lines unchanged as `text-meta` muted text.

2. **Consistency pass on other grid captions**
   - Apply the same `text-meta font-semibold truncate` treatment to the equivalent badge line in `src/components/pack-stand.tsx` (around line 1257) and `src/components/pack-summary.tsx` (around line 612) so pack-grid cards match the vault.
   - Leave the trophy tile in `players.index.tsx` as-is; its "trophy size" label is intentionally celebratory.

3. **No logic or copy changes**
   - The text content stays identical; only size, weight, and line-clamping change.
   - No new tokens or colours; reuse existing `text-meta` and `truncate`.

## Verification

- `bun run format`, `bun run lint`, `bun run typecheck`, `bun run test`.
- Phone-width preview of `/players` vault, confirming:
  - rarity/pull captions stay on one line;
  - team/player names remain visually dominant;
  - no horizontal scroll or clipped text.
