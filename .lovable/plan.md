# Admin-created secret card sets

Right now the answer is no: the four sets (Cornhole Collection, WAGs, Pets, Legacy Pets) are a
fixed list written into the code. Admins can file a card into one of those, and apply a
set-wide foil/border, but they can't create a new set from the app.

This makes sets data instead of code, so you can add one from the Secret Cards panel.

## What changes for you

- A **Sets** control at the top of the Secret Cards panel: "New set", plus rename and reorder
  for the sets you've made.
- Creating a set immediately makes it available in the upload "Add to" picker, every card
  tile's Set dropdown, the mobile edit sheet, and the set-wide look control.
- Deleting a set is only allowed when it's empty; otherwise the option is to hide it, so no
  card ever loses its filing.
- The vault groups a player's owned secrets by the same sets, in the order you set.

## How it works

- New table `public.secret_collections`: `id` (short slug generated from the name),
  `label`, `sort_order`, `active`, timestamps. Seeded with the four existing ids and
  labels in the same migration so nothing already filed moves. Written idempotently
  (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`) so the replay-from-empty database suite
  still passes. No `anon` grant — all reads/writes go through `service_role` server
  functions, like the rest of secret cards.
- `secret_cards.collection` stays an unconstrained text column pointing at a slug; ids
  remain add-only and are never renamed, only labelled.
- `src/lib/secret-cards.functions.ts`: new `listSecretCollections`, `createSecretCollection`,
  `updateSecretCollection` (label / order / active), `deleteSecretCollection` (refuses
  when cards reference it). All behind `requireLeagueAdmin()` as the first line.
  The Zod `cardCollection` enum stops being a compile-time list and validates against
  the ids in the table instead.
- `src/lib/secret-cards.ts`: `SECRET_COLLECTIONS` becomes the seed/fallback list;
  `secretCollectionLabel` and `groupBySecretCollection` take an optional set list so the
  admin panel and vault order by the stored `sort_order` while keeping today's behaviour
  (unknown id renders as itself, unsorted last) when the list isn't loaded.
- `src/components/secret-cards-panel.tsx` and `src/components/secret-card-tile.tsx`:
  set pickers read from the loaded list; new "Sets" management row with create / rename /
  reorder / delete.
- `src/routes/players.index.tsx`: pass the loaded set order into grouping.
- Tests: extend `src/lib/secret-cards.test.ts` (grouping with a dynamic list),
  `src/lib/secret-cards.functions.test.ts` (create/rename/delete, delete blocked when in
  use, unknown id rejected) and `tests/db/secret-cards.test.ts` (table replays, seed rows).
- No colour or token changes. Verify with `bun run format`, `lint`, `typecheck`, `test`
  and a 360px pass over the admin console and vault.
