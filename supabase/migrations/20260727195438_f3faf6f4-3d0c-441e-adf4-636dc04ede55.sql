DROP VIEW IF EXISTS public.events_public;
CREATE VIEW public.events_public AS
SELECT id, name, year, event_date, location, status, timing_mode, splits_enabled,
       draft_size, results_locked, draft_locked, running_order_locked, awards_locked,
       active, created_at, updated_at
FROM public.events;
GRANT SELECT ON public.events_public TO anon, authenticated;

CREATE POLICY "member_codes no direct access" ON public.member_codes FOR SELECT USING (false);
CREATE POLICY "award_votes no direct access" ON public.award_votes FOR SELECT USING (false);