-- Phase 2: league-member identity, card reactions, trash talk, superlative voting.
--
-- There is no per-member login in this app; the only existing auth is a shared
-- admin PIN. These tables back a lightweight "claim your player" flow: the
-- commissioner hands each member a short code, they claim their name once, and
-- an HMAC token is stored on their device. Every write still goes through a
-- server function running as service_role — anon has no write grants anywhere.

-- ============ MEMBER CODES ============
-- Server-only. Codes are stored salted+hashed, exactly like the event PIN.
CREATE TABLE IF NOT EXISTS public.member_codes (
  participant_id uuid PRIMARY KEY REFERENCES public.participants(id) ON DELETE CASCADE,
  code_salt text NOT NULL,
  code_hash text NOT NULL,
  claimed_at timestamptz,
  last_claimed_at timestamptz,
  claim_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.member_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_codes FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.member_codes TO service_role;

CREATE TRIGGER member_codes_updated
  BEFORE UPDATE ON public.member_codes
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ CARD REACTIONS ============
-- Public read: seeing who reacted is the whole point.
CREATE TABLE IF NOT EXISTS public.card_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_participant_id uuid NOT NULL REFERENCES public.event_participants(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_participant_id, participant_id, emoji)
);
ALTER TABLE public.card_reactions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.card_reactions TO anon, authenticated;
GRANT ALL ON public.card_reactions TO service_role;
DROP POLICY IF EXISTS "card_reactions public read" ON public.card_reactions;
CREATE POLICY "card_reactions public read" ON public.card_reactions FOR SELECT USING (true);
CREATE INDEX IF NOT EXISTS card_reactions_card_idx ON public.card_reactions(event_participant_id);

-- ============ CARD COMMENTS (trash talk) ============
CREATE TABLE IF NOT EXISTS public.card_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_participant_id uuid NOT NULL REFERENCES public.event_participants(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT card_comments_body_len CHECK (char_length(body) BETWEEN 1 AND 280)
);
ALTER TABLE public.card_comments ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.card_comments TO anon, authenticated;
GRANT ALL ON public.card_comments TO service_role;
DROP POLICY IF EXISTS "card_comments public read" ON public.card_comments;
CREATE POLICY "card_comments public read" ON public.card_comments FOR SELECT USING (true);
CREATE INDEX IF NOT EXISTS card_comments_card_idx
  ON public.card_comments(event_participant_id, created_at);

-- ============ AWARD VOTES ============
-- Secret ballot: server-only, so nobody can read the running tally (or who voted
-- for whom) before the commissioner closes voting. The unique constraint is what
-- actually enforces one vote per member per category — not the UI.
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
ALTER TABLE public.award_votes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.award_votes FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.award_votes TO service_role;

CREATE TRIGGER award_votes_updated
  BEFORE UPDATE ON public.award_votes
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Voting stays open until the commissioner closes it, which is when winners are
-- written into the existing (until now unused) public.awards table.
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS awards_locked boolean NOT NULL DEFAULT false;

-- events is read through the events_public view, so the new column has to be
-- added to both the column grant and the view.
GRANT SELECT (awards_locked) ON public.events TO anon, authenticated;

DROP VIEW IF EXISTS public.events_public;
CREATE VIEW public.events_public
  WITH (security_invoker = true) AS
  SELECT id, name, year, event_date, location, status, timing_mode,
         splits_enabled, draft_size, results_locked, draft_locked,
         running_order_locked, awards_locked, active, created_at, updated_at
  FROM public.events;
GRANT SELECT ON public.events_public TO anon, authenticated;

-- Award winners are public once published.
CREATE INDEX IF NOT EXISTS awards_event_idx ON public.awards(event_id);

-- ============ REALTIME ============
-- Reactions and comments should land on other people's phones immediately.
ALTER PUBLICATION supabase_realtime ADD TABLE public.card_reactions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.card_comments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.awards;
