
-- ============ EVENTS ============
CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  year int NOT NULL,
  event_date date,
  location text,
  status text NOT NULL DEFAULT 'setup', -- setup|live|paused|drafting|complete
  timing_mode text NOT NULL DEFAULT 'standard', -- standard|split
  splits_enabled boolean NOT NULL DEFAULT false,
  draft_size int NOT NULL DEFAULT 16,
  results_locked boolean NOT NULL DEFAULT false,
  draft_locked boolean NOT NULL DEFAULT false,
  running_order_locked boolean NOT NULL DEFAULT false,
  pin_salt text NOT NULL,
  pin_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.events TO anon, authenticated;
GRANT ALL ON public.events TO service_role;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "events public read" ON public.events FOR SELECT USING (true);

-- Hide pin_hash/pin_salt from anon via a view
CREATE OR REPLACE VIEW public.events_public AS
  SELECT id, name, year, event_date, location, status, timing_mode, splits_enabled,
         draft_size, results_locked, draft_locked, running_order_locked, active,
         created_at, updated_at
  FROM public.events;
GRANT SELECT ON public.events_public TO anon, authenticated;

-- ============ PARTICIPANTS ============
CREATE TABLE public.participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  nickname text,
  fantasy_team_name text,
  profile_image_url text,
  team_logo_url text,
  bio text,
  trash_talk_quote text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.participants TO anon, authenticated;
GRANT ALL ON public.participants TO service_role;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "participants public read" ON public.participants FOR SELECT USING (true);

-- ============ EVENT_PARTICIPANTS ============
CREATE TABLE public.event_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  bib_number int,
  running_order int NOT NULL DEFAULT 0,
  participation_status text NOT NULL DEFAULT 'waiting', -- waiting|up_next|on_deck|running|finished|delayed|absent|dq|dnp|rerun_pending
  draft_choice_priority int,
  selected_draft_position int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id, participant_id)
);
GRANT SELECT ON public.event_participants TO anon, authenticated;
GRANT ALL ON public.event_participants TO service_role;
ALTER TABLE public.event_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "event_participants public read" ON public.event_participants FOR SELECT USING (true);
CREATE INDEX event_participants_event_idx ON public.event_participants(event_id, running_order);

-- ============ STATIONS ============
CREATE TABLE public.stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name text NOT NULL,
  short_name text,
  description text,
  station_order int NOT NULL DEFAULT 0,
  icon text,
  station_type text NOT NULL DEFAULT 'skill',
  split_enabled boolean NOT NULL DEFAULT true,
  attempts_allowed int NOT NULL DEFAULT 0, -- 0 = unlimited
  success_required boolean NOT NULL DEFAULT true,
  penalty_rule text,
  penalty_amount_ms int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  tiebreaker_station boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.stations TO anon, authenticated;
GRANT ALL ON public.stations TO service_role;
ALTER TABLE public.stations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stations public read" ON public.stations FOR SELECT USING (true);
CREATE INDEX stations_event_idx ON public.stations(event_id, station_order);

-- ============ RUNS ============
CREATE TABLE public.runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  attempt_number int NOT NULL DEFAULT 1,
  started_at timestamptz,
  finished_at timestamptz,
  raw_time_ms int,
  paused_duration_ms int NOT NULL DEFAULT 0,
  penalty_ms int NOT NULL DEFAULT 0,
  official_time_ms int GENERATED ALWAYS AS (COALESCE(raw_time_ms, 0) + COALESCE(penalty_ms, 0)) STORED,
  status text NOT NULL DEFAULT 'scheduled', -- scheduled|active|completed|invalidated|rerun|dq|official
  notes text,
  is_official boolean NOT NULL DEFAULT false,
  client_key text UNIQUE, -- idempotency key from client
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.runs TO anon, authenticated;
GRANT ALL ON public.runs TO service_role;
ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "runs public read" ON public.runs FOR SELECT USING (true);
CREATE INDEX runs_event_idx ON public.runs(event_id, official_time_ms);
CREATE INDEX runs_participant_idx ON public.runs(event_id, participant_id);

-- ============ SPLITS ============
CREATE TABLE public.splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE CASCADE,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  cumulative_time_ms int NOT NULL,
  segment_time_ms int,
  entry_method text NOT NULL DEFAULT 'live_manual',
  recorded_by text,
  corrected boolean NOT NULL DEFAULT false,
  correction_reason text,
  client_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.splits TO anon, authenticated;
GRANT ALL ON public.splits TO service_role;
ALTER TABLE public.splits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "splits public read" ON public.splits FOR SELECT USING (true);
CREATE INDEX splits_run_idx ON public.splits(run_id);

-- ============ PENALTIES ============
CREATE TABLE public.penalties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  station_id uuid REFERENCES public.stations(id) ON DELETE SET NULL,
  penalty_ms int NOT NULL,
  reason text,
  notes text,
  created_by text,
  client_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.penalties TO anon, authenticated;
GRANT ALL ON public.penalties TO service_role;
ALTER TABLE public.penalties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "penalties public read" ON public.penalties FOR SELECT USING (true);

-- ============ DRAFT_SELECTIONS ============
CREATE TABLE public.draft_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  selection_order int NOT NULL,
  draft_position int NOT NULL,
  selected_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  UNIQUE(event_id, draft_position),
  UNIQUE(event_id, participant_id)
);
GRANT SELECT ON public.draft_selections TO anon, authenticated;
GRANT ALL ON public.draft_selections TO service_role;
ALTER TABLE public.draft_selections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "draft public read" ON public.draft_selections FOR SELECT USING (true);

-- ============ AWARDS ============
CREATE TABLE public.awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  participant_id uuid REFERENCES public.participants(id) ON DELETE SET NULL,
  award_name text NOT NULL,
  description text,
  award_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.awards TO anon, authenticated;
GRANT ALL ON public.awards TO service_role;
ALTER TABLE public.awards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "awards public read" ON public.awards FOR SELECT USING (true);

-- ============ RANDOMIZATIONS ============
CREATE TABLE public.running_order_randomizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  randomized_scope text,
  previous_order jsonb,
  resulting_order jsonb,
  randomization_seed text,
  randomized_by text,
  randomized_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.running_order_randomizations TO anon, authenticated;
GRANT ALL ON public.running_order_randomizations TO service_role;
ALTER TABLE public.running_order_randomizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "randomizations public read" ON public.running_order_randomizations FOR SELECT USING (true);

-- ============ AUDIT LOGS ============
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  entity_type text,
  entity_id uuid,
  action text NOT NULL,
  previous_value jsonb,
  new_value jsonb,
  performed_by text,
  performed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.audit_logs TO anon, authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit public read" ON public.audit_logs FOR SELECT USING (true);

-- ============ updated_at TRIGGERS ============
CREATE OR REPLACE FUNCTION public.tg_set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER events_updated BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER participants_updated BEFORE UPDATE ON public.participants FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER event_participants_updated BEFORE UPDATE ON public.event_participants FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER stations_updated BEFORE UPDATE ON public.stations FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER runs_updated BEFORE UPDATE ON public.runs FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER splits_updated BEFORE UPDATE ON public.splits FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ REALTIME ============
ALTER PUBLICATION supabase_realtime ADD TABLE public.runs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.splits;
ALTER PUBLICATION supabase_realtime ADD TABLE public.event_participants;
ALTER PUBLICATION supabase_realtime ADD TABLE public.draft_selections;
ALTER PUBLICATION supabase_realtime ADD TABLE public.penalties;
