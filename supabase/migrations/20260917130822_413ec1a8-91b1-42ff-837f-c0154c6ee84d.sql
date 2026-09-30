CREATE OR REPLACE FUNCTION public.update_run_result(
  _run_id      uuid,
  _event_id    uuid,
  _raw_time_ms int,
  _penalty_ms  int,
  _splits      jsonb,
  _penalties   jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _prev_raw     int;
  _prev_penalty int;
BEGIN
  SELECT raw_time_ms, penalty_ms
    INTO _prev_raw, _prev_penalty
    FROM public.runs
   WHERE id = _run_id AND event_id = _event_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That run is not part of this event.';
  END IF;

  UPDATE public.runs
     SET raw_time_ms = _raw_time_ms, penalty_ms = _penalty_ms
   WHERE id = _run_id;

  DELETE FROM public.splits WHERE run_id = _run_id;
  DELETE FROM public.penalties WHERE run_id = _run_id;

  INSERT INTO public.splits (
    run_id, station_id, cumulative_time_ms, segment_time_ms,
    recorded_at, entry_method, client_key, corrected
  )
  SELECT _run_id, s.station_id, s.cumulative_time_ms, s.segment_time_ms,
         s.recorded_at, 'admin_edit', s.client_key, true
    FROM jsonb_to_recordset(COALESCE(_splits, '[]'::jsonb)) AS s(
      station_id         uuid,
      cumulative_time_ms int,
      segment_time_ms    int,
      recorded_at        timestamptz,
      client_key         text
    );

  INSERT INTO public.penalties (run_id, station_id, penalty_ms, reason, created_by, client_key)
  SELECT _run_id, p.station_id, p.penalty_ms, p.reason, 'admin', p.client_key
    FROM jsonb_to_recordset(COALESCE(_penalties, '[]'::jsonb)) AS p(
      station_id uuid,
      penalty_ms int,
      reason     text,
      client_key text
    );

  INSERT INTO public.audit_logs (
    event_id, entity_type, entity_id, action, previous_value, new_value, performed_by
  )
  VALUES (
    _event_id, 'runs', _run_id, 'update_run_result',
    jsonb_build_object('raw_time_ms', _prev_raw, 'penalty_ms', _prev_penalty),
    jsonb_build_object('raw_time_ms', _raw_time_ms, 'penalty_ms', _penalty_ms),
    'admin'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_run_result(uuid, uuid, int, int, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_run_result(uuid, uuid, int, int, jsonb, jsonb)
  TO service_role;