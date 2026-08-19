-- Stand a bare Postgres up as the shape our migrations expect.
--
-- The Supabase platform provides all of this; a plain cluster does not. Only
-- the parts the migrations actually touch are recreated here, and each one is
-- annotated with why it matters, because a stand-in that drifts from the real
-- platform is worse than no test at all.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- The three roles every GRANT and REVOKE in the migrations names.
--
-- NOLOGIN because the tests reach them with SET ROLE rather than by connecting.
-- service_role carries BYPASSRLS to match the platform: that is precisely why
-- the app's server functions can write at all, and why the guards in
-- require-auth.server.ts are the only thing protecting those writes.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- PostgREST exposes tables through these roles, so anything not explicitly
-- granted is unreachable. Revoking the default public grant is what makes the
-- "anon cannot write anywhere" assertions meaningful rather than accidental.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;

-- Realtime publication. The migrations add tables to it; without it they error.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END
$$;

-- Storage. Only `objects` and `buckets` are referenced, and only to attach
-- policies to them, so the columns the policies read are all that is needed.
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb
);

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT SELECT ON storage.buckets TO anon, authenticated, service_role;
GRANT ALL ON storage.objects TO service_role;

-- Auth. GoTrue owns this schema on the platform; here it exists only so the
-- migrations that name it can replay. `admin_accounts` has a foreign key to
-- auth.users(id) and seeds itself with a lookup on `email`, so those two
-- columns are all that is recreated — a stand-in that drifts any further from
-- the real thing would be worse than none. On an empty cluster the seed matches
-- nothing, which is correct: a test database has no admin account.
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text
);

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
