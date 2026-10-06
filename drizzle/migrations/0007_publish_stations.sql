-- Publish public.stations so a station change reaches every phone as it lands.
--
-- getEventBundle reads stations, and the commissioner edits them mid-event:
-- rename, reorder, switch one off, turn splits on or off. The run console on the
-- timer's phone filters on active and split_enabled, so a station switched off on
-- the commissioner's phone stayed live on that one until the next backstop poll.
-- Its siblings in the bundle — runs, event_participants, draft_selections — were
-- all published and bound; stations was in neither, so it had no realtime path at
-- all (src/lib/event-channel.ts binds it now, unfiltered: a DELETE on this table carries
-- only the primary key, so an event_id filter would drop the delete of a station).
--
-- Safe to publish: stations is already anon-readable ("stations public read"), it
-- carries a name, an order and two switches, and nothing about who ran what. The
-- tables that would leak stay unpublished, and each of their migrations says why.
--
-- Guarded exactly like the events add, so this migration replays from empty.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'stations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.stations;
  END IF;
END $$;
