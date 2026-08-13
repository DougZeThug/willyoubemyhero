# Special finishes lead the label, and wear a heavier frame

Right now a pulled card shows its tier word ("Base") as the headline and pushes the finish underneath as "Silver Parallel". That buries the rarest thing about the copy. This flips it.

## What changes

**The word.** Drop "Parallel" everywhere — the finishes are simply Bronze, Silver, Gold, Platinum.

**The headline.** On any card with a special finish, the big label becomes the finish word, printed in that metal's colour. The tier word and its reason move to the small line underneath, so nothing is lost:

```text
before                         after
┌──────────────────┐           ┌──────────────────┐
│ BASE             │           │ SILVER           │  <- silver colour
│ Combine athlete  │           │ Base · Combine…  │
└──────────────────┘           └──────────────────┘
│ SILVER PARALLEL  │           (no second pill)
└──────────────────┘
```

A standard finish (7 pulls in 10) is untouched — it still leads with the tier, exactly as today.

**The frame.** The metal border around the card art steps up harder per rung, so the finish is readable across the garden without reading a word:

- Bronze — today's thin ramp, unchanged
- Silver — slightly thicker, plus an inner hairline
- Gold — thicker again, brighter hairline
- Platinum — widest, double hairline and a stronger outer bloom

Roughly a "3 out of 5" step-up: clearly bolder than now, still a frame rather than a slab.

## Where it shows up

Player page badge, vault grid tiles, pack summary rows, the pack stand reveal, the slab plate on a full card, the card back, and the shareable card graphic — all one consistent treatment. The card back keeps its odds line ("0.5% pull") since that is the only place the rate is printed.

## Technical notes

- `src/lib/card-edition.ts`: shorten `EDITIONS[*].label`; add a small helper that returns the headline/subline pair for a (tier, edition) so the six render sites cannot drift apart.
- Render sites updated to use it: `routes/players.$id.tsx` (TierRibbon / EditionRibbon collapse into one ribbon), `routes/players.index.tsx`, `components/pack-summary.tsx`, `components/pack-stand.tsx`, `components/card-back-panel.tsx`, `components/card-slab.tsx`, `components/share-card-graphic.tsx`, plus the `holo-card` aria label.
- `src/styles.css`: retune `.card-edition-*` padding, inset hairlines and bloom per rung; platinum's sheen animation and the reduced-motion opt-out stay as they are.
- Existing unit tests that pin the old label strings get updated in the same pass.

No database or server changes — the stored edition ids are untouched.
