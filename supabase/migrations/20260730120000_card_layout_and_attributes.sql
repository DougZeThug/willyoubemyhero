-- Dynamic stats on the card front.
--
-- Until now a card front was a single uploaded image, so every number printed on
-- it was frozen at upload. These three columns are what let the app draw live
-- numbers over that artwork instead:
--
--   events.card_layout              the event's slot layout, authored once in
--                                   the admin calibration editor
--   event_participants.card_layout  per-player override, for a card whose art
--                                   is composed differently from the rest
--   event_participants.card_attributes
--                                   admin override for the derived 0-99 ratings,
--                                   the same escape hatch card_rarity is for tiers
--
-- All three are nullable and all three are jsonb. Null everywhere means the app
-- behaves exactly as it did before this migration: no overlay, ratings derived.
-- The shapes are validated in TypeScript (src/lib/card-layout.ts) rather than by
-- a CHECK constraint, because the layout schema will grow and a constraint would
-- turn every addition into a migration that has to rewrite existing rows.

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS card_layout jsonb;
ALTER TABLE public.event_participants ADD COLUMN IF NOT EXISTS card_layout jsonb;
ALTER TABLE public.event_participants ADD COLUMN IF NOT EXISTS card_attributes jsonb;

COMMENT ON COLUMN public.events.card_layout IS
  'Default stat slot layout for every card in this event. Normalised 0..1 coordinates; see src/lib/card-layout.ts. Overridden per player by event_participants.card_layout.';
COMMENT ON COLUMN public.event_participants.card_layout IS
  'Per-player override of events.card_layout, for art composed differently from the rest of the set.';
COMMENT ON COLUMN public.event_participants.card_attributes IS
  'Admin override for derived card ratings; null = derived from combine results. Same role card_rarity plays for foil tier.';

-- Reads are column-granted rather than policy-driven on this table, so a new
-- public column is invisible until it is named here.
GRANT SELECT (card_layout, card_attributes) ON public.event_participants TO anon, authenticated;
GRANT SELECT (card_layout) ON public.events TO anon, authenticated;

-- events is read through the events_public view, so the new column has to be
-- added to the view as well or it never reaches the client. Same dance as
-- 20260727130000_member_identity_and_social.sql.
DROP VIEW IF EXISTS public.events_public;
CREATE VIEW public.events_public
  WITH (security_invoker = true) AS
  SELECT id, name, year, event_date, location, status, timing_mode,
         splits_enabled, draft_size, results_locked, draft_locked,
         running_order_locked, awards_locked, card_layout, active,
         created_at, updated_at
  FROM public.events;
GRANT SELECT ON public.events_public TO anon, authenticated;
