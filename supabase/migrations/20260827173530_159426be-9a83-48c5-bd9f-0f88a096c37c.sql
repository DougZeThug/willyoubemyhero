-- Recording and undoing a draft pick, as one statement each.
--
-- Both used to be two client-driven writes with nothing tying them together.
-- A pick inserted its selection and then stamped the roster; when that second
-- write failed the square went on reading "Open" while the UNIQUE(event_id,
-- draft_position) below refused that square forever. And selection_order was
-- computed as count + 1 with no constraint, so two near-simultaneous picks
-- shared a number and undo took an arbitrary one of them.

-- Renumber any duplicates the old count+1 already produced, oldest pick first,
-- so the unique index below can be created on existing data.
WITH renumbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY selected_at, id) AS n
  FROM public.draft_selections
)
UPDATE public.draft_selections d
SET selection_order = r.n
FROM renumbered r
WHERE d.id = r.id AND d.selection_order <> r.n;

CREATE UNIQUE INDEX IF NOT EXISTS draft_selections_event_order_key
  ON public.draft_selections (event_id, selection_order);

/**
 * Take one pick: number it, record it, and stamp the roster, or none of it.
 *
 * Serialised on the event row, so two commissioners tapping at once get
 * consecutive selection_order values rather than the same one twice.
 */
CREATE OR REPLACE FUNCTION public.record_draft_selection(
  _event_id uuid,
  _participant_id uuid,
  _draft_position int
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _order int;
BEGIN
  PERFORM 1 FROM public.events WHERE id = _event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such event';
  END IF;

  SELECT COALESCE(MAX(selection_order), 0) + 1 INTO _order
  FROM public.draft_selections WHERE event_id = _event_id;

  INSERT INTO public.draft_selections (event_id, participant_id, selection_order, draft_position)
  VALUES (_event_id, _participant_id, _order, _draft_position);

  -- Inside the same transaction as the insert: a failure here used to leave the
  -- square reading Open with the position already spoken for.
  UPDATE public.event_participants
  SET selected_draft_position = _draft_position
  WHERE event_id = _event_id AND participant_id = _participant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That athlete is not on this roster';
  END IF;

  RETURN _order;
END;
$$;

/**
 * Give back the last pick, or say there was nothing to give back.
 *
 * Returns the participant id that was undone, NULL when the board was already
 * empty — which the handler used to report as a successful undo, so the screen
 * said "Undid last pick" over a draft nobody had started.
 */
CREATE OR REPLACE FUNCTION public.undo_last_draft_selection(_event_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
  _participant uuid;
BEGIN
  PERFORM 1 FROM public.events WHERE id = _event_id FOR UPDATE;

  SELECT id, participant_id INTO _id, _participant
  FROM public.draft_selections
  WHERE event_id = _event_id
  ORDER BY selection_order DESC
  LIMIT 1;

  IF _id IS NULL THEN
    RETURN NULL;
  END IF;

  DELETE FROM public.draft_selections WHERE id = _id;

  UPDATE public.event_participants
  SET selected_draft_position = NULL
  WHERE event_id = _event_id AND participant_id = _participant;

  RETURN _participant;
END;
$$;

REVOKE ALL ON FUNCTION public.record_draft_selection(uuid, uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_draft_selection(uuid, uuid, int) TO service_role;
REVOKE ALL ON FUNCTION public.undo_last_draft_selection(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.undo_last_draft_selection(uuid) TO service_role;