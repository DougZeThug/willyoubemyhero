CREATE TABLE IF NOT EXISTS public.card_prompt_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  master_prompt text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT card_prompt_templates_slug_len CHECK (char_length(slug) BETWEEN 1 AND 80),
  CONSTRAINT card_prompt_templates_prompt_len CHECK (char_length(master_prompt) BETWEEN 20 AND 12000)
);
ALTER TABLE public.card_prompt_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.card_prompt_templates FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.card_prompt_templates TO service_role;
CREATE OR REPLACE TRIGGER card_prompt_templates_updated BEFORE UPDATE ON public.card_prompt_templates
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

INSERT INTO public.card_prompt_templates (slug, name, master_prompt, sort_order) VALUES
('draft_combine_player', 'Draft Combine Player', 'Create a premium vertical Draft Combine player trading card. Build the composition around this specific athlete: invent subject-specific action, scenery, equipment, background jokes, and visual storytelling from the information supplied below rather than forcing every athlete into one shared layout. Preserve a polished collectible sports-card finish with confident typography and clear information hierarchy. Include 4–6 personalized, humorous stats or callouts inspired only by the supplied facts; playful invention is welcome, but do not invent official performance results. Make the athlete recognizable from the attached reference photograph.', 0),
('cornhole_player', 'Cornhole Player', 'Create a premium vertical cornhole player trading card starring this specific person. Design an original subject-led composition with individualized scenery, pose, bags, boards, props, jokes, and background details—never a rigid shared template. Use the supplied event data as creative fuel and show 4–6 personalized humorous stats or callouts, while never fabricating official results. Keep the finish unmistakably collectible, energetic, and print-ready, and make the player recognizable from the attached reference photograph.', 1),
('secret_pet', 'Secret Pet', 'Create a delightfully rare vertical Secret Pet collectible card. Let this particular pet''s personality determine the composition, scenery, pose, toys, treats, props, sight gags, and small background jokes rather than using a rigid shared layout. Give it premium secret-card drama and include 4–6 personalized humorous stats or callouts grounded in the supplied description. Make the subject recognizable from any attached reference photograph.', 2),
('legacy_pet', 'Legacy Pet', 'Create a warm, celebratory vertical Legacy Pet collectible card. Treat the specific animal with affection and dignity while allowing personality-driven scenery, meaningful props, gentle jokes, and a unique composition instead of a rigid shared layout. Include 4–6 personalized humorous or heartfelt stats/callouts based on the supplied memories. Use any attached photograph to preserve the pet''s recognizable appearance, and finish it like a treasured premium keepsake card.', 3),
('wag_secret_rare', 'WAG Secret Rare', 'Create a glamorous, funny vertical WAG Secret Rare collectible card for this specific subject. Build a bespoke composition around their personality and association, with individualized scenery, fashion, props, inside jokes, and background Easter eggs—not a rigid shared layout. Add 4–6 personalized humorous stats or callouts based on the supplied information. Aim for extravagant secret-rare polish and make the subject recognizable from any attached reference photograph.', 4),
('custom_secret', 'Custom Secret', 'Create a one-of-one vertical Custom Secret collectible card for this particular subject. Allow the supplied story to dictate a unique composition, scenery, pose, props, jokes, and Easter eggs rather than imposing a rigid shared layout. Include 4–6 personalized humorous stats or callouts grounded in the supplied details. Deliver premium collectible-card typography, hierarchy, and finish, using any attached reference photograph to keep the subject recognizable.', 5)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.card_prompt_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid REFERENCES public.card_prompt_templates(id) ON DELETE SET NULL,
  template_slug text NOT NULL,
  template_name_snapshot text NOT NULL,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  event_participant_id uuid REFERENCES public.event_participants(id) ON DELETE SET NULL,
  subject_name text NOT NULL,
  input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_prompt text NOT NULL,
  kind text NOT NULL,
  parent_prompt_id uuid REFERENCES public.card_prompt_runs(id) ON DELETE SET NULL,
  revision_instruction text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT card_prompt_runs_kind CHECK (kind IN ('initial', 'revision')),
  CONSTRAINT card_prompt_runs_subject_len CHECK (char_length(subject_name) BETWEEN 1 AND 120),
  CONSTRAINT card_prompt_runs_prompt_len CHECK (char_length(generated_prompt) BETWEEN 20 AND 20000)
);
CREATE INDEX IF NOT EXISTS card_prompt_runs_event_recent_idx ON public.card_prompt_runs (event_id, created_at DESC);
ALTER TABLE public.card_prompt_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.card_prompt_runs FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.card_prompt_runs TO service_role;