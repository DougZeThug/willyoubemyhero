-- Two counters in this app are computed by reading how many rows exist and
-- adding one, which is a read followed by a write with nothing in between:
--
--   saveCompletedRun      -> runs.attempt_number
--   recordDraftSelection  -> draft_selections.selection_order
--
-- Two consoles saving at the same moment read the same number and both write it.
-- Nothing in the schema stopped the second one, so a double-tap on Save quietly
-- produced two runs recorded as the same attempt, and two draft picks recorded
-- as the same selection — a leaderboard and a draft board that disagree with
-- themselves, with no error anywhere to say why.
--
-- These indexes are what makes the loser of that race fail instead of duplicate.
-- saveCompletedRun's idempotent path is unaffected: its upsert arbitrates on
-- client_key, and a retry re-sends the attempt number it was already given, so
-- the conflicting row it finds is itself.
--
-- draft_selections already carries UNIQUE(event_id, draft_position) and
-- UNIQUE(event_id, participant_id) from the original schema. selection_order —
-- the order the picks were actually made in, which is what undoLastDraftSelection
-- walks back — was the one left unguarded.
CREATE UNIQUE INDEX IF NOT EXISTS runs_event_participant_attempt_key
  ON public.runs (event_id, participant_id, attempt_number);

CREATE UNIQUE INDEX IF NOT EXISTS draft_selections_event_order_key
  ON public.draft_selections (event_id, selection_order);
