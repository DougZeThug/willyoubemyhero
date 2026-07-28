ALTER TABLE public.event_participants
  ADD COLUMN IF NOT EXISTS photo_path_thumb text,
  ADD COLUMN IF NOT EXISTS photo_path_medium text,
  ADD COLUMN IF NOT EXISTS card_path_thumb text,
  ADD COLUMN IF NOT EXISTS card_path_medium text,
  ADD COLUMN IF NOT EXISTS card_back_path_thumb text,
  ADD COLUMN IF NOT EXISTS card_back_path_medium text;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS card_back_path_thumb text,
  ADD COLUMN IF NOT EXISTS card_back_path_medium text;

GRANT SELECT (photo_path_thumb, photo_path_medium, card_path_thumb, card_path_medium, card_back_path_thumb, card_back_path_medium) ON public.event_participants TO anon, authenticated;
GRANT SELECT (card_back_path_thumb, card_back_path_medium) ON public.events TO anon, authenticated;
GRANT ALL ON public.event_participants TO service_role;
GRANT ALL ON public.events TO service_role;