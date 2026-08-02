-- Border ring animation for secret cards, admin-picked per card.
--
-- Like `foil`, deliberately no CHECK: the vocabulary lives in
-- src/lib/secret-cards.ts, and an unknown value falls back in TS (secretFoil)
-- the way an unrecognised card_rarity falls back to base. The server function
-- validator is the enforcement layer, same as every other write in this app.
ALTER TABLE public.secret_cards
  ADD COLUMN IF NOT EXISTS border_fx text NOT NULL DEFAULT 'spin';

COMMENT ON COLUMN public.secret_cards.border_fx IS
  'Border ring animation id. No CHECK on purpose — unknown values fall back in TS (secretFoil), mirroring foil.';
