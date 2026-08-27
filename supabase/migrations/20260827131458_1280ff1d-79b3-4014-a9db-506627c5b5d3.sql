CREATE OR REPLACE FUNCTION public.swap_station_order(_event_id uuid, _a uuid, _b uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _oa integer;
  _ob integer;
BEGIN
  -- Lock both rows in a deterministic order so two concurrent reorders
  -- cannot interleave and produce duplicate station_order values.
  SELECT station_order INTO _oa FROM public.stations
    WHERE id = LEAST(_a, _b) AND event_id = _event_id FOR UPDATE;
  SELECT station_order INTO _ob FROM public.stations
    WHERE id = GREATEST(_a, _b) AND event_id = _event_id FOR UPDATE;

  IF _oa IS NULL OR _ob IS NULL THEN
    RAISE EXCEPTION 'Both stations must belong to the event';
  END IF;

  UPDATE public.stations SET station_order = _ob, updated_at = now()
    WHERE id = LEAST(_a, _b) AND event_id = _event_id;
  UPDATE public.stations SET station_order = _oa, updated_at = now()
    WHERE id = GREATEST(_a, _b) AND event_id = _event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.swap_station_order(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.swap_station_order(uuid, uuid, uuid) TO service_role;