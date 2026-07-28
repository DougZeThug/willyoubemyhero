-- Member identity and social tables.
--
-- These four tables are also created by 20260727130000_member_identity_and_social.sql,
-- which runs first. Both were applied once against the live database, so it is
-- correct — but replaying the directory from empty (`supabase db reset`, or the
-- integration suite in tests/db) hit "relation member_codes already exists" and
-- stopped here.
--
-- Every statement below is therefore guarded. Against a database that already
-- has these objects this file is a no-op, which is exactly what it was in
-- practice; against an empty one it now applies cleanly whichever of the two
-- migrations gets there first.

-- member_codes
CREATE TABLE IF NOT EXISTS public.member_codes (
  participant_id uuid PRIMARY KEY REFERENCES public.participants(id) ON DELETE CASCADE,
  code_salt text NOT NULL,
  code_hash text NOT NULL,
  claimed_at timestamptz,
  last_claimed_at timestamptz,
  claim_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.member_codes TO service_role;
ALTER TABLE public.member_codes ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE TRIGGER member_codes_set_updated_at BEFORE UPDATE ON public.member_codes
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- card_reactions
CREATE TABLE IF NOT EXISTS public.card_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_participant_id uuid NOT NULL REFERENCES public.event_participants(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_participant_id, participant_id, emoji)
);
GRANT SELECT ON public.card_reactions TO anon, authenticated;
GRANT ALL ON public.card_reactions TO service_role;
ALTER TABLE public.card_reactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "card_reactions public read" ON public.card_reactions;
CREATE POLICY "card_reactions public read" ON public.card_reactions FOR SELECT USING (true);

-- card_comments
CREATE TABLE IF NOT EXISTS public.card_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_participant_id uuid NOT NULL REFERENCES public.event_participants(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.card_comments TO anon, authenticated;
GRANT ALL ON public.card_comments TO service_role;
ALTER TABLE public.card_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "card_comments public read" ON public.card_comments;
CREATE POLICY "card_comments public read" ON public.card_comments FOR SELECT USING (true);

-- award_votes
CREATE TABLE IF NOT EXISTS public.award_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  category text NOT NULL,
  voter_participant_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  target_participant_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, category, voter_participant_id)
);
GRANT ALL ON public.award_votes TO service_role;
ALTER TABLE public.award_votes ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE TRIGGER award_votes_set_updated_at BEFORE UPDATE ON public.award_votes
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- new columns
ALTER TABLE public.event_participants ADD COLUMN IF NOT EXISTS card_back_path text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS awards_locked boolean NOT NULL DEFAULT false;
