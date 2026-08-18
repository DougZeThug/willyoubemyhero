-- These four are SECURITY DEFINER and must never be reachable with the
-- publishable key, which ships to every browser. The revokes in the previous
-- migration did not stick (default privileges re-granted EXECUTE), so they are
-- reasserted here after the fact.
REVOKE ALL ON FUNCTION public.adopt_card_copies(uuid, uuid[], text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_card_copy(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_pack_open(uuid, uuid, int, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_guest_packs(uuid, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.adopt_card_copies(uuid, uuid[], text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_card_copy(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_pack_open(uuid, uuid, int, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_guest_packs(uuid, uuid) TO service_role;

-- The three-argument pack recorder is now shadowed by the four-argument one, and
-- leaving both makes `rpc('record_pack_open', ...)` ambiguous from PostgREST.
DROP FUNCTION IF EXISTS public.record_pack_open(uuid, uuid, int);