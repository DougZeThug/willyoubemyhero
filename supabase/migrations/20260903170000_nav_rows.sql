-- The commissioner's switch for the bottom bar.
--
-- Shop has been the only conditional row since the dust switch landed, and the
-- argument src/lib/nav.ts makes for it — "a tab that is present but dead for most
-- of the year is the worse of the two" — is not specific to the shop. The combine
-- is a week a year, so Board and League are dead weight for the other fifty-one,
-- and a league that never trades carries a Trade tab on the strength of nothing.
--
-- ONE ARRAY, NOT SIX BOOLEANS. Six columns would mean six grants and a view
-- rebuild now, and another migration every time the bar grows a row. The ids are
-- a client-side vocabulary owned by src/lib/nav.ts, so a CHECK constraint is
-- deliberately absent too — it would make adding a nav row a schema change again.
-- setNavHidden validates against the known ids at the edge instead, and navTabs
-- ignores an id it does not recognise, so a hidden set written by a newer deploy
-- degrades to showing the row rather than to an error.
--
-- DEFAULT '{}' — the empty set, meaning nothing is hidden. That is what makes
-- deploying this a no-op: every existing row keeps the bar it already has. Note
-- this is the opposite direction to dust_enabled's DEFAULT false; there the safe
-- default was the feature off, here it is the bar unchanged.
--
-- vault and shop are storable but never honoured: the vault is pinned because it
-- is the wordmark's target and activeTab's fallback for every /players/* screen,
-- and the shop answers to dust_enabled alone so one row never has two switches.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS nav_hidden text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.events.nav_hidden IS
  'Bottom-nav rows the commissioner has switched off, as ids from NAV_ROW_IDS in src/lib/nav.ts (pack, trade, board, league). Empty means the whole bar. "vault" is pinned and "shop" answers to dust_enabled, so neither is honoured here. Unrecognised ids are ignored by the client.';

-- THE PIN, WHERE A CLIENT CANNOT ROUTE AROUND IT. setNavHidden refuses both ids
-- too, but a validator is a rule about one request and this is a rule about the
-- data. Only these two ids are constrained — the rest of the vocabulary stays
-- the client's, so adding a nav row is still not a schema change.
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_nav_hidden_hideable;
ALTER TABLE public.events ADD CONSTRAINT events_nav_hidden_hideable
  CHECK (NOT (nav_hidden && ARRAY['vault', 'shop']::text[]));

-- THREE PLACES, NOT ONE. `events` is read by the app through the events_public
-- VIEW, so a column added only to the table is invisible to getActiveEvent and
-- the bar could never hide a row. 20260828120000 restated the rule 20260727130000
-- wrote down, and it costs a feature every time it is missed.
--
-- Public on purpose, like dust_enabled: which rows the bar holds is not a secret
-- — every player can see their own bar — and the alternative is a second round
-- trip on a screen that already holds the event.
GRANT SELECT (nav_hidden) ON public.events TO anon, authenticated;

DROP VIEW IF EXISTS public.events_public;
-- security_invoker restored. Every rebuild before 20260828120000 carried it
-- (20260724151755 created it that way, 20260727195454 re-asserted it explicitly)
-- and the dust switch's rebuild dropped it, leaving the view running as its owner
-- and reading the table past the caller's own grants. Nothing leaks through it
-- today — the read policy on events is USING (true) and anon holds a table-wide
-- GRANT SELECT from 20260724151755 — but a view that ignores the grants beneath
-- it is one column away from mattering, and this is the rebuild that can put it
-- back.
CREATE VIEW public.events_public
  WITH (security_invoker = true) AS
  SELECT id, name, year, event_date, location, status, timing_mode, splits_enabled,
         draft_size, results_locked, draft_locked, running_order_locked, awards_locked,
         dust_enabled, nav_hidden,
         active, created_at, updated_at
  FROM public.events;
GRANT SELECT ON public.events_public TO anon, authenticated;
