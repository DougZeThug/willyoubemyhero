## Problem

Entering PIN `1234` calls `verifyEventPin`, which the server confirms as `ok:true`. But the next `getAdminStatus` call still returns `eventId: null` — the `wwbh-admin` session cookie set by `useSession` never comes back on the follow-up request. Result: `PinGate` keeps rendering (4 dots stuck on screen); on production Firefox the retry loop lands on the root `errorComponent` ("This page didn't load"). This is reproducible in the current network log.

The cookie fails for two reasons combined:
- Lovable preview runs the app inside a cross-site iframe; Firefox's tracking protection drops the session cookie.
- The Set-Cookie from `useSession().update()` inside a `createServerFn` handler isn't reliably attached to the response body used by TanStack's serverFn transport.

## Fix

Stop relying on a server-side cookie session for admin unlock. Instead:

1. **`verifyEventPin`** returns a short-lived signed token (HMAC of `eventId + expiresAt` using `SESSION_SECRET`) when the PIN matches — no `useSession`, no Set-Cookie.
2. **Client** stores that token in `localStorage` (per-device admin unlock, matching the intent of "event PIN on this device").
3. **`getAdminStatus`** is replaced by a pure client check: parse the stored token, verify expiry, expose `eventId` if still valid. No server round-trip needed for the gate.
4. **Protected server fns** (`saveCompletedRun`, `setParticipantStatus`, `uploadParticipantPhoto`, `archiveEvent`) take the token as an argument and verify HMAC + expiry + eventId server-side via a shared `requireAdminToken(token, eventId)` helper. Replaces the current `useSession`-based `requireAdmin`.
5. **Sign-out** just clears the localStorage key and invalidates the admin-status query.

## Files touched

- `src/lib/session.server.ts` — add `signAdminToken`, `verifyAdminToken` (HMAC-SHA256 with `SESSION_SECRET`); keep `hashPin` / `timingSafeEq`; drop `getSessionConfig`.
- `src/lib/admin.functions.ts` — `verifyEventPin` returns `{ ok, token, expiresAt }`; remove `getAdminStatus` server fn and `adminSignOut` server fn.
- `src/lib/admin-token.ts` (new, client) — `getAdminToken`, `setAdminToken`, `clearAdminToken`, `readAdminSession()` returning `{ eventId, expiresAt } | null`.
- `src/lib/admin-write.functions.ts` — add `token: string` to every input validator; call new `requireAdminToken` server helper; keep behaviour otherwise.
- `src/lib/media.functions.ts` — same token change on `uploadParticipantPhoto` and `archiveEvent`.
- `src/routes/admin.tsx`:
  - Replace `useQuery(['admin-status'], getAdminStatus)` with a small `useAdminSession()` hook that reads localStorage and re-checks on `storage` events.
  - `attempt()` stores the returned token, then updates local state — no query invalidation round-trip.
  - Pass the token into every mutation call.
  - `signOut()` clears localStorage and local state.

## Verification

- Load `/admin`, type `1234` → `TimingConsole` renders immediately, no server round-trip stalls, works in the Lovable preview iframe and on production willyoubemyhero.com.
- Reload the page while unlocked → still unlocked until token expiry (12h).
- Tamper with the localStorage token → server rejects any protected write.
- Sign out → gate returns.

## Notes

- Security posture is unchanged: the PIN was already a per-device unlock, and every mutation still verifies an HMAC-signed token server-side using the server-only `SESSION_SECRET`. No new secrets, no schema changes, no migration.
