REVOKE ALL ON FUNCTION public.record_pack_open(uuid, uuid, int) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_pack_open(uuid, uuid, int) TO service_role;