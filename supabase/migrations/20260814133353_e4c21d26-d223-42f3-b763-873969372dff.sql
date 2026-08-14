-- Per-copy rarity for secret cards. The look (foil, prism edge) stays a property
-- of the CARD; the tier is a property of YOUR COPY, rolled on pull. Mirrors the
-- edition ladder on player cards but with its own vocabulary, so the two can
-- never be confused in a stringly typed place.
ALTER TABLE public.secret_card_pulls
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'common';

-- Rarest first, index IS the rank. Mirrors SECRET_TIER_ORDER in
-- src/lib/secret-rarity.ts; a test pins the two against each other.
CREATE OR REPLACE FUNCTION public.secret_tier_rank(_tier text)
RETURNS integer
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$
  SELECT COALESCE(
    array_position(ARRAY['mythic','legendary','epic','rare','common'], _tier),
    99);
$$;

-- Weights in basis points, summing to 10000: mythic 50, legendary 350, epic 800,
-- rare 1800, common 7000. The roll is authoritative server-side for the same
-- reason the pull itself is.
CREATE OR REPLACE FUNCTION public.roll_secret_tier()
RETURNS text
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE _d int := floor(random() * 10000)::int;
BEGIN
  IF _d <   50 THEN RETURN 'mythic'; END IF;
  IF _d <  400 THEN RETURN 'legendary'; END IF;
  IF _d < 1200 THEN RETURN 'epic'; END IF;
  IF _d < 3000 THEN RETURN 'rare'; END IF;
  RETURN 'common';
END;
$$;

CREATE OR REPLACE FUNCTION public.pull_secret_card(_participant_id uuid, _guest_id uuid, _event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/New_York'
AS $function$
DECLARE
  _day  date := current_date;
  _card uuid;
  _dupe boolean := false;
  _tier text;
  _row  public.secret_card_pulls;
BEGIN
  IF (_participant_id IS NULL) = (_guest_id IS NULL) THEN
    RAISE EXCEPTION 'Exactly one of participant or guest is required';
  END IF;

  IF _participant_id IS NOT NULL THEN
    PERFORM 1 FROM public.participants WHERE id = _participant_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Participant not found'; END IF;
  ELSE
    -- A guest has no row to lock, so the serialisation half comes from here.
    PERFORM pg_advisory_xact_lock(hashtextextended(_guest_id::text, 0));
  END IF;

  SELECT * INTO _row FROM public.secret_card_pulls
   WHERE pulled_on = _day AND NOT granted
     AND ((_participant_id IS NOT NULL AND participant_id = _participant_id)
       OR (_guest_id IS NOT NULL AND guest_id = _guest_id));
  IF FOUND THEN
    RETURN jsonb_build_object('pullId', _row.id, 'cardId', _row.secret_card_id,
      'day', _row.pulled_on, 'duplicate', _row.is_duplicate, 'tier', _row.tier,
      'fresh', false);
  END IF;

  SELECT c.id INTO _card FROM public.secret_cards c
   WHERE c.active AND c.art_path IS NOT NULL AND c.weight > 0
     AND NOT EXISTS (SELECT 1 FROM public.secret_card_pulls p
                      WHERE p.secret_card_id = c.id
                        AND NOT p.is_duplicate
                        AND ((_participant_id IS NOT NULL AND p.participant_id = _participant_id)
                          OR (_guest_id IS NOT NULL AND p.guest_id = _guest_id)))
   ORDER BY (-ln(random()) / c.weight) ASC
   LIMIT 1;

  IF _card IS NULL THEN
    SELECT c.id INTO _card FROM public.secret_cards c
     WHERE c.active AND c.art_path IS NOT NULL AND c.weight > 0
     ORDER BY (-ln(random()) / c.weight) ASC
     LIMIT 1;
    _dupe := _card IS NOT NULL;
  END IF;

  IF _card IS NULL THEN RETURN NULL; END IF;

  _tier := public.roll_secret_tier();

  IF _participant_id IS NOT NULL THEN
    INSERT INTO public.secret_card_pulls
      (participant_id, secret_card_id, pulled_on, event_id, is_duplicate, granted, tier)
    VALUES (_participant_id, _card, _day, _event_id, _dupe, false, _tier)
    ON CONFLICT (participant_id, pulled_on) WHERE NOT granted DO NOTHING
    RETURNING * INTO _row;
  ELSE
    INSERT INTO public.secret_card_pulls
      (guest_id, secret_card_id, pulled_on, event_id, is_duplicate, granted, tier)
    VALUES (_guest_id, _card, _day, _event_id, _dupe, false, _tier)
    ON CONFLICT (guest_id, pulled_on) WHERE guest_id IS NOT NULL AND NOT granted DO NOTHING
    RETURNING * INTO _row;
  END IF;

  IF _row.id IS NULL THEN
    SELECT * INTO _row FROM public.secret_card_pulls
     WHERE pulled_on = _day AND NOT granted
       AND ((_participant_id IS NOT NULL AND participant_id = _participant_id)
         OR (_guest_id IS NOT NULL AND guest_id = _guest_id));
    RETURN jsonb_build_object('pullId', _row.id, 'cardId', _row.secret_card_id,
      'day', _row.pulled_on, 'duplicate', _row.is_duplicate, 'tier', _row.tier,
      'fresh', false);
  END IF;

  -- Best wins, never down. A duplicate that rolled better upgrades the copy you
  -- already own, which is the row the vault reads from.
  IF _dupe THEN
    UPDATE public.secret_card_pulls o
       SET tier = _row.tier
     WHERE o.secret_card_id = _card
       AND NOT o.is_duplicate
       AND ((_participant_id IS NOT NULL AND o.participant_id = _participant_id)
         OR (_guest_id IS NOT NULL AND o.guest_id = _guest_id))
       AND public.secret_tier_rank(_row.tier) < public.secret_tier_rank(o.tier);
  END IF;

  RETURN jsonb_build_object('pullId', _row.id, 'cardId', _row.secret_card_id,
    'day', _row.pulled_on, 'duplicate', _row.is_duplicate, 'tier', _row.tier,
    'fresh', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.grant_secret_card(_participant_id uuid, _secret_card_id uuid, _event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/New_York'
AS $function$
DECLARE
  _day       date := current_date;
  _already   boolean;
  _tier      text;
  _row       public.secret_card_pulls;
BEGIN
  PERFORM 1 FROM public.participants WHERE id = _participant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Participant not found'; END IF;

  PERFORM 1 FROM public.secret_cards WHERE id = _secret_card_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Card not found'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.secret_card_pulls
     WHERE participant_id = _participant_id
       AND secret_card_id = _secret_card_id
       AND NOT is_duplicate
  ) INTO _already;

  _tier := public.roll_secret_tier();

  INSERT INTO public.secret_card_pulls
    (participant_id, secret_card_id, pulled_on, event_id, is_duplicate, granted, tier)
  VALUES (_participant_id, _secret_card_id, _day, _event_id, _already, true, _tier)
  RETURNING * INTO _row;

  IF _already THEN
    UPDATE public.secret_card_pulls o
       SET tier = _row.tier
     WHERE o.participant_id = _participant_id
       AND o.secret_card_id = _secret_card_id
       AND NOT o.is_duplicate
       AND public.secret_tier_rank(_row.tier) < public.secret_tier_rank(o.tier);
  END IF;

  RETURN jsonb_build_object(
    'pullId', _row.id,
    'cardId', _row.secret_card_id,
    'day', _row.pulled_on,
    'duplicate', _row.is_duplicate,
    'tier', _row.tier,
    'granted', true
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_guest_secrets(_participant_id uuid, _guest_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _n int;
BEGIN
  IF _participant_id IS NULL OR _guest_id IS NULL THEN RETURN 0; END IF;

  PERFORM 1 FROM public.participants WHERE id = _participant_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  DELETE FROM public.secret_card_pulls g
   WHERE g.guest_id = _guest_id
     AND EXISTS (SELECT 1 FROM public.secret_card_pulls m
                  WHERE m.participant_id = _participant_id
                    AND m.pulled_on = g.pulled_on
                    AND NOT m.granted);

  -- A guest copy that outranks the member copy hands its tier over before it is
  -- demoted to a duplicate: merging two identities must not lose the better roll.
  UPDATE public.secret_card_pulls m
     SET tier = g.tier
    FROM public.secret_card_pulls g
   WHERE g.guest_id = _guest_id
     AND NOT g.is_duplicate
     AND m.participant_id = _participant_id
     AND m.secret_card_id = g.secret_card_id
     AND NOT m.is_duplicate
     AND public.secret_tier_rank(g.tier) < public.secret_tier_rank(m.tier);

  UPDATE public.secret_card_pulls g
     SET is_duplicate = true
   WHERE g.guest_id = _guest_id
     AND NOT g.is_duplicate
     AND EXISTS (SELECT 1 FROM public.secret_card_pulls m
                  WHERE m.participant_id = _participant_id
                    AND m.secret_card_id = g.secret_card_id
                    AND NOT m.is_duplicate);

  UPDATE public.secret_card_pulls
     SET participant_id = _participant_id, guest_id = NULL
   WHERE guest_id = _guest_id;

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$function$;