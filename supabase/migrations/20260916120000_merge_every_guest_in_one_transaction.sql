-- The collector handoff, across every guest the signup is folding.
--
-- 20260908172154 made one guest's move atomic and said why: three separate
-- claim_guest_* calls left rows committed onto a participant the catch block in
-- createCollector then retires, and because those functions null guest_id as
-- they go, the retry's WHERE guest_id = _guest_id could never find them again.
-- "Everything moves, or nothing does."
--
-- That rule was broken one level up. A signup folds the account's own guest id
-- AND the guest id the handset is holding — collector.functions.ts builds the
-- array from optionalGuest() and optionalAccountHandoff() — and mergeGuests
-- called the RPC once per id. Each call is its own request to PostgREST and its
-- own implicit transaction, so the first one commits and stands: when the second
-- raises, the account binding goes back to the prior guest and the fresh
-- participant is retired, while the rows the first move already carried sit on
-- that retired id with their guest_id nulled. Unreachable, and the collection
-- lost is the account's canonical one — every pull it made before this device.
--
-- So every guest moves in one transaction, or none of them does.
CREATE OR REPLACE FUNCTION public.merge_guests_into_collector(
  _participant_id uuid,
  _guest_ids      uuid[]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _g uuid;
BEGIN
  IF _participant_id IS NULL OR _guest_ids IS NULL THEN RETURN; END IF;

  -- Sorted, and not for tidiness: each iteration takes an advisory lock on its
  -- guest and holds it to the end of the transaction, so two signups folding an
  -- overlapping pair in opposite orders are a deadlock rather than a queue. One
  -- fixed order makes them queue. Same reason merge_guest_packs (20260827130418)
  -- orders its two ids before taking their locks.
  --
  -- The per-guest work stays in merge_guest_into_collector rather than being
  -- restated here, so the participant lock, the 'No such player' raise and the
  -- packs-before-the-claims-keyed-off-them ordering are defined in one place.
  -- That raise landing before any guest has moved is half of what makes this
  -- all-or-nothing; the shared transaction is the other half.
  FOR _g IN
    SELECT DISTINCT g FROM unnest(_guest_ids) AS g WHERE g IS NOT NULL ORDER BY g
  LOOP
    PERFORM public.merge_guest_into_collector(_participant_id, _g);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_guests_into_collector(uuid, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_guests_into_collector(uuid, uuid[]) TO service_role;
