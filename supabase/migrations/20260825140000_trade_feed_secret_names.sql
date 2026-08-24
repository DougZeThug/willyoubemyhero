-- Name the secret cards in the public trade feed.
--
-- The redaction this undoes was deliberate: trades.proposer_gave / recipient_gave
-- land in an anon-readable, realtime-published table, so a secret item used to
-- collapse to {"kind":"secret"}. The league now wants to read WHICH secret moved,
-- and accepted the trade-off: the NAME of a card that was actually traded becomes
-- public. Art, flavour, foil and the rest of the catalogue stay server-only, and
-- an untraded card is still invisible — this leaks nothing about what exists,
-- only about what changed hands.

CREATE OR REPLACE FUNCTION public.accept_trade_offer(
  _offer_id     uuid,
  _recipient_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _offer          public.trade_offers;
  _lo             uuid;
  _hi             uuid;
  _item           record;
  _card           uuid;
  _dupe           boolean;
  _trade_id       uuid;
  _proposer_gave  jsonb;
  _recipient_gave jsonb;
  _rec            record;
  _trophy         jsonb;
  _trophies       jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO _offer FROM public.trade_offers WHERE id = _offer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Offer not found'; END IF;

  -- Raised rather than returned: the caller id comes from a verified member
  -- token, so this is somebody hand-posting another person's offer id and there
  -- is no friendly outcome to render.
  IF _offer.recipient_id <> _recipient_id THEN RAISE EXCEPTION 'Not your offer'; END IF;

  -- Returned rather than raised: a double-tap, or a phone acting on an inbox it
  -- rendered a minute ago, should get a toast rather than a stack trace.
  IF _offer.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'resolved');
  END IF;

  -- DETERMINISTIC LOCK ORDER, and the reason is the mirror-image case: Alice
  -- accepting Bob's offer at the same instant Bob accepts Alice's. Locking
  -- "proposer then recipient" would have the two transactions take the same two
  -- rows in opposite orders, which is a deadlock. Sorted, they queue instead.
  --
  -- These are also the rows pull_secret_card locks, so a trade and a daily pull
  -- touching the same person serialise against each other for free.
  _lo := least(_offer.proposer_id, _offer.recipient_id);
  _hi := greatest(_offer.proposer_id, _offer.recipient_id);
  PERFORM 1 FROM public.participants WHERE id = _lo FOR UPDATE;
  PERFORM 1 FROM public.participants WHERE id = _hi FOR UPDATE;

  -- Lock every staked row before re-reading it, so the re-validation below and
  -- the transfers after it see the same world.
  PERFORM 1
     FROM public.card_copies cc
     JOIN public.trade_offer_items i
       ON i.kind = 'roster' AND i.card_copy_id = cc.id
    WHERE i.offer_id = _offer_id
      FOR UPDATE OF cc;

  PERFORM 1
     FROM public.secret_card_pulls sp
     JOIN public.trade_offer_items i
       ON i.kind = 'secret' AND i.secret_pull_id = sp.id
    WHERE i.offer_id = _offer_id
      FOR UPDATE OF sp;

  -- RE-VALIDATE, then RETURN rather than RAISE. A raise would roll the
  -- transaction back, and the void written just above it with it — leaving the
  -- offer pending and the same failure waiting to happen on every retry.
  IF EXISTS (
    SELECT 1 FROM public.trade_offer_items i
     WHERE i.offer_id = _offer_id
       AND NOT public.trade_item_is_spare(
             CASE i.giver_side WHEN 'proposer' THEN _offer.proposer_id ELSE _offer.recipient_id END,
             i.kind, i.card_copy_id, i.secret_pull_id)
  ) OR NOT public.trade_leaves_a_copy(_offer_id)
    OR NOT public.trade_has_both_sides(_offer_id) THEN
    UPDATE public.trade_offers
       SET status = 'voided', resolved_at = now()
     WHERE id = _offer_id;
    RETURN jsonb_build_object('ok', false, 'reason', 'voided');
  END IF;

  -- Ordered by id so the two secret copies of one card in a single offer resolve
  -- in a fixed order — the first becomes the receiver's ownership row and the
  -- second a duplicate, rather than that depending on scan order.
  FOR _item IN
    SELECT i.kind,
           i.card_copy_id,
           i.secret_pull_id,
           -- Which card the copy is OF, read off the copy rather than stored on
           -- the item: one source of truth, and it cannot drift from the row the
           -- transfer below actually moves. LEFT, because a secret item has no copy.
           cc.event_participant_id,
           CASE i.giver_side WHEN 'proposer' THEN _offer.proposer_id
                             ELSE _offer.recipient_id END AS giver_id,
           CASE i.giver_side WHEN 'proposer' THEN _offer.recipient_id
                             ELSE _offer.proposer_id END AS receiver_id
      FROM public.trade_offer_items i
      LEFT JOIN public.card_copies cc ON cc.id = i.card_copy_id
     WHERE i.offer_id = _offer_id
     ORDER BY i.id
  LOOP
    IF _item.kind = 'roster' THEN
      -- THE FINISH TRAVELS, because the copy does. Re-parenting one card_copies
      -- row moves the actual thing that was rolled, rather than copying a
      -- person-level "best" from one row to another — which is why this used to
      -- hand over a standard card however good the copy was.
      --
      -- acquired_on is cleared for the same reason accept sets granted = true on
      -- a secret: the receiver may have pulled this very card today, and a traded
      -- copy carrying that date would collide on card_copies_one_pull_per_day and
      -- abort the whole accept. It is also true on its own terms — a card that
      -- arrived in a trade was not that person's pull for that day.
      UPDATE public.card_copies
         SET participant_id = _item.receiver_id,
             source         = 'trade',
             acquired_on    = NULL
       WHERE id = _item.card_copy_id;

      -- Both sides recomputed from the copies they now hold. The giver's best
      -- finish can FALL here — trade away your only platinum and standard is the
      -- honest answer — which is the one place in the app where that column moves
      -- downwards, and why mergeCollection stopped taking the better of the two.
      PERFORM public.resync_card_pull(_item.giver_id, _item.event_participant_id);
      PERFORM public.resync_card_pull(_item.receiver_id, _item.event_participant_id);
    ELSE
      SELECT sp.secret_card_id INTO _card
        FROM public.secret_card_pulls sp WHERE sp.id = _item.secret_pull_id;

      -- Does the receiver already own this one? Same question claim_guest_secrets
      -- asks when it merges a guest's pulls onto a claimed player, and the same
      -- answer: an already-owned card arrives as a duplicate rather than a second
      -- ownership row, which is what secret_card_pulls_owned_once requires.
      SELECT EXISTS (
        SELECT 1 FROM public.secret_card_pulls o
         WHERE o.participant_id = _item.receiver_id
           AND o.secret_card_id = _card
           AND NOT o.is_duplicate
      ) INTO _dupe;

      -- granted = true ALWAYS, and this is the single most important line in the
      -- file. secret_card_pulls_one_per_day is UNIQUE (participant_id, pulled_on)
      -- WHERE NOT granted: leave granted false and re-parenting a row aborts the
      -- whole accept whenever the receiver already pulled on the day the traded
      -- copy was pulled — which, since everyone pulls daily, is the common case
      -- rather than an edge one. It is also true on its own terms: a card that
      -- arrived in a trade was not that person's pull for that day.
      --
      -- tier travels with the row untouched. Unlike an edition it is server-rolled
      -- by roll_secret_tier(), so it is a fact about the copy rather than a claim.
      UPDATE public.secret_card_pulls
         SET participant_id = _item.receiver_id,
             is_duplicate   = _dupe,
             granted        = true
       WHERE id = _item.secret_pull_id;

      -- The giver may have just handed over the row that said they own this card.
      -- If they still hold copies, one of them takes over; if they held only the
      -- one, they own none of it now, which is exactly what trading it away means.
      -- The receiver needs no equivalent — `_dupe` above already decided their side.
      PERFORM public.resync_secret_ownership(_item.giver_id, _card);
    END IF;
  END LOOP;

  -- WHAT THIS TRADE FINISHED.
  --
  -- Here rather than inside the loop above, because resync_secret_ownership has
  -- to have settled every giver's side first — mid-loop, a set can read complete
  -- against a row that is about to move on. Still inside the two sorted
  -- participant locks taken at the top, which is what makes this atomic with the
  -- transfer.
  --
  -- Reading sp.participant_id AFTER the transfer is what makes it the receiver:
  -- the UPDATE above already re-parented the row, so there is no giver_side to
  -- re-derive. A dupe cannot finish anything, so it is filtered out rather than
  -- leaned on the helper's idempotence.
  --
  -- PLURAL, unlike pull and grant. A two-way trade genuinely can finish a set on
  -- both sides at once, and collapsing that to one would silently drop somebody's
  -- ceremony.
  FOR _rec IN
    SELECT DISTINCT sp.participant_id AS receiver_id, c.collection
      FROM public.trade_offer_items i
      JOIN public.secret_card_pulls sp ON sp.id = i.secret_pull_id
      JOIN public.secret_cards      c  ON c.id  = sp.secret_card_id
     WHERE i.offer_id = _offer_id
       AND i.kind = 'secret'
       AND NOT sp.is_duplicate
       AND c.collection IS NOT NULL
  LOOP
    _trophy := public.award_collection_trophy(_rec.receiver_id, _rec.collection,
                                              'trade', _offer.event_id);
    IF _trophy IS NOT NULL THEN
      _trophies := _trophies || jsonb_build_array(_trophy || jsonb_build_object('participantId', _rec.receiver_id));
    END IF;
  END LOOP;

  -- THE PUBLIC RECORD. Roster items name the CARD — public data anyone can already
  -- browse — resolved from the copy that just moved. Secret items collapse to their
  -- kind and nothing else, because this jsonb lands in an anon-readable,
  -- realtime-published table and a secret_card_id here would leak the catalogue to
  -- every phone in the garden. Built here and nowhere else.
  --
  -- AND NO EDITION, deliberately, even though one now genuinely travels with the
  -- copy. A finish is client-asserted (see the long comment in
  -- src/lib/card-pulls.functions.ts), and this table is the most public surface in
  -- the app — putting one here is precisely the "number a second person can see"
  -- that comment says it must never become without being re-derived server-side.
  -- The two people in the trade see the finish; the league sees a card moved.
  --
  -- The join is INNER for roster items on purpose: an item whose copy has since
  -- been deleted is dropped from the summary rather than recorded as a null card.
  SELECT
    coalesce(jsonb_agg(
      CASE i.kind
        WHEN 'roster' THEN jsonb_build_object('kind', 'roster',
                                              'eventParticipantId', cc.event_participant_id)
        ELSE jsonb_build_object('kind', 'secret')
      END ORDER BY i.kind, i.id), '[]'::jsonb)
    INTO _proposer_gave
    FROM public.trade_offer_items i
    LEFT JOIN public.card_copies cc ON cc.id = i.card_copy_id
   WHERE i.offer_id = _offer_id AND i.giver_side = 'proposer'
     AND (i.kind = 'secret' OR cc.id IS NOT NULL);

  SELECT
    coalesce(jsonb_agg(
      CASE i.kind
        WHEN 'roster' THEN jsonb_build_object('kind', 'roster',
                                              'eventParticipantId', cc.event_participant_id)
        ELSE jsonb_build_object('kind', 'secret')
      END ORDER BY i.kind, i.id), '[]'::jsonb)
    INTO _recipient_gave
    FROM public.trade_offer_items i
    LEFT JOIN public.card_copies cc ON cc.id = i.card_copy_id
   WHERE i.offer_id = _offer_id AND i.giver_side = 'recipient'
     AND (i.kind = 'secret' OR cc.id IS NOT NULL);

  UPDATE public.trade_offers
     SET status = 'accepted', resolved_at = now()
   WHERE id = _offer_id;

  INSERT INTO public.trades
    (event_id, offer_id, proposer_id, recipient_id, proposer_gave, recipient_gave)
  VALUES (_offer.event_id, _offer_id, _offer.proposer_id, _offer.recipient_id,
          _proposer_gave, _recipient_gave)
  RETURNING id INTO _trade_id;

  -- OTHER PENDING OFFERS STAKING A CARD THAT JUST MOVED ARE LEFT STANDING, on
  -- purpose. Hunting them down means scanning every open offer on every accept to
  -- pre-empt a failure the accept path already handles: the next person to press
  -- accept on one gets `voided` from the re-validation above. Leaving them alone
  -- also keeps a still-valid offer alive — trading away one of three copies does
  -- not invalidate an offer staking another.
  RETURN jsonb_build_object('ok', true, 'tradeId', _trade_id,
                            'completedCollections', _trophies);
END;
$$;
