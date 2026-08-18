# Admin access without the PIN for your account

Right now the admin console only opens after someone types the 4-digit event PIN. Since you're signed into an account, your phone should unlock the console on its own.

## How it will work

- Your account is marked as an admin account in the database (just yours — everyone else still needs the PIN).
- When you open the admin page while signed in, the app quietly asks the server "is this account an admin?" and, if yes, unlocks the console immediately. No PIN screen, no extra tap.
- If you're not signed in, or the account isn't an admin, the PIN screen behaves exactly as it does today, so the PIN remains a working fallback.
- Signing out or the 12-hour session expiring returns you to the PIN screen; opening admin again while signed in re-unlocks it.

## Technical notes

- New table `public.admin_accounts` (`user_id` referencing the auth user, timestamps), RLS enabled with no policies — it's only ever read by trusted server code. Seeded with your account's auth user id (looked up by your sign-in email during implementation; if more than one candidate exists, I'll confirm with you before seeding).
- New server function in `src/lib/admin.functions.ts`, e.g. `startAdminSessionFromAccount`, using `requireSupabaseAuth` so the identity comes from the verified bearer token, never from the request body. It checks `admin_accounts` for `context.userId`, resolves the active event, and returns a normal `signAdminToken(eventId)` result. No new token scheme — the existing `x-admin-token` guard (`requireAdmin`) is unchanged, so every write stays protected exactly as it is today.
- In `src/routes/admin.tsx`, when `useAdminSession()` is null and a Supabase session exists, call that function once on mount and `setAdminToken(...)` on success; on failure fall through to the existing PIN gate silently.
- Small UI touch: the admin header shows "Unlocked via your account" instead of the PIN badge when it was minted this way (derived from local state, not the token shape).
- Tests: unit coverage for the new server function (admin account → token, non-admin account → refusal, no session → refusal).
