# Running the database tests inside Lovable

Short answer: you don't have to skip them. This sandbox does have Postgres — the earlier run failed because the harness looked in `/usr/lib/postgresql/*` and `/usr/local/bin`, while the binaries here live in `/bin`. Setting `PG_BIN_DIR` makes `bun run test:db` work here exactly as it does in CI.

Verified in this sandbox: `initdb`, `pg_ctl`, `psql`, `setpriv` all present in `/bin`, and the `postgres` system user exists (needed because we run as root and Postgres refuses to).

## What to change

1. `tests/db/cluster.ts` — add `/bin` and `/usr/bin` to `PG_CANDIDATES` so the harness finds the binaries without any env var. Purely additive; the existing paths keep working on other machines.
2. `package.json` — leave `test:db` as-is (CI sets `PG_BIN_DIR` itself); the candidate list covers the sandbox.
3. `README.md` / `AGENTS.md` — one line noting `PG_BIN_DIR` as the escape hatch when the binaries are somewhere unusual.

## If you would rather they never run in Lovable

Alternative: keep the db suite CI-only and make that explicit rather than accidental — skip the whole `db` project when `initdb` can't be found, so a local `bun run test:db` prints "skipped: no Postgres binaries" instead of timing out. That is a change to `tests/db/globalSetup.ts` plus a guard in the db test files.

## Note on the timeout

Standing up a throwaway cluster (initdb + start + bootstrap + every migration in order) takes a while on first run. Even with the path fixed, expect the first `bun run test:db` to be slow; it needs a generous command timeout rather than the default.
