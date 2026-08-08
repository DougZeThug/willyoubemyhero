ALTER TABLE public.secret_cards ADD COLUMN IF NOT EXISTS collection text;
CREATE INDEX IF NOT EXISTS secret_cards_collection_idx ON public.secret_cards (collection);