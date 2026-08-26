# Add a "Royal Gold" secret foil

Add a new, explicitly gold foil treatment to the secret-card look palette so admins can mark certain rare secret cards as gold without using the duller copper or the yellow-into-teal citrine options.

## What changes

- Add a new foil id `royalGold` to `SECRET_FOILS` in `src/lib/secret-cards.ts`.
  - Label stays `"Secret"`, `prismEdge: true`, `rank: -1`.
  - Gradient: rich gold into a cool champagne/platinum second stop so the pair does not compound with warm admin art under color-dodge.
  - High sparkle, prismatic pattern, with a slow specular shimmer feel.
- Insert `royalGold` into `SECRET_FOIL_OPTIONS` in the warm section of the existing warm → cool → dark ordering, near copper and citrine.
- The zod enum in `src/lib/secret-cards.functions.ts` is derived from `SECRET_FOIL_OPTIONS`, so it picks up the new id automatically. No migration is needed because `secret_cards.foil` has no CHECK.
- Admin pickers (`secret-look-picker.tsx`, set-level row, card tiles) render from the same list, so the new swatch appears everywhere with no component changes.

## Verification

- Run `bun run format`, `bun run lint`, `bun run typecheck`, `bun run test`.
- Confirm the new swatch is visually distinct from copper, citrine, and ember in the unit distinctness assertions.
- Do a 360px pass over the admin Secret Cards panel to confirm the warm section still wraps cleanly with the extra chip.
