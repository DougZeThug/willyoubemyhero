## Goal

Let a guest (nobody claimed on this phone) do everything a claimed member can do in the vault — open a full 4‑card pack, react, comment — with all guest state kept on the device.

Also investigate the "didn't load for her" report.

## What changes

### 1. Secret 4th card for guests

Today: pack shows a "Claim your player" tile in slot 4 when there's no member.

Change: guests get a real secret card in slot 4, tracked per device.

- New server fn `pullSecretCardForGuest({ deviceId, eventId })` — signs no token, picks one active secret card at random from `secret_cards` server‑side and returns `{ cardId, art/back signed URLs, flavour, foil }`. No writes; no participant row required.
- Guest daily‑limit + duplicate avoidance stays on the device (extend `PackState` with `guestSecretCardId` + already‑seen set in IndexedDB). Members keep the existing DB‑backed path unchanged.
- `players.pack.tsx` swaps the `!me → "gated"` branch for a `"sealed"` slot backed by the guest pull. Reveal + confetti reuse the existing sealed→open flow.

### 2. Reactions and comments for guests

Today: `card-social.tsx` disables the row and shows `<ClaimPrompt>` when `!me`; server fns require a member token.

Change on the client:

- Guest identity = `d:<deviceId>` (already exists via `usePackIdentity`). Persist a chosen display name in localStorage (`wwbh:guest-name`) — first comment prompts for one; reactions don't need a name.
- Drop the disabled state and the claim prompt when a guest identity is available.

Change on the server (`src/lib/social.functions.ts`):

- Split each mutation into two variants: authenticated (member token, unchanged) and guest. Guest variants accept `{ deviceId, displayName? }`, validate shape, and write with `participant_id = NULL` plus a new nullable `guest_device_id` / `guest_name` on `card_comments` and `guest_device_id` on `card_reactions`.
- Rate‑limit guest writes per device (simple in‑memory + row count guard) so nobody spams the wall.
- Reads already public — no change.

Migration:

- Add nullable `guest_device_id text`, `guest_name text` on `card_comments`; nullable `guest_device_id text` on `card_reactions`.
- Relax the NOT NULL on `participant_id` for both tables and add a `CHECK (participant_id IS NOT NULL OR guest_device_id IS NOT NULL)`.
- Uniqueness for reactions extended to `(event_participant_id, coalesce(participant_id::text, guest_device_id), emoji)`.

### 3. "Didn't load for her" investigation

The console shows a hydration mismatch attributed to Progressier stripping body classes, plus a service‑worker 404 on `/progressier.js`. Both are noise on a working session, but the SW registration failure can leave a stale cached shell on repeat visits. Plan:

- Confirm `public/progressier.js` is actually served (404 in the log suggests it isn't in the build output for that host) and fix the path, or remove the registration on non‑published hosts.
- Move the Progressier `<script>` behind `<ClientOnly>` so the body‑class it injects doesn't cause a hydration mismatch that blanks the tree on slower phones.

### 4. Tests

- Extend `card-collection` tests for the new `guestSecretCardId` field round‑trip.
- Add server‑fn tests covering guest comment + reaction paths (happy path, missing device id, rate‑limit).
- E2E: a fixture with no member token opens `/players/pack`, tears it, sees 4 cards including a secret slot, and posts a reaction on a player page.

## Out of scope

Awards voting stays member‑only (one vote per person is meaningless without an identity we control).

## Technical notes

- `pull_secret_card` RPC is unchanged; the guest path deliberately does not write to `secret_card_pulls` (that ledger is per‑member, per‑day and would corrupt the "one a day for real players" invariant).
- Server fns for guest writes live in the same `social.functions.ts` file; the token/no‑token split is done inside the handler, not via middleware, so a member with a stale token still writes as a member.
- All new columns are nullable and additive; existing rows and the `has_role`‑style guards don't move.
