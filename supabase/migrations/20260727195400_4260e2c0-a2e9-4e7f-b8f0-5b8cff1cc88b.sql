-- member_codes
CREATE TABLE public.member_codes (
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
CREATE TRIGGER member_codes_set_updated_at BEFORE UPDATE ON public.member_codes
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- card_reactions
CREATE TABLE public.card_reactions (
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
CREATE POLICY "card_reactions public read" ON public.card_reactions FOR SELECT USING (true);

-- card_comments
CREATE TABLE public.card_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_participant_id uuid NOT NULL REFERENCES public.event_participants(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.card_comments TO anon, authenticated;
GRANT ALL ON public.card_comments TO service_role;
ALTER TABLE public.card_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "card_comments public read" ON public.card_comments FOR SELECT USING (true);

-- award_votes
CREATE TABLE public.award_votes (
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
CREATE TRIGGER award_votes_set_updated_at BEFORE UPDATE ON public.award_votes
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- new columns
ALTER TABLE public.event_participants ADD COLUMN IF NOT EXISTS card_back_path text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS awards_locked boolean NOT NULL DEFAULT false;