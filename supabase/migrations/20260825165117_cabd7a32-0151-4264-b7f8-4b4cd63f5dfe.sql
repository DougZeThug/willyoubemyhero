-- Hardening two function search_paths — GUARDED, because this file sorts before
-- the migrations that create the functions it alters.
--
-- roll_card_edition is created by 20260826120000 and mill_value by
-- 20260826130000, both of which sort AFTER this one. Applied through the editor
-- against the live database these landed in real chronological order and took
-- effect; replayed from empty in filename order they hit two functions that do
-- not exist yet, and a bare ALTER FUNCTION raises. That is what took the whole
-- `db` suite out — not one test, the cluster build itself, so every database
-- test in the repo stopped running.
--
-- to_regprocedure returns NULL rather than raising for a signature nothing
-- matches, which is what makes this replayable. A no-op wherever this file has
-- already applied, and the statements are unchanged otherwise.
--
-- The hardening itself is NOT abandoned by the guard: 20260829130000 re-asserts
-- both, after the functions exist, so a replayed database ends up with the same
-- search_path settings as the live one. Skipping here without that would trade a
-- loud failure for a silent drift.
DO $$
BEGIN
  IF to_regprocedure('public.roll_card_edition(uuid, uuid, date)') IS NOT NULL THEN
    ALTER FUNCTION public.roll_card_edition(uuid, uuid, date) SET search_path = public;
  END IF;

  IF to_regprocedure('public.mill_value(text)') IS NOT NULL THEN
    ALTER FUNCTION public.mill_value(text) SET search_path = public;
  END IF;
END $$;
