# One clean metal frame, one word underneath

The gold Daniel card is the target look: a crisp, evenly lit metal ring hugging the
card, and a single word under it in that metal's colour. Silver, bronze and platinum
should read the same way — and the demoted "Base" line goes away.

## What changes

**The caption.** On a card with a special finish, the only word under the card is the
finish — SILVER, BRONZE, GOLD, PLATINUM — printed in its own colour. The tier word and
its reason are dropped from that line entirely.

```text
before                  after
DANIELO CANCELA         DANIELO CANCELA
  SILVER                  SILVER
  BASE
PACKED BY 4             PACKED BY 4
```

A standard finish is unchanged: it still shows its tier word (Base, Champion, …) as it
does today. The "packed by" line stays where it is.

**The frame.** All four metals get gold's treatment rather than four different weights:
the same clear ring thickness, the same single bright hairline, the same bloom strength
— only the metal colour differs. Platinum keeps its slow sheen at hero size; that is the
one extra it gets for being a 0.5% pull.

## Where it shows up

Vault grid tiles, the player page ribbon, the pack stand reveal, pack summary rows, the
slab plate and the shareable graphic. The card back keeps its odds line ("0.5% pull"),
since that is the only place the rate is printed, and its tier stat row is untouched.

## Technical notes

- `src/lib/card-edition.ts`: `cardBadge` returns an empty `sub` on a special finish, so
  every render site drops the demoted tier at once without site-by-site edits.
- Render sites that print `badge.sub` guard on it being non-empty:
  `routes/players.index.tsx`, `routes/players.$id.tsx`, `components/pack-stand.tsx`,
  `components/pack-summary.tsx`, `components/card-slab.tsx`,
  `components/share-card-graphic.tsx` (`editionLabel` passed as the demoted badge becomes
  null there).
- `src/styles.css`: level `.card-edition-bronze/-silver/-gold/-platinum` onto gold's
  padding, inset hairline and bloom; keep the platinum sheen rule and the reduced-motion
  opt-out.
- Unit tests in `src/lib/card-edition.test.ts` that pin the old `sub` string get updated.

No database or server changes.
