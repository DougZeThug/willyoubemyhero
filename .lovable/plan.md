
# Phase 3 — Spectator, Media, Analytics

Builds on the existing HUD/dark broadcast app. Three tracks, one integrated pass.

## Track A — Spectator mode + QR sharing

- New public route `src/routes/live.tsx` — read-only broadcast view (no admin controls). Reuses `useEventBundle` + realtime for live timer, current runner, station, and top-5 leaderboard sidebar.
- New route `src/routes/tv.tsx` — big-screen layout (16:9), oversized HUD timer, standings ticker, "on deck" card, station name banner. Auto-hides cursor, no bottom nav, hides on small viewports with a "open on TV" hint.
- Admin screen: add a QR code panel (using existing `qrcode` dep) that encodes the `/live` URL. Copy-link and "open TV view" buttons.
- Nav: add a subtle "Live" link for spectators; keep admin gated by PIN as today.
- Public SSR-safe: reads go through the existing publishable-key server fns / `events_public` view; no PIN required.

## Track B — Rich media + result cards

- Participant photo uploads
  - Admin roster editor: upload avatar → private `participant-photos` bucket (already exists). Store object path on `event_participants.photo_path`.
  - New server fn `getSignedPhotoUrl` returns short-lived signed URLs; `ParticipantAvatar` prefers the signed URL and falls back to initials.
- Finish celebrations
  - When a run finishes, emit a full-screen overlay on `/admin` and `/live`: confetti (canvas), athlete name, final time, delta vs. leader. Auto-dismiss after 4s or on tap.
  - Motion via existing `motion` dep; respects `prefers-reduced-motion`.
- Exportable PNG result cards
  - New util `src/lib/result-card.tsx` renders a 1080×1350 card (name, photo, time, splits, event, date) into an offscreen node.
  - Export via `html-to-image` (add dep) → download PNG + Web Share API when available.
  - Buttons: per-run row on leaderboard ("Share card") and a final "Draft board" card on `/draft` once complete.

## Track C — Advanced analytics

- Per-station split breakdowns
  - New route `src/routes/analytics.tsx` with tabs: Splits, Bests, Head-to-Head, History.
  - Splits tab: per-station table (best, median, worst, your rank), bar chart via `recharts` (add dep).
- Personal bests
  - Server fn aggregates each participant's best station splits and best total across all past events. Displayed on participant detail drawer + Bests tab.
- Head-to-head
  - Pick two participants → side-by-side splits, deltas per station, total gap, mini timeline.
- Historical event archive
  - New table `public.event_archive_snapshots` (event_id, snapshot jsonb, created_at) written on event completion via an admin "Archive event" action.
  - History tab lists past events with final standings and links to a read-only recap page `src/routes/recap.$eventSlug.tsx`.

## Data / backend changes

Single migration:
- `alter table event_participants add column photo_path text;`
- `create table public.event_archive_snapshots (...)` + GRANTs + RLS (public SELECT of snapshot json; service_role all).
- Extend `events_public` view / public server fns to expose snapshot summaries for recap pages.
- Storage: keep `participant-photos` private; add owner/service policies already in place; new admin fn issues signed URLs.

## Technical notes

- Deps to add: `recharts`, `html-to-image`, `canvas-confetti` (+ types).
- All new public routes get proper `head()` metadata (title, description, og:title/description, og:type=website, twitter:card=summary_large_image). No og:image unless a stable absolute hero URL exists.
- Reuse existing tokens: `hud-bezel`, `neon-btn`, `circuit-bg`, cyan/teal palette. No new colors.
- Timer visuals on `/live` and `/tv` reuse `HudTimer` at larger sizes; realtime channels are shared, not duplicated.
- Result-card export runs client-only (`<ClientOnly>` wrapper) to avoid SSR of `html-to-image`.
- Confetti and `html-to-image` are dynamically imported to keep initial bundle small.

## Out of scope

- Multi-event tenancy / user accounts (still PIN per event).
- Video capture / streaming.
- Push notifications.
