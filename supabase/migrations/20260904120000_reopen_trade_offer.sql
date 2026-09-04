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
--   4. every staked card is still exactly where it was — BOTH that each one is
--      still a spare its own side holds, judged by the same triple
--      accept_trade_offer re-validates with, AND that none of them has gone
--      missing altogether (see the count below). A minute is long enough to
--      burn a spare or sell a secret, and an offer put back short of a card is
--      an offer nobody agreed to.
--
-- Deliberately NOT a void on failure, which is the one place this parts company
-- with accept: accept has to void because it is the last chance to stop a
-- half-finished swap, whereas a stale undo simply leaves the offer settled,
-- which it already correctly was.

-- ============ WHAT THE OFFER WAS WHEN IT WAS MADE ============
-- Condition 4 above cannot be answered from the surviving item rows alone, and
-- this is the column that lets it be.
--
-- trade_offer_items cascades from card_copies and secret_card_pulls, which
-- cascade in turn from event_participants and participants — so a commissioner
-- removing a rostered player silently deletes some of a settled offer's stakes,
-- with nobody touching the offer. Every check the reopen makes is about what is
-- LEFT: each remaining item can still be a spare, and trade_has_both_sides only
-- asks for one item a side. So a two-for-two that lost one of its four would
-- come back as a one-for-two, and the next tap would execute a trade neither
-- person agreed to. accept_trade_offer can live with that gap because a pending
-- offer is a live proposal either way; an undo cannot, because its whole promise
-- is that it puts back exactly what was there.
--
-- Recorded once at creation and never decremented, so a cascade is visible as a
-- disagreement rather than having to be caught as it happens. A trigger rather
-- than a line inside create_trade_offer: that RPC is a hundred lines of
-- validation this migration has no business restating, and a counter somebody
-- has to remember to keep is a counter that drifts.
ALTER TABLE public.trade_offers
  ADD COLUMN IF NOT EXISTS staked_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.trade_offers.staked_count IS
  'How many items the offer was created with. Never decremented: it is the baseline reopen_trade_offer compares the surviving trade_offer_items against, so a stake lost to a cascade is visible.';

-- Idempotent both ways: a replay from empty has no offers to count, and a second
-- run finds every count already right and matches nothing.
UPDATE public.trade_offers o
   SET staked_count = (SELECT count(*) FROM public.trade_offer_items i WHERE i.offer_id = o.id)
 WHERE o.staked_count = 0;

CREATE OR REPLACE FUNCTION public.count_trade_offer_stake() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.trade_offers SET staked_count = staked_count + 1 WHERE id = NEW.offer_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trade_offer_items_count
  AFTER INSERT ON public.trade_offer_items
  FOR EACH ROW EXECUTE FUNCTION public.count_trade_offer_stake();

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
    OR NOT public.trade_has_both_sides(_offer_id)
    -- And the offer is still the whole offer. The three above all ask about the
    -- items that remain; this is the one that notices an item that does not.
    OR (SELECT count(*) FROM public.trade_offer_items WHERE offer_id = _offer_id)
         <> _offer.staked_count THEN
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
