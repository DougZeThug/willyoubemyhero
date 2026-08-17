-- Participant photos are league content shown on the leaderboard, TV board and
-- every card. There is no per-user login in this app, so "owner-scoped" reads
-- have no meaning here; the only question is public vs server-only, and the
-- product answer is public. Writes stay server-only (service_role).
DROP POLICY IF EXISTS "Participant photos are publicly readable" ON storage.objects;
CREATE POLICY "Participant photos are publicly readable"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'participant-photos');

GRANT SELECT ON storage.objects TO anon, authenticated;