# PR 0 — Design tokens and control sizes

One type scale, one spacing scale, one set of control sizes, so later UX phases change tokens instead of utility strings. Implements §16, §17, §18, §26 of `docs/ux-audit-mobile.md`. No screen layout changes beyond button heights and the header.

## 1. Tokens in `src/styles.css`

Add to `@theme inline`:

- Font sizes (§16), each with its line height: `--text-title` 30/32, `--text-section` 18/22, `--text-card-name` 15/18, `--text-viewer-name` 22/24, `--text-body` 15/22, `--text-label` 12/16, `--text-meta` 12/16, `--text-badge` 13/16, `--text-nav` 11/14, `--text-button` 15/20. Tailwind then emits `text-title`, `text-body`, etc.
- Spacing (§17): `--spacing-page-x` 16px, `--spacing-section-gap` 24px, `--spacing-stack-gap` 8px, `--spacing-grid-gap` 12px, `--spacing-control-gap` 8px.
- `--color-focus: var(--focus)`.

In `:root`: add `--focus: oklch(0.98 0.01 240 / 85%)` and point `--ring` at it, so focus rings stop reading as the cyan `--primary` selection state.

Fix the stale header comment ("electric green accent") to describe the cyan/teal HUD system actually in use.

## 2. Body face

Apply Inter: set `--font-sans` in `@theme inline` to `"Inter", ui-sans-serif, system-ui, sans-serif`. The four weights are already downloaded in `src/routes/__root.tsx`, so this makes the request useful rather than dropping it. Display and mono faces are untouched.

## 3. `neon-btn` size API

Replace the utility's fixed `padding` / `font-size` with three sizes, all sharing the existing gradient, border, glow, hover and active treatment:

- `neon-btn-sm` — min-height 44px, tighter x-padding
- `neon-btn` — min-height 48px (default)
- `neon-btn-lg` — min-height 56px

All three use `font-size: var(--text-button)` and a visible `:focus-visible` outline in `--focus`.

Update the callers that currently override with `!px-* !py-* !text-*`, dropping the overrides:

| File | Size |
| --- | --- |
| `vault-hero.tsx` (Open Pack) | `neon-btn-lg` |
| `players.trade.tsx` (Send offer, Accept) | `neon-btn-lg` |
| `pack-summary.tsx` (3 buttons) | `neon-btn-sm` |
| `players.$id.tsx`, `claim.tsx`, `collector-signup.tsx`, `milestone-reveal.tsx`, `bought-pull-reveal.tsx`, `collection-complete.tsx` | `neon-btn-sm` |

Layout-affecting classes on those elements (`w-full`, `relative`, `z-10`, `disabled:opacity-*`, conditional `ring-2`) stay as-is.

## 4. Global focus ring

In `@layer base`, add a `:focus-visible` rule — 2px outline, 2px offset, colour `--focus` — so raw `<button>`s get a ring without per-component classes.

## 5. `src/components/site-nav.tsx`

- `aria-label="Primary"` on the bottom `<nav>`, `aria-label="Sections"` on the desktop `<nav>`.
- Account/sign-in control becomes 44×44 (`h-11 w-11`, centred glyph); icon size unchanged.
- Wordmark stays one line below 640px: `whitespace-nowrap` plus reduced tracking on the small eyebrow and the "Trading Cards" line at the narrow breakpoint, and the spacer/menu widths adjusted so 320px still fits.
- `padding-top: env(safe-area-inset-top)` on the sticky header (mirrors the existing safe-area spacer at the bottom nav).

## Verification

- `bun run format`, `bun run lint`, `bun run typecheck`, `bun run test`.
- `grep -rn "neon-btn" src | grep -c "!py-"` returns 0.
- Screenshot the header at a 320px viewport to confirm one line; tab through the vault to confirm the focus ring is white-ish, not cyan.

## Notes

- Tests that assert on button classes or nav labels get updated alongside; no new behaviour tests are needed for a token pass.
- I cannot create the `ux/00-tokens` branch or open the PR from here — git operations are managed by the platform. I'll make the changes on the working branch and you can raise the PR titled "Design tokens and control sizes".
