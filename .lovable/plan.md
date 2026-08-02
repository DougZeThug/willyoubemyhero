# Fix "NO CARD ART" on the vault and player cards

## What is going wrong

Two things stacked up:

1. **The images are still enormous.** No card in the database has its resized
   variant columns filled in (checked: `card_path_thumb` and `card_path_medium`
   are empty for every row). The fallback added last turn asks storage to
   resize on the fly, and that works — but the "large" entry in the srcset is a
   1600px resize of a 3100 KB PNG and comes back at 3104 KB. On a 3x phone
   screen the browser picks that biggest entry, so a grid of 18 cards still
   tries to pull tens of megabytes and the requests die.
2. **A failed image is now permanent.** The error fallback added last turn
   flips the card to the initials placeholder and never tries again, so one
   stalled request becomes "NO CARD ART" for the rest of the session — exactly
   what the screenshot shows.

## The fix

**Stop serving multi-megabyte art.**
- Ask storage for WebP explicitly (the default returns the original format,
  which is why the probe came back as full-weight PNG) and lower quality for
  the small sizes.
- Cap the grid srcset at the thumb and medium transforms. The 1600px version is
  only offered on the single-card view, where one image is on screen.
- Route every size through a transform until real variants exist, including
  "large", instead of handing back the untouched original.

**Make a failure recoverable instead of terminal.**
- On an image error, retry once at the next size down (large → medium → thumb)
  before falling back to the initials placeholder.
- Show the placeholder only when the card genuinely has no art, or after every
  size has failed — and clear the failure whenever a fresh signed URL arrives.

**Remove the dependence on on-the-fly resizing.**
- Run the existing admin "Regenerate image sizes" backfill so the variant
  columns hold real, permanently small files; the transform path then only
  covers newly uploaded art until the next backfill.

## Technical notes

- `src/lib/media.functions.ts`: add WebP format and per-size quality to the
  transform options, and route the `large` slot through a transform when no
  variant path exists.
- `src/components/holo-card.tsx`: replace the boolean failed flags with a
  size-step-down state; grid tiles get a srcset limited to thumb + medium with
  `CARD_GRID_SIZES`.
- Verify at a 390px viewport with Playwright that every tile has
  `naturalWidth > 0` and that no image response exceeds a few hundred KB.

## Also spotted

"Alex Manning" is still in the roster despite the earlier request to remove
him. Say the word and I will clean that record up in the same pass.