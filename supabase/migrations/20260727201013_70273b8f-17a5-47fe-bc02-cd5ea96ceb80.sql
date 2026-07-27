
REVOKE ALL ON FUNCTION public.cast_award_vote(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.close_award_voting(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reopen_award_voting(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cast_award_vote(uuid, text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.close_award_voting(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.reopen_award_voting(uuid) TO service_role;
