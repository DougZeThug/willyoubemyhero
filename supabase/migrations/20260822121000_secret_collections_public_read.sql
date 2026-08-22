-- Let anon read the names of the secret-card sets.
--
-- 20260819222006 created this table with no anon grant and a comment saying so
-- on purpose, because everything else in the secret-card feature is
-- commissioner-only. The set NAMES are the exception, and always have been:
-- getSecretCollections is an unguarded server function that already returns
-- { id, label } to any caller, because the vault has to label the shelves it is
-- showing. That handler was serving them as service_role, which meant its
-- hand-written column list was the only thing keeping the rest of the row in.
--
-- This grant does not publish anything that endpoint did not already publish. It
-- moves the boundary out of one handler's SELECT string and into the database,
-- where the rest of the public read surface already lives — so the handler can
-- run on the publishable key and RLS becomes a second layer under it.
--
-- WHAT IS NOT GRANTED, and must never be: secret_cards. A set's name says
-- nothing about what is inside it or how big it is, which is the whole silence
-- rule the feature rests on. tests/db/rls.test.ts asserts both halves.
GRANT SELECT (id, label, sort_order, active) ON public.secret_collections TO anon, authenticated;

DROP POLICY IF EXISTS "secret_collections public read" ON public.secret_collections;
CREATE POLICY "secret_collections public read"
  ON public.secret_collections FOR SELECT USING (true);
