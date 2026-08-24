# Stabilize recurring backend credential failures

## Confirmed diagnosis

- The hosted backend is healthy.
- The failure log shows the preview server running without its private backend credential, followed by a restart.
- The currently running preview process has the URL, public key, and private server credential available.
- The generated server client reads the credential only when a database operation begins, so this is not caused by an early module-scope environment read in the card-pull code.
- Rebinding repairs the managed environment, but an already-running server keeps the environment snapshot it inherited at startup; it must restart before the repaired value is visible.

## Plan

1. Treat another occurrence as a managed binding incident rather than changing database access or weakening security.
2. Rebind the canonical backend credentials, restart the preview server once, and verify the replacement process inherited all required variable names without exposing their values.
3. Exercise the failing card-count server function and `/players` route, then check runtime and server logs for a clean request.
4. If the binding disappears again after a verified restart, capture the lifecycle timing and escalate it as a recurring preview-environment issue; do not add credentials to source files, browser variables, or an app-level fallback.

## Scope

No database migration or application-code change is currently justified. The safe durable fix belongs to the managed preview environment; application fallbacks would either expose a privileged credential or silently reduce authorization guarantees.
