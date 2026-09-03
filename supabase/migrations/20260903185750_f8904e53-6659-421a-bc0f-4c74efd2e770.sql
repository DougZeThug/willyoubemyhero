-- Publish public.events so a commissioner's switches reach the other phones.
--
-- Dust and the nav rows live on the event row. Until now the only browser that
-- learned about a flip was the one that made it; every other phone kept its
-- cached event until a focus refetch, which in a garden is minutes. The client
-- listens id-filtered (src/lib/event-channel.ts), so a watcher is only woken for
-- the event it is already showing.
--
-- Safe to publish: `events` is already anon-readable through events_public, it
-- holds no secrets — no PIN, no code, no participant identity — and the payload
-- is only ever the row the whole room can already see on the leaderboard. The
-- tables that would leak (event_secrets, member_codes, card pulls, packs) stay
-- unpublished, and each of their migrations says why.
--
-- Guarded exactly like the collection_trophies add, so this migration replays
-- from empty.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
  END IF;
END $$;
