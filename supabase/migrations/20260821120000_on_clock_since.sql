-- When an athlete went on the clock.
--
-- Between "on the clock" and "finished" the database held no timestamp at all:
-- the runs row is not written until the run ends, and until then the only clock
-- is the admin phone's IndexedDB. So /live hard-coded its timer to zero and
-- counted up from whenever the browser happened to notice — which restarted at
-- zero on every reload and every new spectator.
ALTER TABLE public.event_participants
  ADD COLUMN IF NOT EXISTS on_clock_since timestamptz;

COMMENT ON COLUMN public.event_participants.on_clock_since IS
  'Set by setParticipantStatus when the status becomes "running", cleared on any other status. Spectator screens read it for an unofficial elapsed clock; the official time is always runs.raw_time_ms, which the timing console measures itself.';

-- The base migration grants SELECT at table level, which already covers future
-- columns. Naming it explicitly matches how the thumb/medium columns were added
-- and costs nothing if the broader grant is ever narrowed.
GRANT SELECT (on_clock_since) ON public.event_participants TO anon, authenticated;
