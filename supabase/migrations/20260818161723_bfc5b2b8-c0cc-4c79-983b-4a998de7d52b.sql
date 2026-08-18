CREATE OR REPLACE FUNCTION public.create_trade_offer(_proposer_id uuid, _recipient_id uuid, _event_id uuid, _give jsonb, _want jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _offer_id uuid;
BEGIN
  IF _proposer_id IS NULL OR _recipient_id IS NULL THEN
    RAISE EXCEPTION 'A trade needs two people';
  END IF;
  IF _proposer_id = _recipient_id THEN
    RAISE EXCEPTION 'You cannot trade with yourself';
  END IF;

  PERFORM 1 FROM public.participants WHERE id = _proposer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Participant not found'; END IF;

  -- The recipient has to be somebody who can actually answer. Two ways to be
  -- reachable, and an account is the better of the two because it follows the
  -- person between phones: a claimed paper code, OR a linked account identity.
  -- getClaimRoster's `reachable` flag applies exactly this test client-side.
  IF NOT (
    EXISTS (SELECT 1 FROM public.member_codes
             WHERE participant_id = _recipient_id AND claimed_at IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.account_identities
                WHERE participant_id = _recipient_id)
  ) THEN
    RAISE EXCEPTION 'That player has not claimed their card yet';
  END IF;

  IF jsonb_typeof(_give) <> 'array' OR jsonb_typeof(_want) <> 'array' THEN
    RAISE EXCEPTION 'A trade needs a list of cards on each side';
  END IF;
  IF jsonb_array_length(_give) < 1 OR jsonb_array_length(_give) > 4
     OR jsonb_array_length(_want) < 1 OR jsonb_array_length(_want) > 4 THEN
    RAISE EXCEPTION 'Each side of a trade is one to four cards';
  END IF;

  IF EXISTS (
    SELECT 1 FROM (
      SELECT jsonb_array_elements(_give) AS v
      UNION ALL
      SELECT jsonb_array_elements(_want)
    ) AS e
     WHERE NOT (
       (e.v->>'kind' = 'roster' AND e.v->>'cardCopyId' IS NOT NULL)
       OR (e.v->>'kind' = 'secret' AND e.v->>'secretPullId' IS NOT NULL))
  ) THEN
    RAISE EXCEPTION 'Every card in a trade must name a card copy or a secret copy';
  END IF;

  INSERT INTO public.trade_offers (event_id, proposer_id, recipient_id)
  VALUES (_event_id, _proposer_id, _recipient_id)
  RETURNING id INTO _offer_id;

  INSERT INTO public.trade_offer_items
    (offer_id, giver_side, kind, card_copy_id, secret_pull_id)
  SELECT _offer_id, s.side, e.v->>'kind',
         CASE WHEN e.v->>'kind' = 'roster' THEN (e.v->>'cardCopyId')::uuid END,
         CASE WHEN e.v->>'kind' = 'secret' THEN (e.v->>'secretPullId')::uuid END
    FROM (VALUES ('proposer', _give), ('recipient', _want)) AS s(side, items)
    CROSS JOIN LATERAL jsonb_array_elements(s.items) AS e(v);

  IF EXISTS (
    SELECT 1 FROM public.trade_offer_items i
     WHERE i.offer_id = _offer_id
       AND NOT public.trade_item_is_spare(
             CASE i.giver_side WHEN 'proposer' THEN _proposer_id ELSE _recipient_id END,
             i.kind, i.card_copy_id, i.secret_pull_id)
  ) THEN
    RAISE EXCEPTION 'Every card in a trade has to be a spare its owner still holds';
  END IF;

  IF NOT public.trade_leaves_a_copy(_offer_id) THEN
    RAISE EXCEPTION 'You have to keep a copy of every card you trade';
  END IF;

  RETURN jsonb_build_object('ok', true, 'offerId', _offer_id);
END;
$function$;