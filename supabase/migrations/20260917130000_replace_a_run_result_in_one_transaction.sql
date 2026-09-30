-- Correcting a result, in one transaction.
--
-- 20260901120000 said it plainly for the draft board — "one statement in the
-- database rather than three writes from here" — and 20260911140000 said it
-- again for the account bind. updateRunResult still had the shape both of those
-- were written to retire, on the one path that DELETES before it inserts.
--
-- Six requests to PostgREST, six implicit transactions: update the run, clear
-- its splits, clear its penalties, insert the new splits, insert the new
-- penalties, write the audit row. The deletes are not avoidable from there —
-- the client keys are derived from the run and the station, and client_key is
-- globally unique on both tables, so a re-insert has to follow a delete.
--
-- Which means a failure on either insert lands after two commits that cannot be
-- taken back. The run keeps its new raw_time_ms, and official_time_ms is
-- generated from it, so the leaderboard reads a plausible total — over a run
-- with no splits and no penalties at all. The audit row that would have
-- recorded what the time used to be never ran, because it ran last. Re-clicking
-- Save from the still-open sheet does repair it, so the loss needs the
-- commissioner to close the sheet instead; the draft is in memory only, and the
-- next refetch is the last chance to notice.
--
-- So it all happens here, or none of it does.
--
-- The rows arrive already derived. Sorting the splits, differencing the segment
-- times, deriving recorded_at from the start and minting the client keys are
-- the caller's arithmetic and stay there — this function's job is the
-- all-or-nothing, not the maths.
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
  -- Event-scoped, and under the row's own lock. An admin token is scoped to one
  -- event and says nothing about the run id sitting next to it in the request,
  -- so the pairing is checked here as well as by the caller — and checking it
  -- while holding the row is what stops a concurrent delete landing between the
  -- caller's read and these writes.
  SELECT raw_time_ms, penalty_ms
    INTO _prev_raw, _prev_penalty
    FROM public.runs
   WHERE id = _run_id AND event_id = _event_id
     FOR UPDATE;
  -- FOUND, not a NULL check on either value: raw_time_ms is nullable, so a run
  -- that has not been timed yet is indistinguishable from no run at all. (The
  -- neighbouring RPCs test their SELECT INTO target directly because the column
  -- they read is NOT NULL.)
  IF NOT FOUND THEN
    -- Same words the handler used to raise, because they are what the sheet
    -- shows.
    RAISE EXCEPTION 'That run is not part of this event.';
  END IF;

  -- official_time_ms is GENERATED ALWAYS from these two and is never written.
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

  -- previous_value off the locked row rather than off the caller's earlier
  -- read: by the time this runs, that read is the only thing that could still
  -- be stale, and an audit row is worth nothing if it names the wrong old time.
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
