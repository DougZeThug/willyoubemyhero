# Secret card sets: collapsible collections in admin, grouped shelves on the vault

Secret cards get a **collection** (WAGs, Pets, Legacy Pets, Cornhole Collection, …).
The admin panel groups them into collapsible sections, uploads can be dropped straight
into a section, and the players page shows owned secrets grouped by collection instead
of one long shelf.

## Database

One migration adds a nullable `collection` text column to `secret_cards` (plus an index
for grouping). Nullable so every existing card keeps working and simply lands in an
"Unsorted" group until an admin files it. Idempotent (`ADD COLUMN IF NOT EXISTS`) so the
database test suite still replays from empty.

No new table: collection ids live in code, the same way foil, border and award category
ids already do — a fixed, **add-only** vocabulary in `src/lib/secret-cards.ts`:

```text
wags · pets · legacyPets · cornhole   (+ Unsorted for null)
```

Renaming an id orphans stored rows, so ids are never renamed — only labels change, and
new sets are appended.

## Admin panel

- Cards are grouped into a collapsible section per collection, in the fixed order above,
  with Unsorted last. Each header shows the set name and a count ("WAGs · 6").
- Sections remember open/closed per device; the first section starts open.
- The upload zone gains an "Add to" set picker. Whatever is selected is applied to every
  staged draft, and each draft tile can still be moved to a different set before saving.
- Every card tile gets a Set control alongside Weight / Foil / Border, saving on change
  through the existing per-card queue with the same toasts and spinners. The mobile edit
  sheet gets the same control.
- Everything else — weight, foil, border, grant, remove, art replace — is untouched.

## Players page (the vault)

Owned secrets currently render as one "Secrets" shelf. That becomes one shelf per
collection, in the same fixed order, each with its own small heading in the existing
secret accent colour. Cards with no collection fall under "Secrets" as today.

Rules kept intact: nothing renders for a set the viewer owns nothing from, and no
count of how many cards exist in a set is ever shown — only what you hold. The card
sheet still swipes across the viewer's whole owned list, so grouping is presentational.

## Technical notes

- Migration: `supabase/migrations/<ts>_secret_card_collections.sql` — `ALTER TABLE
  public.secret_cards ADD COLUMN IF NOT EXISTS collection text;` plus
  `CREATE INDEX IF NOT EXISTS ... (collection)`. No grant or RLS change: `anon` still has
  no access, and all reads/writes go through `service_role` server functions.
- `src/lib/secret-cards.ts`: `SECRET_COLLECTIONS` (id + label, ordered), a
  `secretCollectionLabel()` fallback for unknown ids, and `collection` added to
  `SecretCardView`.
- `src/lib/secret-cards.functions.ts`: `createSecretCards` accepts an optional
  `collection` per card, `updateSecretCard` accepts `collection` (nullable),
  `listSecretCards` and `getMySecrets` return it. Zod validates against the known ids.
- `src/components/secret-cards-panel.tsx`: grouping + `Collapsible` sections (already
  used by `admin-section.tsx`), set picker in the drop zone and drafts.
- `src/components/secret-card-tile.tsx`: Set select in the control grid, matching the
  existing `CompactLookSelect` styling; same control in the edit sheet.
- `src/routes/players.index.tsx`: group `ownedSecrets` by collection before rendering.
- Tests: extend `tests/db/secret-cards.test.ts` (column replays, default null) and
  `src/lib/secret-cards.functions.test.ts` (collection round-trips, unknown id rejected).
- No colour or token changes. Verify with `bun run format`, `lint`, `typecheck`, `test`,
  and a 360px pass over the admin console and vault.