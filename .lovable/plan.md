## Player Cards

### Storage & data
- Reuse the existing private `participant-photos` bucket with a `cards/` prefix (or add `card_path` column to `event_participants`).
- Migration: `ALTER TABLE event_participants ADD COLUMN card_path text;`

### Server functions (src/lib/media.functions.ts)
- `uploadParticipantCard({ eventParticipantId, contentType, bytesBase64 })` — admin-only, stores to `cards/{eventId}/{ep.id}.{ext}`, updates `card_path`.
- `deleteParticipantCard({ eventParticipantId })` — admin-only.
- Extend `useEventPhotoUrls` (or add sibling `useEventCardUrls`) to sign `card_path` URLs.

### Routes
- `src/routes/players.tsx` — grid of all participants (square photo + name), each links to `/players/$id`.
- `src/routes/players.$id.tsx` — full-bleed card: if `card_path` signed URL exists, show the image at natural aspect (max-w screen, centered, dark bg); otherwise fallback panel showing photo, name, team, running order, official time. Head meta uses player name; og:image = card URL when present.

### Admin
- In `admin.tsx` participant row: add "Upload Card" button next to existing photo upload, plus remove-card action when present. Same file-picker pattern as photos.

### Name links (all instances)
Wrap participant names in `<Link to="/players/$id" params={{ id: ep.id }}>` in:
- `src/routes/order.tsx`
- `src/routes/leaderboard.tsx`
- `src/routes/live.tsx`
- `src/routes/tv.tsx`
- `src/routes/draft.tsx`
- `src/components/result-card.tsx` (skip — export image)

### Nav
- Add "Players" entry to `src/components/site-nav.tsx` (desktop + mobile bottom nav).

### Notes
- Card images displayed at their natural (portrait) aspect — no cropping. Grid thumbnails stay square (uses existing profile photo, not card).
- No changes to timing / draft logic.
