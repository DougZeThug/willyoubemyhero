
CREATE OR REPLACE FUNCTION public.cast_award_vote(
  _event_id uuid,
  _category text,
  _voter_participant_id uuid,
  _target_participant_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _locked boolean;
  _target_in_event boolean;
BEGIN
  -- Serialize with close_award_voting on the same event row.
  SELECT awards_locked INTO _locked
  FROM public.events WHERE id = _event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found';
  END IF;
  IF _locked THEN
    RAISE EXCEPTION 'Voting is closed';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.event_participants
    WHERE event_id = _event_id AND participant_id = _target_participant_id
  ) INTO _target_in_event;
  IF NOT _target_in_event THEN
    RAISE EXCEPTION 'Nominee is not in this event';
  END IF;

  INSERT INTO public.award_votes (
    event_id, category, voter_participant_id, target_participant_id
  ) VALUES (
    _event_id, _category, _voter_participant_id, _target_participant_id
  )
  ON CONFLICT (event_id, category, voter_participant_id)
  DO UPDATE SET target_participant_id = EXCLUDED.target_participant_id,
                updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.cast_award_vote(uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cast_award_vote(uuid, text, uuid, uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.close_award_voting(
  _event_id uuid,
  _categories jsonb -- [{"id":"mvp","label":"MVP"}, ...]
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _published integer := 0;
  _cat record;
  _top integer;
  _winner_count integer;
  _winner record;
BEGIN
  -- Lock the event row; any in-flight cast_award_vote either commits
  -- before this or waits until we finish and then sees awards_locked.
  PERFORM 1 FROM public.events WHERE id = _event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  -- Republish from scratch so re-closing after a correction is idempotent.
  DELETE FROM public.awards WHERE event_id = _event_id;

  FOR _cat IN
    SELECT (elem->>'id') AS id, (elem->>'label') AS label
    FROM jsonb_array_elements(_categories) AS elem
  LOOP
    SELECT MAX(cnt) INTO _top FROM (
      SELECT COUNT(*)::int AS cnt
      FROM public.award_votes
      WHERE event_id = _event_id AND category = _cat.id
      GROUP BY target_participant_id
    ) t;
    IF _top IS NULL OR _top <= 0 THEN CONTINUE; END IF;

    SELECT COUNT(*) INTO _winner_count FROM (
      SELECT target_participant_id
      FROM public.award_votes
      WHERE event_id = _event_id AND category = _cat.id
      GROUP BY target_participant_id
      HAVING COUNT(*) = _top
    ) w;

    FOR _winner IN
      SELECT target_participant_id AS pid
      FROM public.award_votes
      WHERE event_id = _event_id AND category = _cat.id
      GROUP BY target_participant_id
      HAVING COUNT(*) = _top
    LOOP
      INSERT INTO public.awards (
        event_id, participant_id, award_name, award_type, description
      ) VALUES (
        _event_id,
        _winner.pid,
        _cat.label,
        _cat.id,
        CASE
          WHEN _winner_count > 1 THEN
            'Tied with ' || (_winner_count - 1) ||
            CASE WHEN _winner_count > 2 THEN ' others — ' ELSE ' other — ' END ||
            _top || CASE WHEN _top = 1 THEN ' vote' ELSE ' votes' END
          ELSE
            _top || CASE WHEN _top = 1 THEN ' vote' ELSE ' votes' END
        END
      );
      _published := _published + 1;
    END LOOP;
  END LOOP;

  UPDATE public.events SET awards_locked = true, updated_at = now()
  WHERE id = _event_id;

  RETURN _published;
END;
$$;

REVOKE ALL ON FUNCTION public.close_award_voting(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_award_voting(uuid, jsonb) TO service_role;


CREATE OR REPLACE FUNCTION public.reopen_award_voting(_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM public.events WHERE id = _event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found';
  END IF;
  DELETE FROM public.awards WHERE event_id = _event_id;
  UPDATE public.events SET awards_locked = false, updated_at = now()
  WHERE id = _event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reopen_award_voting(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reopen_award_voting(uuid) TO service_role;
