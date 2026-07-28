Plan: responsive image sizes + LCP preload + backfill

Current state
- Every card/photo is stored as a single ~1600px WebP via `encodeUploadImage` in `src/lib/image-encode.ts`.
- The same 1600px signed URL is used for a 40px avatar, a 64px filmstrip chip, a 160px vault thumbnail, and a full-bleed hero card.
- Components already have `loading="lazy"`, `decoding="async"`, and a signed-URL cache, but the *file bytes* are still 6–10x larger than needed on phones.
- No `srcset`/`sizes`, no LCP preloading, and no smaller variants exist.

What we will build

1. Generate multiple variants at upload time (browser-side)
   - Extend `encodeUploadImage` to produce three sizes from one file:
     - thumb: 320px max edge
     - medium: 800px max edge
     - large: 1600px max edge (existing)
   - All three are encoded as WebP 0.86 quality (or JPEG fallback where WebP is unsupported).
   - Keep the current passthrough logic for already-small files.

2. Store the variant paths in the database
   - Migration adds new columns to `event_participants`:
     - `photo_path_thumb`, `photo_path_medium`
     - `card_path_thumb`, `card_path_medium`
     - `card_back_path_thumb`, `card_back_path_medium`
   - Add `card_back_path_thumb` and `card_back_path_medium` to `events` for the universal back.
   - Update `media.functions.ts` upload helpers to upload all three variants and write every column.

3. Return size-aware URLs from server functions
   - `getEventPhotoUrls` returns `{ id: { thumb, medium, large } }`.
   - `getEventCardUrls` returns `{ id: { front: { thumb, medium, large }, back: { thumb, medium, large } } }`.
   - `getEventCardBack` returns `{ thumb, medium, large }`.
   - Keep the existing signed-URL cache; the same path is still signed once per size.

4. Update UI components to use responsive images
   - `HoloCard` accepts `frontUrl` and `backUrl` as either a string or a `{ thumb, medium, large }` object; render `<img srcset sizes ...>` with `src` as the large fallback.
   - `ParticipantAvatar` renders `srcset`/`sizes` and picks the thumb for its 40–50px display.
   - `RosterFilmstrip` uses the thumb variant for its 64px chips.
   - Vault grid uses `sizes` so phones pick `medium`, while 64px filmstrip uses `thumb`.
   - Player detail hero uses the `medium` source for the LCP card.

5. Preload the LCP image on player detail
   - In `src/routes/players.$id.tsx` `head()`, add a `<link rel="preload" as="image" href={...}>` for the current player's card front `medium` URL.
   - Preconnect the Supabase storage origin in `src/routes/__root.tsx` to cut connection setup time.

6. Backfill existing images
   - Add an admin-panel button "Regenerate image sizes" that, for every existing `photo_path`/`card_path`/`card_back_path`, downloads the original, re-encodes it to three sizes, and updates the new columns.
   - This runs as a client-side batch process (canvas in the admin's browser) so it does not require edge-side image libraries.
   - Existing images continue to work if a backfill is skipped: the UI falls back to the `large` URL when no variants exist.

7. Tests and verification
   - Update `src/lib/media.functions.test.ts` to expect the new multi-size payloads.
   - Add a small test for `encodeUploadImage` returning multiple sizes.
   - Run `bun run lint`, `bun run typecheck`, and a manual check in the preview that vault thumbnails and avatars load visibly faster.

Out of scope
- Server-side image transformation services (would require additional providers or edge-incompatible native libraries).
- Changing the upload quality or the 1600px master size.
- Re-compressing already uploaded files outside the admin backfill button.

Expected result
- A phone on the vault page should download roughly 1/3 to 1/6 the image bytes it does today, because most visible cards are rendered from `medium` or `thumb` instead of `large`.
- The first player card page should paint its LCP image sooner because the browser discovers it earlier via `preload` and `preconnect`.