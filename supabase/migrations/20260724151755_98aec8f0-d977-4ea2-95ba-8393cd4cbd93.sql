
-- Recreate events_public as a normal (invoker) view; drop the SECURITY DEFINER form
DROP VIEW IF EXISTS public.events_public;

-- Move pin_hash / pin_salt into a separate secrets table
CREATE TABLE public.event_secrets (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  pin_salt text NOT NULL,
  pin_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.event_secrets (event_id, pin_salt, pin_hash)
SELECT id, pin_salt, pin_hash FROM public.events;

GRANT ALL ON public.event_secrets TO service_role;
-- No grants to anon/authenticated: secrets are server-only.

ALTER TABLE public.event_secrets ENABLE ROW LEVEL SECURITY;
-- No policies for anon/authenticated. Service role bypasses RLS.

CREATE TRIGGER event_secrets_updated
  BEFORE UPDATE ON public.event_secrets
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Drop pin columns from the public events table
ALTER TABLE public.events DROP COLUMN pin_hash;
ALTER TABLE public.events DROP COLUMN pin_salt;

-- Restore anon/authenticated read on events (no longer contains secrets)
GRANT SELECT ON public.events TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO service_role;

CREATE POLICY "events public read"
  ON public.events FOR SELECT
  USING (true);

-- Recreate the events_public view as a plain security_invoker view
CREATE VIEW public.events_public
  WITH (security_invoker = true) AS
  SELECT id, name, year, event_date, location, status, timing_mode,
         splits_enabled, draft_size, results_locked, draft_locked,
         running_order_locked, active, created_at, updated_at
  FROM public.events;

GRANT SELECT ON public.events_public TO anon, authenticated;
