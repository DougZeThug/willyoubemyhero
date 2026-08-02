# Fix broken card fronts on mobile

## What's actually wrong

Confirmed from the database and storage:

- Every roster card front in storage is a full-size PNG of roughly **3 MB**, and the Players grid renders 13+ of them at once.
- The responsive variant columns (`card_path_thumb`, `card_path_medium`, and the photo equivalents) are **null for every participant** — the smaller sizes were never generated. So `srcset` has nothing smaller to offer and the browser downloads the 3 MB original even for a tiny grid tile.
- Secret cards look fine only because they are rendered one at a time.

On a phone, a dozen simultaneous 3 MB fetches stall or get dropped and the `<img>` falls back to its alt text — exactly the "AJ Dewalt card front" boxes in the screenshot. This is payload weight plus no failure handling, not a card-back bug.

## The fix

**1. Actually produce the small sizes**
Try the storage layer's built-in image transformation first: sign URLs with a width/quality transform so thumb and medium are derived on the fly with no re-upload. Probe one path first — if transformation isn't available on this project, fall back to the existing browser-side backfill (the admin "Regenerate image sizes" button) and run it across all participants so the variant columns get filled.

**2. Stop the grid from asking for full-size art**
Card tiles pick `thumb`/`medium` from the URL set instead of defaulting to `large`. Only the full-screen card view and the pack reveal request `large`.

**3. Make a failed image recoverable instead of permanently broken**
Give `HoloCard`'s front and back images the resilience `PackFace` already got: track `loaded`/`failed` through a ref that also checks `img.complete` for cached images, retry once with a freshly signed URL, then fall back to the existing `CardPlaceholder` (initials + name) rather than a broken-image icon.

**4. Throttle concurrency in the vault grid**
Keep `loading="lazy"` for off-screen tiles and mark only the first row eager, so the phone isn't opening a dozen large connections simultaneously.

## Technical notes

- `src/lib/media.functions.ts` — `signPath`/`signSet` gain an optional transform width; `getEventCardUrls` and `getEventPhotoUrls` return real thumb/medium URLs.
- `src/components/holo-card.tsx` — a `size` prop for which variant to request, plus `onError` retry/placeholder handling on both faces.
- `src/routes/players.index.tsx` — grid tiles request the small variant.
- Verify with lint, typecheck, unit tests, and a phone-width browser pass on `/players` confirming every tile paints.

No schema change is required; the variant columns already exist.