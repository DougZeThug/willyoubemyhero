# More foil colours for secret cards

Add eight new foil treatments to the secret-card look palette so admins have a wider range of colours to assign to sets and individual cards.

## New foils

Each keeps the shared secret rules (label "Secret", prism edge, rank -1) and follows the existing hue-pairing discipline — no warm→warm pairs, highlight lightness capped so admin art isn't blown out.

| Label | Character |
| --- | --- |
| Crimson | Deep red into violet, scanline pattern |
| Sunset | Coral into deep blue, refractor |
| Citrine | Yellow-gold into teal, prismatic |
| Sandstorm | Warm sand into muted violet, matte, low sparkle |
| Tidal | Sea green into deep blue, refractor |
| Cobalt | Strong blue into cyan, prismatic |
| Amethyst | Purple into rose, shimmer-friendly prismatic |
| Pearl | Very low chroma warm white into pale blue, high sparkle |

Ordering in the picker stays warm → cool → dark, so the new entries slot into the existing strip rather than being appended at the end.

## Technical notes

- All new entries are add-only ids in `SECRET_FOILS` and `SECRET_FOIL_OPTIONS` in `src/lib/secret-cards.ts`. No existing id is renamed or removed, so stored `secret_cards.foil` values stay valid.
- The zod enum in `src/lib/secret-cards.functions.ts` is derived from `SECRET_FOIL_OPTIONS`, so it picks the new ids up automatically. No migration needed — the column has no CHECK.
- Existing tests assert each foil is visually distinct and that swatch counts match the options list; they scale off the same constant and should pass unchanged. Run the unit suite to confirm the distinctness assertions hold for the new pairs, and adjust a colour if two land too close.
- Admin pickers (`secret-look-picker.tsx`, set-level row, card tiles) render from the same list, so the new swatches appear everywhere with no component changes.
