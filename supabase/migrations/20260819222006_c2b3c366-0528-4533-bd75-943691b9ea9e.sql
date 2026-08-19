CREATE TABLE IF NOT EXISTS public.secret_collections (
  id text PRIMARY KEY,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- No anon/authenticated grants on purpose: every read and write goes through a
-- service_role server function guarded by requireLeagueAdmin(), the same as the
-- rest of the secret card tables.
GRANT ALL ON public.secret_collections TO service_role;

ALTER TABLE public.secret_collections ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE TRIGGER secret_collections_set_updated_at
  BEFORE UPDATE ON public.secret_collections
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Seed the ids that already live in secret_cards.collection so existing filing
-- keeps its label and order.
INSERT INTO public.secret_collections (id, label, sort_order) VALUES
  ('cornhole', 'Cornhole Collection', 10),
  ('wags', 'WAGs', 20),
  ('pets', 'Pets', 30),
  ('legacyPets', 'Legacy Pets', 40)
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS secret_collections_sort_idx ON public.secret_collections (sort_order);