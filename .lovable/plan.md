# Make same-device account creation lossless

## Confirmed right now

- Tom's new account is linked to guest identity `c382…2084`, and the secret he opened after signing up is stored against that identity. **That new card will remain his and will follow the account when sync completes.**
- The account link was created at 00:20:50 UTC and the new secret at 00:22:58 UTC.
- The database cannot safely identify Tom's earlier guest identity from anonymous rows alone, so no older pulls will be moved by guesswork.
- The current sync can overwrite the handset's guest token with the account token even when a merge fails, because merge errors are swallowed. Account creation also has no durable handoff copy of the pre-sign-up guest token. Those paths can strand the old collection while leaving the cards intact in the database.

## Plan

1. **Preserve the pre-account identity before auth starts.** Snapshot the server-signed guest/member token into a dedicated pending-handoff slot before email sign-up, email sign-in, or Google sign-in. Keep it across redirects and confirmation links until the backend confirms adoption.
2. **Send and verify both identities during sync.** Extend the account sync request middleware so the backend can verify the current device token and the pending pre-auth token. Never accept a raw guest or participant ID from the browser.
3. **Make adoption fail-safe.** Refactor account synchronization so it does not mint/return a replacement identity until the saved device identity is adopted or merged successfully. Stop swallowing merge/database failures; on failure, preserve the old token, retry, and avoid presenting an empty vault as a successful sync.
4. **Clear the handoff only after success.** Once the backend confirms the account identity and all source guest pulls are reconciled, store the returned token, clear the pending handoff, and invalidate the secret/vault queries for the resolved actor.
5. **Gate the post-auth redirect.** Replace the fixed 900 ms redirect with an explicit syncing state. Continue only after collection sync succeeds; show a retry action if it does not.
6. **Recover Tom's older cards safely.** After the client fix is live, use the preserved/verified identity from Tom's handset to merge the old guest collection into `c382…2084`. If that old token has already been overwritten, identify it from device evidence or a uniquely matching pull history before applying a one-time database repair—never from a guess among anonymous collections.
7. **Add regression coverage.** Test same-device email sign-up, Google redirect, existing-account merge, merge failure/retry, page reload during sync, and a newly opened post-sign-up pack. Assert that the old and new secrets end under one account identity and that no successful UI state appears before reconciliation.

## Technical scope

- Client auth/sync: `src/routes/auth.tsx`, `src/hooks/use-account.ts`, and a small token-handoff helper/middleware.
- Server identity reconciliation: `src/lib/account.functions.ts` and `src/lib/account.server.ts`.
- Tests: account server/function tests plus an auth-to-vault integration regression.
- Database changes only if needed to make multi-guest reconciliation atomic; any migration will retain the existing locked-down access model and service-only execution.
