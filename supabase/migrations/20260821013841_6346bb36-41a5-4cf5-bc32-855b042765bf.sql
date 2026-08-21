CREATE OR REPLACE FUNCTION public.merge_guest_packs(
  _into_guest uuid,
  _from_guest uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _n integer;
BEGIN
  IF _into_guest IS NULL OR _from_guest IS NULL OR _into_guest = _from_guest THEN
    RETURN 0;
  END IF;

  DELETE FROM public.pack_opens source
   WHERE source.guest_id = _from_guest
     AND EXISTS (
       SELECT 1
         FROM public.pack_opens destination
        WHERE destination.guest_id = _into_guest
          AND destination.opened_on = source.opened_on
     );

  UPDATE public.pack_opens
     SET guest_id = _into_guest
   WHERE guest_id = _from_guest;

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_guest_packs(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_guest_packs(uuid, uuid) TO service_role;