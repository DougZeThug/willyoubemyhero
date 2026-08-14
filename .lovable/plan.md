# Thin the metal ring so silver reads like Dan's gold

On the vault the silver frame around Danielo sits as a wide bright band, while
Dan's gold reads as a crisp thin line. Both use the same rule today (a 6px ring),
but a light metal on a light card edge visually fattens, so the ring needs to be
thinner overall.

## What changes

The metal ring for all four finishes drops from a 6px band to a thin ring — a
~2px metal edge plus its single bright hairline — so every finish reads like the
gold card: a crisp outline hugging the card, not a plastic slab.

```text
before                after
▓▓▓▓▓▓▓▓▓▓            ────────────
▓  card  ▓            │   card   │
▓▓▓▓▓▓▓▓▓▓            ────────────
```

The metal colours, glow bloom, platinum sheen and the single word under the card
are unchanged.

## Technical notes

- `src/styles.css`: `.card-edition-bronze/-silver/-gold/-platinum` padding
  6px → 2px; keep the inset specular hairline (drop to 1px so it does not swamp
  a 2px ring) and the existing outer bloom.
- Base `.card-edition` padding stays as the fallback; no component or logic
  changes, no database work.
