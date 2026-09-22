-- Restore the service-only read on participant-photos that 20260724151735
-- established. The widening to anon/authenticated was overtaken by events:
-- every read now goes through server functions that sign URLs with the service
-- role (src/lib/media.functions.ts), nothing in src calls getPublicUrl, and
-- secret-card art lives in this same bucket precisely so it stays private. A
-- direct object read with the publishable key must never reach it.
--
-- RLS on storage.objects denies by default, so dropping the public policy is
-- enough; the explicit REVOKEs also unwind the table grant the widening added,
-- putting the grants back the way they were before it.
DROP POLICY IF EXISTS "Participant photos are publicly readable" ON storage.objects;
REVOKE SELECT ON storage.objects FROM anon;
REVOKE SELECT ON storage.objects FROM authenticated;
