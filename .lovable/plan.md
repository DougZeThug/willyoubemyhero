## Diagnosis

The data is fine — the database still has all 21 participants and 18 event_participants for the active event, and an anon PostgREST query with the app's publishable key returns them correctly. So this is not RLS or a missing grant.

What is actually broken: the `getEventBundle` server function that feeds the UI is failing (500) on the deployed environment. When it fails, every screen that reads `bundle.participants` renders the empty state — which is exactly what the screenshots show (Vault "0 of 0", Order empty, Leaderboard empty, Add Player "0 on roster"). The server logs also show a resolver error (`Server function info not found …`) and the dev process has been exiting (`script "dev" exited with code 143`) with Vite reporting `Invalid server function ID` for `getActiveEvent`, which is a stale/desynced server-function manifest after the recent secret-cards + weighted-pull migrations and code churn.

## Fix

1. Rebuild / re-publish so the server-function manifest matches the current client bundle. This alone should restore the roster on production.
2. In `src/lib/event.functions.ts`, harden `getEventBundle` so a single sub-query failure can't wipe out the whole bundle:
   - Replace the destructured `Promise.all` with per-query try/catch (or `Promise.allSettled`) that logs the failing table and returns `[]` for just that slice, so participants never disappear because of an unrelated table (splits/penalties/drafts).
   - Log `error` from each Supabase call (currently only `.data` is read; `.error` is silently dropped).
   - Switch the deprecated `.inputValidator(...)` to `.validator(...)` on the two functions that use it, matching the framework warnings.
3. Add a lightweight fallback in `useEventBundle` (`src/hooks/use-event-bundle.ts`): if the bundle query errors, surface it in a toast / dev-console instead of silently rendering "No participants yet.", so a future regression is obvious.
4. Verify:
   - Hit `/_serverFn/<getEventBundle id>` on the redeployed site and confirm HTTP 200 with a non-empty `participants` array.
   - Load `/players`, `/order`, `/board`, and `/admin` in the preview and confirm the 18 roster entries render with names and cards.
   - Tail worker logs for any residual 500s on `event.functions`.

## Technical notes

- Grants and RLS on `participants` / `event_participants` are correct (`anon` has `arwdDxtm` on both; a direct anon curl to `/rest/v1/event_participants?...&select=*,participant:participants!event_participants_participant_id_fkey(*)` returns all 18 rows). No migration is required.
- No schema changes. No auth changes. Frontend/server-function code + a redeploy only.
