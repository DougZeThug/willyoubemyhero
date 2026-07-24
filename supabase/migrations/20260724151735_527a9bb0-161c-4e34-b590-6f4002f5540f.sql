
-- 1. Hide admin PIN columns from public reads
DROP POLICY IF EXISTS "events public read" ON public.events;
-- events_public view: run as owner so anon can read non-sensitive columns without a table policy
ALTER VIEW public.events_public SET (security_invoker = false);
REVOKE ALL ON public.events FROM anon, authenticated;
GRANT SELECT ON public.events_public TO anon, authenticated;
GRANT ALL ON public.events TO service_role;

-- 2. Remove public read on internal-only tables
DROP POLICY IF EXISTS "audit public read" ON public.audit_logs;
REVOKE ALL ON public.audit_logs FROM anon, authenticated;
GRANT ALL ON public.audit_logs TO service_role;

DROP POLICY IF EXISTS "randomizations public read" ON public.running_order_randomizations;
REVOKE ALL ON public.running_order_randomizations FROM anon, authenticated;
GRANT ALL ON public.running_order_randomizations TO service_role;

-- 3. Restrict sensitive columns on publicly-displayed tables (leaderboard-facing).
-- Anon/authenticated keep row-level read via existing policies, but no access to
-- private notes, internal actor labels, or idempotency keys.
REVOKE SELECT ON public.runs FROM anon, authenticated;
GRANT SELECT (
  id, event_id, participant_id, attempt_number, started_at, finished_at,
  raw_time_ms, paused_duration_ms, penalty_ms, official_time_ms, status,
  is_official, created_at, updated_at
) ON public.runs TO anon, authenticated;

REVOKE SELECT ON public.penalties FROM anon, authenticated;
GRANT SELECT (
  id, run_id, station_id, penalty_ms, reason, created_at
) ON public.penalties TO anon, authenticated;

REVOKE SELECT ON public.draft_selections FROM anon, authenticated;
GRANT SELECT (
  id, event_id, participant_id, selection_order, draft_position, selected_at
) ON public.draft_selections TO anon, authenticated;

-- 4. Storage: explicit deny-by-default policies for the private participant-photos bucket.
-- Only the service role (via server functions) may read/write these files.
DROP POLICY IF EXISTS "participant photos service read" ON storage.objects;
DROP POLICY IF EXISTS "participant photos service write" ON storage.objects;
DROP POLICY IF EXISTS "participant photos service update" ON storage.objects;
DROP POLICY IF EXISTS "participant photos service delete" ON storage.objects;

CREATE POLICY "participant photos service read"
  ON storage.objects FOR SELECT
  TO service_role
  USING (bucket_id = 'participant-photos');

CREATE POLICY "participant photos service write"
  ON storage.objects FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'participant-photos');

CREATE POLICY "participant photos service update"
  ON storage.objects FOR UPDATE
  TO service_role
  USING (bucket_id = 'participant-photos')
  WITH CHECK (bucket_id = 'participant-photos');

CREATE POLICY "participant photos service delete"
  ON storage.objects FOR DELETE
  TO service_role
  USING (bucket_id = 'participant-photos');
