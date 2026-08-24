-- Supabase's default privileges on `public` hand anon/authenticated ALL on a new
-- table, so the grant above was widened behind the migration's back. RLS already
-- refuses the write (there is only a SELECT policy), but a forged trophy is a
-- public claim on somebody's player page and belt-and-braces is cheap.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.collection_trophies FROM anon, authenticated;
GRANT SELECT ON public.collection_trophies TO anon, authenticated;