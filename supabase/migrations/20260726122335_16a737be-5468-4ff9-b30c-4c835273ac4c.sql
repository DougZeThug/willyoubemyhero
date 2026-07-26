ALTER TABLE public.event_participants ADD COLUMN IF NOT EXISTS card_path text;
GRANT SELECT (card_path) ON public.event_participants TO anon;