# Themed glowing panels for each card set

Every collection gets its own colour, chosen by an admin, and the vault shelves
and admin set sections wear it as a glowing gradient panel like the trade page.

## What you'll see

**Vault (players page)**

- Each secret-card shelf becomes a glowing bezel panel instead of a flat hairline
  box: the set's colour as a soft radial wash behind the cards, a coloured
  border, and a subtle outer glow.
- The header title, count and chevron take the set's colour.
- Roster, Favourites and Complete keep their current look (Complete stays gold,
  Roster stays neutral) so the sets are the coloured thing on the page.
- Unsorted has no colour of its own and keeps the plain panel.
- Collapsed shelves keep the coloured border but drop the glow, so a page of
  rolled-up shelves stays readable.

**Admin → Secret cards**

- The SETS list gets a small colour swatch next to each set, opening a picker
  with about ten preset colours (cyan, green, gold, magenta, violet, orange,
  red, blue, teal, rose) plus a "None" option.
- The card sections further down (grouped by set) render in that colour, same
  glowing panel treatment, so admins see the result immediately.

## Technical notes

- Migration: `ALTER TABLE public.secret_collections ADD COLUMN IF NOT EXISTS
  accent text` — a nullable oklch string, null meaning "no theme". No grant
  changes; the table is already service_role-only.
- `src/lib/secret-cards.ts`: add `SET_ACCENTS`, the fixed preset list of
  `{ id, label, oklch }`, plus a `setAccent(id, sets)` lookup. Preset ids are
  stored, so they are add-only like the foil and rarity vocabularies. Extend
  `SecretCollection` with `accent?: string | null`, and carry it through
  `groupBySecretCollection` results.
- `src/lib/secret-cards.functions.ts`: `getSecretCollections` selects and returns
  `accent`; `updateSecretCollection` accepts an optional `accent` validated
  against the preset ids (or null). Still `requireLeagueAdmin()` first line.
  Returning a colour leaks nothing about set contents, so the silence rule holds.
- `src/components/vault-section.tsx`: the existing `accent` prop drives a new
  themed panel — `hud-bezel`-style background layered with a
  `color-mix(in oklab, <accent> 12%, transparent)` radial wash, border at ~35%,
  and a glow shadow when open. Colour is passed through inline CSS custom
  properties (`--set-accent`) rather than hardcoded utility classes.
- `src/routes/players.index.tsx`: pass the set's accent (falling back to
  `SECRET_RARITY.accent` when a set has none) into `VaultSection`.
- `src/components/secret-cards-panel.tsx`: swatch picker in the SETS list wired
  to `updateSecretCollection`, reusing the existing `runSetEdit` toast pattern;
  group sections themed the same way.
- Tests: extend `src/lib/secret-cards.functions.test.ts` (admin required, unknown
  accent rejected, null clears) and add a `setAccent` unit test.
- Verify with `bun run format`, `lint`, `typecheck`, `test`, and a 360px pass over
  the vault and admin console.
