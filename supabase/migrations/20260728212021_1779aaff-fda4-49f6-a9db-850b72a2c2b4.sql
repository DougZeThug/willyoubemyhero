REVOKE ALL ON FUNCTION public.pull_secret_card(uuid, uuid) FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.secret_pull_status(uuid) FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.record_card_pulls(uuid, uuid[]) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.pull_secret_card(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.secret_pull_status(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_card_pulls(uuid, uuid[]) TO service_role;