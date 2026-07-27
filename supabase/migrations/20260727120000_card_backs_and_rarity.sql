-- Player trading cards: back artwork + optional rarity override.
ALTER TABLE public.event_participants ADD COLUMN IF NOT EXISTS card_back_path text;
ALTER TABLE public.event_participants ADD COLUMN IF NOT EXISTS card_rarity text;

COMMENT ON COLUMN public.event_participants.card_path IS 'Front card art (storage path in participant-photos)';
COMMENT ON COLUMN public.event_participants.card_back_path IS 'Back card art (storage path in participant-photos)';
COMMENT ON COLUMN public.event_participants.card_rarity IS 'Admin override for card foil tier; null = derived from combine results';

GRANT SELECT (card_back_path, card_rarity) ON public.event_participants TO anon, authenticated;
