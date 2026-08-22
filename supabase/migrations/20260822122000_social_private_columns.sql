-- Take guest_key out of anon's reach on the two social tables.
--
-- A guest_key is a client-minted, unsigned identity — 20260801130000 says so
-- outright, contrasting it with the server-minted guest token that replaced it
-- for anything that matters. Whoever can read one can present it: their
-- reactions and their trash talk become yours to delete.
--
-- getEventSocial has always stripped the column from its response and has a
-- comment saying the key never leaves the server. That was true of the handler
-- and not of the database: both tables carry a table-wide GRANT SELECT to anon
-- from 20260727130000, so the publishable key in every browser could read
-- guest_key straight from PostgREST and skip the handler entirely.
--
-- Narrowed the way 20260813185530 narrowed runs, and for the same reason: a
-- named column list is the only grant that stays correct when a column is added
-- later. Everything the public feed renders is still here — who reacted, what
-- they said, the display name a guest chose for themselves.
--
-- Realtime is unaffected: both tables are in supabase_realtime, and
-- use-event-social.ts subscribes only to invalidate a query, never reading the
-- payload. runs is the precedent — column-scoped and published, since 20260813.
REVOKE SELECT ON public.card_reactions FROM anon, authenticated;
GRANT SELECT (
  id, event_participant_id, participant_id, guest_name, emoji, created_at
) ON public.card_reactions TO anon, authenticated;

REVOKE SELECT ON public.card_comments FROM anon, authenticated;
GRANT SELECT (
  id, event_participant_id, participant_id, guest_name, body, created_at
) ON public.card_comments TO anon, authenticated;
