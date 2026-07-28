-- Guest identity for reactions & comments. Exactly one of participant_id or
-- guest_key must be set per row; the CHECK constraint is what enforces that.
ALTER TABLE public.card_reactions
  ALTER COLUMN participant_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS guest_key text,
  ADD COLUMN IF NOT EXISTS guest_name text;

ALTER TABLE public.card_comments
  ALTER COLUMN participant_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS guest_key text,
  ADD COLUMN IF NOT EXISTS guest_name text;

DO $$ BEGIN
  ALTER TABLE public.card_reactions
    ADD CONSTRAINT card_reactions_identity_ck
    CHECK ((participant_id IS NOT NULL) <> (guest_key IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.card_comments
    ADD CONSTRAINT card_comments_identity_ck
    CHECK ((participant_id IS NOT NULL) <> (guest_key IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One reaction of a given emoji per guest device per card. The existing UNIQUE
-- on (event_participant_id, participant_id, emoji) already handles members —
-- nulls don't collide there, so nothing needs to change on that side.
CREATE UNIQUE INDEX IF NOT EXISTS card_reactions_guest_uniq
  ON public.card_reactions (event_participant_id, guest_key, emoji)
  WHERE guest_key IS NOT NULL;
