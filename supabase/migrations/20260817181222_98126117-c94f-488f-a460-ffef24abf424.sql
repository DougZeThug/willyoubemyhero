REVOKE ALL ON FUNCTION public.roll_secret_tier() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.roll_secret_tier() TO service_role;

REVOKE ALL ON FUNCTION public.secret_tier_rank(text) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.secret_tier_rank(text) TO service_role;