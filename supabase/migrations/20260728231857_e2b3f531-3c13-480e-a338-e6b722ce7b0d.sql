REVOKE ALL ON FUNCTION public.grant_secret_card(uuid, uuid, uuid) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_secret_card(uuid, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.pull_secret_card(uuid, uuid) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.pull_secret_card(uuid, uuid) TO service_role;