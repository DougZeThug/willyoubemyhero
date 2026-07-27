-- Explicitly revoke any write privileges from anon/authenticated on social tables.
REVOKE INSERT, UPDATE, DELETE ON public.card_comments FROM anon, authenticated, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.card_reactions FROM anon, authenticated, PUBLIC;

-- Belt-and-suspenders: explicit restrictive-style deny policies for direct writes.
-- (RLS is already enabled and no permissive write policies exist; these make the
-- intent explicit so scanners and reviewers can see writes are blocked.)
DROP POLICY IF EXISTS "card_comments no direct writes" ON public.card_comments;
CREATE POLICY "card_comments no direct writes"
  ON public.card_comments
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "card_reactions no direct writes" ON public.card_reactions;
CREATE POLICY "card_reactions no direct writes"
  ON public.card_reactions
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
