-- Typing in a result the clock missed, in one transaction.
--
-- createManualRun was six requests to PostgREST and six implicit transactions:
-- count the athlete's runs, insert the run, insert the splits, insert the
-- penalties, stamp the roster, write the audit row. A failure after the first
-- insert left a run on the ladder with no splits or no penalties, an athlete
-- still sitting in `waiting`, and — because the audit row ran last and its
-- error was never read — no record that anybody had typed it in. Retrying
-- minted a SECOND run, because the client key is random per call.
-- 20260917130000 did the same for the edit path; this is the create path.
--
-- The rows arrive already derived. Sorting the splits, differencing the segment
-- times and deriving recorded_at from the back-dated start are the caller's
-- arithmetic and stay there (as with update_run_result) — this function's job is
-- the all-or-nothing and the scoping, not the maths.
--
-- Scoping lives HERE as well as in the caller. An admin token is good for one
-- event and says nothing about the ids sitting next to it in the request, so
-- the athlete has to be on this event's roster and every station named has to
-- belong to this event before anything is written. A foreign station used to be
-- accepted silently: stations.id is all the FK asks for.
CREATE OR REPLACE FUNCTION public.create_manual_run(
  _event_id       uuid,
  _participant_id uuid,
  _raw_time_ms    int,
  _penalty_ms     int,
  _started_at     timestamptz,
  _finished_at    timestamptz,
  _splits         jsonb,
  _penalties      jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _run_id  uuid;
  _attempt int;
  _foreign int;
BEGIN
  -- The roster row doubles as the lock: two typed-in results for one athlete
  -- serialise here, so the attempt number below cannot be handed out twice.
  PERFORM 1 FROM public.event_participants
   WHERE event_id = _event_id AND participant_id = _participant_id
     FOR UPDATE;
  IF NOT FOUND THEN
    -- Same words the handler's roster check raises.
    RAISE EXCEPTION 'Player is not in this event';
  END IF;

  -- Every station named, in either list, must be this event's. A NULL penalty
  -- station is a penalty with no station and is fine.
  SELECT count(*) INTO _foreign FROM (
    SELECT s.station_id
      FROM jsonb_to_recordset(COALESCE(_splits, '[]'::jsonb)) AS s(station_id uuid)
    UNION
    SELECT p.station_id
      FROM jsonb_to_recordset(COALESCE(_penalties, '[]'::jsonb)) AS p(station_id uuid)
  ) AS named
  WHERE named.station_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.stations st
       WHERE st.id = named.station_id AND st.event_id = _event_id
    );
  IF _foreign > 0 THEN
    -- Same words as notInEventMessage("station") in the handler.
    RAISE EXCEPTION 'That station is not part of this event.';
  END IF;

  SELECT count(*)::int + 1 INTO _attempt FROM public.runs
   WHERE event_id = _event_id AND participant_id = _participant_id;

  INSERT INTO public.runs (
    event_id, participant_id, attempt_number, started_at, finished_at,
    raw_time_ms, paused_duration_ms, penalty_ms, status, is_official, client_key
  )
  VALUES (
    _event_id, _participant_id, _attempt, _started_at, _finished_at,
    _raw_time_ms, 0, _penalty_ms, 'official', true,
    'manual:' || gen_random_uuid()::text
  )
  RETURNING id INTO _run_id;

  -- Keys derived from the run, as the handler always derived them, so the
  -- stored values read the same as the ones already in the books.
  INSERT INTO public.splits (
    run_id, station_id, cumulative_time_ms, segment_time_ms,
    recorded_at, entry_method, client_key
  )
  SELECT _run_id, s.station_id, s.cumulative_time_ms, s.segment_time_ms,
         s.recorded_at, 'admin_manual', 'manual:' || _run_id::text || ':' || s.station_id::text
    FROM jsonb_to_recordset(COALESCE(_splits, '[]'::jsonb)) AS s(
      station_id         uuid,
      cumulative_time_ms int,
      segment_time_ms    int,
      recorded_at        timestamptz
    );

  -- WITH ORDINALITY cannot sit on jsonb_to_recordset, so the elements are
  -- numbered first and unpacked after. The index is the position the penalty
  -- arrived in, zero-based, as the handler always keyed them.
  INSERT INTO public.penalties (run_id, station_id, penalty_ms, reason, created_by, client_key)
  SELECT _run_id, p.station_id, p.penalty_ms, p.reason, 'admin',
         'manual:' || _run_id::text || ':' || (e.ord - 1)::text
    FROM jsonb_array_elements(COALESCE(_penalties, '[]'::jsonb)) WITH ORDINALITY AS e(elem, ord),
         LATERAL jsonb_to_record(e.elem) AS p(station_id uuid, penalty_ms int, reason text);

  UPDATE public.event_participants
     SET participation_status = 'finished', on_clock_since = NULL
   WHERE event_id = _event_id AND participant_id = _participant_id;

  INSERT INTO public.audit_logs (
    event_id, entity_type, entity_id, action, new_value, performed_by
  )
  VALUES (
    _event_id, 'runs', _run_id, 'manual_run_entry',
    jsonb_build_object('raw_time_ms', _raw_time_ms, 'penalty_ms', _penalty_ms),
    'admin'
  );

  RETURN _run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_manual_run(uuid, uuid, int, int, timestamptz, timestamptz, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_manual_run(uuid, uuid, int, int, timestamptz, timestamptz, jsonb, jsonb)
  TO service_role;
