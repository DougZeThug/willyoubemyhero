# Unblock the replay-from-empty database suite

The `database` CI job applies every migration to a fresh Postgres. Migration
`20260818190731_…` creates `public.admin_accounts` with
`REFERENCES auth.users(id)` and seeds it with a `SELECT … FROM auth.users`,
but `tests/db/bootstrap.sql` only stands up the `storage` schema. There is no
`auth` schema in a bare cluster, so the replay stops there — on this branch and
on main alike.

## The fix

**1. `tests/db/bootstrap.sql` — add an `auth` stub, in the same spirit as the
storage one: only what the migrations actually touch, with a comment saying
why.**

- `CREATE SCHEMA IF NOT EXISTS auth`
- `auth.users` with just the columns referenced: `id uuid primary key default
  gen_random_uuid()`, `email text`. Nothing else — a stand-in that drifts from
  the platform is worse than none.
- `GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role` so the
  foreign key and the seed statement resolve.

The seed `INSERT … SELECT` then matches zero rows on an empty cluster, which is
correct: no admin account exists in a test database.

**2. `tests/db/migrations.test.ts` — extend `EXPECTED_TABLES`.**

That test asserts the exact list of public tables. Once the replay gets past
the failing migration it will find two tables the list doesn't name yet:
`account_identities` and `admin_accounts`. Add both in alphabetical position.

## Scope

Two files, no application or migration changes. Nothing about the live database
changes — this is purely the local/CI test harness catching up with a migration
that already shipped.

## Verification

`bun run test:db` from empty (slow first run: initdb plus every migration), then
lint and typecheck.
