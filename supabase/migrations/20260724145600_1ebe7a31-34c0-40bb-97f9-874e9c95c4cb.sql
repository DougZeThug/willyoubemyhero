
REVOKE SELECT ON public.events FROM anon, authenticated;
DROP POLICY IF EXISTS "events public read" ON public.events;
DROP VIEW IF EXISTS public.events_public;
CREATE VIEW public.events_public
  WITH (security_invoker=true) AS
  SELECT id, name, year, event_date, location, status, timing_mode, splits_enabled,
         draft_size, results_locked, draft_locked, running_order_locked, active,
         created_at, updated_at
  FROM public.events;
-- View needs no policy of its own, but the underlying table must allow SELECT for the invoker.
-- Grant SELECT back on events but only on non-sensitive columns via column privileges.
GRANT SELECT (id, name, year, event_date, location, status, timing_mode, splits_enabled,
              draft_size, results_locked, draft_locked, running_order_locked, active,
              created_at, updated_at) ON public.events TO anon, authenticated;
CREATE POLICY "events public read" ON public.events FOR SELECT USING (true);
GRANT SELECT ON public.events_public TO anon, authenticated;
