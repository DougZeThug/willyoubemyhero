# Every card renders at standard poker-card size (2.5 × 3.5)

## What's happening now

`HoloCard` measures each image's real width/height when it loads and uses that as the card's aspect ratio, caching it per card. The 5/7 poker ratio is only a fallback used until the art reports its own size. So a card whose art was exported at a slightly different ratio renders taller or wider than its neighbours, and the vault grid ends up with uneven tiles.

## The change

### 1. Lock the card frame to 5/7
- In `src/components/holo-card.tsx`, always use `aspectRatio: 5 / 7` instead of the measured value.
- Drop the measure-and-cache path: the `aspect` state, the `primeCardMeta` restore effect, and the `onLoad` handler that writes `saveCardMeta`. The art already renders with `object-cover`, so off-ratio art is cropped to the frame rather than stretching it.
- Leave `card-collection`'s meta helpers in place; they just stop being fed aspect from the card.

### 2. Make the sealed pack match
- `src/components/pack-wrapper.tsx` renders the unripped pack at `aspect-[3/4]`. Change it to `aspect-[5/7]` so the wax foil and the universal back behind it are card-shaped.
- Confirm the skeleton/placeholder frames in `players.pack.tsx`, `pack-stand.tsx` and `roster-filmstrip.tsx` stay `aspect-[5/7]` (they already are), so nothing shifts between skeleton and loaded card.

### 3. Share graphic
- The 1080×1350 share image keeps its canvas size, but the card drawn inside it uses a 5/7 frame so the exported image matches what the app shows.

## Notes

- No image re-upload or database change is needed. Existing art is cropped to the frame by the existing `object-cover`, so every existing card picks up the standard size immediately.
- Cached per-card aspect values in IndexedDB become unused; harmless, simply no longer read.

## Verification

- `bun run lint`, `bun run typecheck`, `bun run test`.
- Phone-width pass on `/players`, a single `/players/$id` card, and the pack flow, confirming every tile and both faces are the same shape.