ALTER TABLE public.event_participants
  ADD COLUMN IF NOT EXISTS on_clock_since timestamptz;

COMMENT ON COLUMN public.event_participants.on_clock_since IS
  'Set by setParticipantStatus when the status becomes "running", cleared on any other status. Spectator screens read it for an unofficial elapsed clock; the official time is always runs.raw_time_ms, which the timing console measures itself.';

GRANT SELECT (on_clock_since) ON public.event_participants TO anon, authenticated;