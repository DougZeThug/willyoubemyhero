# Make the Complete plaque take you to the set's cards

Your four Legacy Pets cards are all still yours — they live on their own "Legacy Pets"
shelf further down the vault. The gold plaque in the Complete shelf is only a badge today,
so it reads as if the trophy replaced the cards.

## What changes

- Each plaque in the **Complete** shelf becomes a button: "Legacy Pets · 4 cards · View set".
- Tapping it scrolls the vault to that set's shelf, expands it if it was rolled up, and
  briefly highlights the shelf header so it's obvious where you landed.
- If the set has no shelf right now (every card of it is pinned to Favourites, or the cards
  were traded away), the plaque stays a plain badge — no dead tap.
- Keyboard and screen-reader friendly: real button, accessible label naming the set.
- No colour, token or layout changes otherwise; the plaque keeps its gold medal look.

## How it works

- `src/routes/players.index.tsx`: `trophyTile` takes an `onOpen` handler and renders as a
  `<button>` when a matching secrets section exists in `sections` (matched on
  `secretSectionId(trophy.collection)`).
- The handler expands the section through the existing `useVaultLayout` `toggle` (only when
  it is in `collapsed`), then scrolls to the section element via a ref map / `getElementById`
  on the section id, using `scrollIntoView({ behavior: "smooth", block: "start" })` and
  respecting `useReducedMotion` (instant scroll when motion is reduced).
- Expanding then scrolling happens across a frame so the shelf has laid out before the
  scroll lands.
- No server function, schema or data changes.
- Add a test in `src/routes/` or a small unit test for the "does this trophy have a shelf"
  helper, and verify with `bun run format`, `lint`, `typecheck`, `test`, plus a 360px pass
  over the vault.
