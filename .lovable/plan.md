# Stop the recurring backend-binding failure

## Confirmed cause

- The failing preview worker was started without `SUPABASE_SERVICE_ROLE_KEY`.
- Rebinding credentials did not repair that already-running process because process environment is fixed at startup.
- Restart attempts then repeatedly failed with `Port 8080 is already in use`, so the stale worker kept serving requests and produced the same error.
- The current worker has all three required backend bindings. The generated server client reads them when first used, so there is no application-code defect to patch.

## Resolution

1. Rebind the managed backend credentials once.
2. Restart the managed preview cleanly, targeting the process that actually owns port 8080 rather than only a parent or duplicate process.
3. Confirm there is exactly one preview listener and that its process has all required backend bindings.
4. Exercise the exact Vault and card-count server requests in a browser, then confirm there are no fresh credential, blank-screen, or server-route errors.
5. If a clean managed restart later launches another worker without the binding, capture the restart timestamp and worker identity as a platform lifecycle defect rather than repeating app changes.

## Scope

No source, generated integration, dependency, or database changes. This is an environment/process correction and verification only.
