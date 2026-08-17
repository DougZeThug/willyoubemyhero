-- Close two functions that were left executable by the publishable key.
--
-- 20260814133353 added `roll_secret_tier()` and `secret_tier_rank(text)` for the
-- per-copy secret tier and never revoked them, so both kept Postgres's default
-- EXECUTE TO PUBLIC. `tests/db/secret-cards.test.ts` — "grants anon EXECUTE on
-- none of the functions this app wrote" — has been red ever since, and the unit
-- and db steps in CI are advisory today, so it reported itself and nothing
-- stopped.
--
-- Neither function reads a table, so nothing leaked: the worst anyone could do
-- with the publishable key is ask Postgres to roll a random tier string and throw
-- it away. That is deliberately not an exemption. The rule this schema holds
-- itself to is blanket rather than case-by-case, precisely so that "is this
-- particular function harmless" never has to be argued again — which is the same
-- reasoning 20260813120000 wrote down when it revoked `card_edition_rank()`, the
-- identical kind of pure ladder function, on the way past.
--
-- Safe for their real callers: both are called from inside `pull_secret_card`,
-- `grant_secret_card` and `claim_guest_secrets`, which are SECURITY DEFINER and
-- therefore run as the owner. Nothing in src/ calls either over PostgREST.

REVOKE ALL ON FUNCTION public.roll_secret_tier() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.roll_secret_tier() TO service_role;

REVOKE ALL ON FUNCTION public.secret_tier_rank(text) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.secret_tier_rank(text) TO service_role;
