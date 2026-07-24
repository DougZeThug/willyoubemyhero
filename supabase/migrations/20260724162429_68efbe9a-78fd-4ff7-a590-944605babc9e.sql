
-- Phase 3: media + archive
ALTER TABLE public.event_participants ADD COLUMN IF NOT EXISTS photo_path text;

CREATE TABLE IF NOT EXISTS public.event_archive_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE,
  event_name text NOT NULL,
  event_year integer,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_archive_snapshots_event_idx ON public.event_archive_snapshots(event_id);

GRANT SELECT ON public.event_archive_snapshots TO anon, authenticated;
GRANT ALL ON public.event_archive_snapshots TO service_role;

ALTER TABLE public.event_archive_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "archive public read" ON public.event_archive_snapshots;
CREATE POLICY "archive public read" ON public.event_archive_snapshots FOR SELECT USING (true);
