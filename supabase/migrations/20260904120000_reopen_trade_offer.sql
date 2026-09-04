-- Undo, for the two answers that move nothing.
--
-- Declining an offer and taking your own back are both a single status flip: no
-- card changes hands either way, so putting the offer back is cheap and exactly
-- reversible. That is what makes an Undo honest here and nowhere else in this
-- app — an accept is atomic and already done, and a burn or a sell has already
-- paid out. Those get a confirmation instead (docs/ux-audit-mobile.md §19).
--
-- FOUR THINGS HAVE TO HOLD, and all four are checked in here rather than in the
-- handler above it, because the handler cannot hold a lock:
--
--   1. the offer is still in the state the undo is undoing. Accepted, voided or
--      already re-opened is somebody else's answer and not ours to overwrite;
--   2. the caller is the person who put it there — the recipient declined it,
--      the proposer pulled it — so nobody can restore an offer that was
--      declined at them;
--   3. it happened inside the undo window. The handler passes it in, so
--      TRADE_UNDO_WINDOW_SECONDS in src/lib/trades.ts is the one number the app
--      goes by; the DEFAULT below is only there for a hand-written call;
--   4. every staked card is still exactly where it was, judged by the same
--      triple accept_trade_offer re-validates with. A minute is long enough to
--      burn a spare or sell a secret, and an offer put back missing a card is an
--      offer that can only void on the next tap — which would spend the other
--      person's attention on a swap that was never going to happen.
--
-- Deliberately NOT a void on failure, which is the one place this parts company
-- with accept: accept has to void because it is the last chance to stop a
-- half-finished swap, whereas a stale undo simply leaves the offer settled,
-- which it already correctly was.

CREATE OR REPLACE FUNCTION public.reopen_trade_offer(
  _offer_id       uuid,
  _actor_id       uuid,
  _within_seconds integer DEFAULT 60
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _offer public.trade_offers;
  _lo    uuid;
  _hi    uuid;
  _actor uuid;
BEGIN
  SELECT * INTO _offer FROM public.trade_offers WHERE id = _offer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Offer not found'; END IF;

  -- Returned rather than raised: a second tap on the same toast, or an undo of
  -- an offer the other side answered in the meantime, is a sentence to read and
  -- not a stack trace.
  IF _offer.status NOT IN ('declined', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'resolved');
  END IF;

  -- Whose answer this was. A declined offer was answered by its recipient and a
  -- cancelled one by its proposer, so exactly one participant can undo either.
  _actor := CASE _offer.status
              WHEN 'declined' THEN _offer.recipient_id
              ELSE _offer.proposer_id
            END;

  -- Raised, and here the mirror of accept's reasoning applies: the caller id
  -- comes from a verified member token, so a mismatch is somebody hand-posting
  -- an offer id that was never theirs to answer.
  IF _actor <> _actor_id THEN RAISE EXCEPTION 'Not your offer'; END IF;

  IF _offer.resolved_at IS NULL
     OR _offer.resolved_at < now() - make_interval(secs => _within_seconds) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;

  -- THE SAME LOCK ORDER accept_trade_offer takes, sorted by id, and for the same
  -- reason: these two run against the same pair of participants and a fixed
  -- order is what makes them queue rather than deadlock. An undo racing the
  -- other side's accept of a different offer is the case.
  _lo := least(_offer.proposer_id, _offer.recipient_id);
  _hi := greatest(_offer.proposer_id, _offer.recipient_id);
  PERFORM 1 FROM public.participants WHERE id = _lo FOR UPDATE;
  PERFORM 1 FROM public.participants WHERE id = _hi FOR UPDATE;

  -- Lock every staked row before re-reading it, so the check below and the flip
  -- after it see the same world.
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

  IF EXISTS (
    SELECT 1 FROM public.trade_offer_items i
     WHERE i.offer_id = _offer_id
       AND NOT public.trade_item_is_spare(
             CASE i.giver_side WHEN 'proposer' THEN _offer.proposer_id ELSE _offer.recipient_id END,
             i.kind, i.card_copy_id, i.secret_pull_id)
  ) OR NOT public.trade_leaves_a_copy(_offer_id)
    OR NOT public.trade_has_both_sides(_offer_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'stale');
  END IF;

  UPDATE public.trade_offers
     SET status = 'pending', resolved_at = NULL
   WHERE id = _offer_id;

  -- Who to poke. The offer is on the other person's screen again, and they were
  -- last told it had gone away.
  RETURN jsonb_build_object(
    'ok', true,
    'counterpartyId', CASE WHEN _actor_id = _offer.proposer_id
                             THEN _offer.recipient_id
                             ELSE _offer.proposer_id
                      END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reopen_trade_offer(uuid, uuid, integer)
  FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.reopen_trade_offer(uuid, uuid, integer) TO service_role;

COMMENT ON FUNCTION public.reopen_trade_offer(uuid, uuid, integer) IS
  'Puts a declined or cancelled offer back to pending, for the person who resolved it, inside a window, and only while every staked card is still a spare its own side holds.';
