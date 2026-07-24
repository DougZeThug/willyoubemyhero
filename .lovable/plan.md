## Two fixes

### 1. Make participant photos square everywhere

Change all avatar/photo displays from circles to squares (rounded corners kept for polish; use `rounded-md`, `aspect-square`).

- `src/components/participant-avatar.tsx`: swap `rounded-full` → `rounded-md`.
- `src/components/result-card.tsx`: change the 220×220 photo tile from `borderRadius: 999` → `borderRadius: 24` so exported PNGs match.
- `src/routes/tv.tsx`, `src/routes/live.tsx`, `src/routes/leaderboard.tsx`, `src/routes/index.tsx`, `src/routes/recap.$slug.tsx`, `src/routes/analytics.tsx`: the rank badges (`h-6 w-6`, `h-9 w-9`, etc.) stay round — they're numbered chips, not photos. Only the actual avatar component (already handled centrally) needs the change.

### 2. Surface the photo uploader on Admin

The uploader already exists (`EventOpsPanel` in `src/routes/admin.tsx`) but only appears **below** the timing console once a PIN is entered, and there's no visible hint. Two changes:

- **Move `EventOpsPanel` to the top of the admin console**, above the run controls, so the "Participant Photos" card is the first thing seen after unlocking.
- **Add a short section header** ("Event Setup") with a subtitle telling admins they can tap any participant row to upload/replace a square photo, and note that the same panel holds the spectator QR + Archive controls.
- The row's tap target already opens the file picker (`<label>` wraps a hidden `<input type="file">`); no logic change needed.

No backend or schema changes. All work is in three files: `participant-avatar.tsx`, `result-card.tsx`, and `admin.tsx`.
