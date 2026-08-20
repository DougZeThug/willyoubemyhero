ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS is_collector boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.participants.is_collector IS
  'Signed-in account with a card collection but not a combine athlete: tradeable, but excluded from roster, claim and draft surfaces.';

CREATE INDEX IF NOT EXISTS participants_is_collector_idx
  ON public.participants (is_collector) WHERE is_collector;