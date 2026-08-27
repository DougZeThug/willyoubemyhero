CREATE OR REPLACE FUNCTION public.secret_sell_value(_tier text)
RETURNS int
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT COALESCE((ARRAY[300, 120, 60, 30, 15])[public.secret_tier_rank(_tier)], 15);
$$;

REVOKE ALL ON FUNCTION public.secret_sell_value(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.secret_sell_value(text) TO service_role;