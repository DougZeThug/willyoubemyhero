-- Grandfather the pre-server-roll fleet into the mill ladder.
--
-- `edition_asserted_by` arrived in 20260826120000_server_rolled_editions.sql with
-- a DEFAULT of 'client', so every copy minted before that date — the 17 August
-- backfill, every adopted collection, and each pull up to the 25th — was marked
-- untrusted. `mill_value` pays those the flat floor whatever finish they show, so
-- 322 of ~409 copies burned for 5 while the shop printed 100/40/20/10/5 beside
-- them. The finishes themselves are the real ones people pulled; only the
-- provenance flag is an artefact of when the column landed.
--
-- One-time and deliberately unconditional on date: everything that exists at this
-- point is grandfathered. The trust rule itself is untouched, so a finish a device
-- asserts after this still pays the floor. Idempotent — a replay updates nothing.
UPDATE public.card_copies
   SET edition_asserted_by = 'server'
 WHERE edition_asserted_by <> 'server';