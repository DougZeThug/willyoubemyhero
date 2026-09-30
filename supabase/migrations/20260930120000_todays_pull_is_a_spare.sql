-- Today's pull is a spare the moment it lands: it sells, burns, lists and trades
-- the same day, which is what lets the pack screen offer "Sell for N" on a card
-- that was dealt a minute ago.
--
-- The rule this removes was a security rule once, and is not any more. Both
-- things it protected were rebuilt to read rows a sale or a trade cannot touch:
--
--   * The daily deal. pull_secret_card read "an un-granted row for today" as
--     the spent daily slot, so selling or trading that row gave the slot back
--     and pull -> sell -> pull farmed dust. 20260908120000 dropped
--     pull_secret_card and its one-per-day index; open_pack keys the day on
--     pack_opens, one row per identity per day, and replays the stored cards
--     byte-for-byte however many of them have since been sold.
--
--   * The roster mint cap. record_card_pulls counted copies held with
--     source = 'pull' and acquired_on = today, so burning or trading one freed a
--     mint. 20260827120000 moved the cap onto card_mints, which is append-only
--     and outlives the copy.
--
-- What stays: a sale or a burn still needs the copy to be yours and unstaked,
-- a burn still needs a second copy, and the payout is still the server's own
-- finish or tier. 'too_fresh' stays in the client's refusal vocabulary for an
-- older server, but nothing returns it now.
--
-- Known and accepted: claim_guest_secrets drops a guest's same-day pulls only
-- when the member still holds an un-granted pull for that day. A member who has
-- already sold today's secret and then claims a guest device that also opened a
-- pack today keeps the guest's secret too. That is one card, once, behind a claim.
--
-- BODIES LIFTED WHOLE from their newest definitions — trade_item_is_spare from
-- 20260817181607, mill_card_copy and sell_secret_card from 20260830120000 — with
-- only the same-day block removed, for the reason 20260830120000 gives: a body
-- retyped from a stale copy silently reverts whatever landed in between.

-- ============ WHAT COUNTS AS A SPARE ============
CREATE OR REPLACE FUNCTION public.trade_item_is_spare(
  _giver_id       uuid,
  _kind           text,
  _card_copy_id   uuid,
  _secret_pull_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
-- Nothing here reads the date any more. Kept so the function's settings match
-- every other daily RPC, which is what a reader comparing them expects.
SET timezone = 'America/New_York'
AS $$
  SELECT CASE _kind
    WHEN 'roster' THEN EXISTS (
      -- The copy is the giver's, AND they hold a second one of the same card.
      --
      -- The >= 2 half is what makes the transfer legal under
      -- card_pulls_count_positive: the giver keeps at least one copy, so
      -- resync_card_pull never takes their row to zero and the public "Packed by
      -- N" count for this card cannot move because of a trade.
      --
      -- WHICH copy is now the giver's choice, including their best one. That is
      -- the point of per-copy: you always keep one of everything, and you decide
      -- which one you keep.
      SELECT 1 FROM public.card_copies mine
       WHERE mine.id = _card_copy_id
         AND mine.participant_id = _giver_id
         AND (SELECT count(*) FROM public.card_copies others
               WHERE others.participant_id = _giver_id
                 AND others.event_participant_id = mine.event_participant_id) >= 2)
    WHEN 'secret' THEN EXISTS (
      -- ANY copy, not just a duplicate. A secret you own one of is yours to give:
      -- unlike a roster card there is no public count riding on you keeping one,
      -- so the only thing that has to survive is your OWN record staying coherent,
      -- and resync_secret_ownership below is what does that.
      SELECT 1 FROM public.secret_card_pulls
       WHERE id = _secret_pull_id
         AND participant_id = _giver_id
         -- TODAY'S PULL INCLUDED. This used to refuse the day's un-granted row,
         -- because pull_secret_card read that row as the spent daily slot and
         -- moving it handed the slot back. open_pack replaced pull_secret_card
         -- and gates the day on pack_opens, which no trade touches.
         )
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public.trade_item_is_spare(uuid, text, uuid, uuid)
  FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.trade_item_is_spare(uuid, text, uuid, uuid) TO service_role;

-- ============ BURN A ROSTER COPY ============
CREATE OR REPLACE FUNCTION public.mill_card_copy(
  _participant_id uuid,
  _card_copy_id   uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET timezone = 'America/New_York'
AS $$
DECLARE
  _copy  public.card_copies;
  _award int;
BEGIN
  IF _participant_id IS NULL OR _card_copy_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- BEFORE THE LOCK AND BEFORE ANYTHING ELSE. A refused call should touch no
  -- rows at all, and this is the cheapest possible way to say no.
  IF NOT public.dust_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'disabled');
  END IF;

  PERFORM 1 FROM public.participants WHERE id = _participant_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  SELECT * INTO _copy FROM public.card_copies
   WHERE id = _card_copy_id AND participant_id = _participant_id
   FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_yours'); END IF;

  -- Spare-ness by THE definition rather than a second copy of it: >= 2 copies
  -- held, which is what makes the delete legal under card_pulls_count_positive
  -- and what makes resync_card_pull's zero branch unreachable from here. Re-read
  -- under the participant lock, which is what stops two concurrent mills of a
  -- pair both passing a check that saw the count before either fired.
  IF NOT public.trade_item_is_spare(_participant_id, 'roster', _card_copy_id, NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'last_copy');
  END IF;

  -- NOT STAKED ON A PENDING OFFER. trade_offer_items cascades from card_copies,
  -- so milling a staked copy silently removes an item from an offer somebody else
  -- has already read and is about to accept. trade_has_both_sides only catches a
  -- side reaching ZERO — an offer that shrinks from two cards to one passes every
  -- accept-time check, and the counterparty hands over their side for less than
  -- they agreed. Refused here, because this is the thing breaking the promise.
  IF EXISTS (SELECT 1 FROM public.trade_offer_items i
               JOIN public.trade_offers o ON o.id = i.offer_id
              WHERE i.card_copy_id = _card_copy_id AND o.status = 'pending') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'staked');
  END IF;

  -- AND NOT ON THE MARKET, for the same reason one line up. market_listings
  -- .card_copy_id is ON DELETE CASCADE too, so milling a listed copy takes the
  -- shelf entry down with it — silently, leaving no 'voided' row to explain where
  -- it went to a buyer who was reading that shelf a second ago. Cancel the listing
  -- and the copy burns like any other.
  IF EXISTS (SELECT 1 FROM public.market_listings l
              WHERE l.card_copy_id = _card_copy_id AND l.status = 'active') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'staked');
  END IF;

  -- PRICED BY WHO DECIDED THE FINISH. A 'client' row pays the flat floor whatever
  -- it says on it, which is what makes a hand-asserted platinum worth five —
  -- and what makes a commissioner grant not a dust printer.
  _award := CASE WHEN _copy.edition_asserted_by = 'server'
                 THEN public.mill_value(_copy.edition)
                 ELSE 5 END;

  DELETE FROM public.card_copies WHERE id = _card_copy_id;

  INSERT INTO public.dust_ledger (participant_id, delta, reason, ref, detail)
  VALUES (_participant_id, _award, 'mill_copy', _card_copy_id,
          jsonb_build_object('edition', _copy.edition,
                             'assertedBy', _copy.edition_asserted_by,
                             'eventParticipantId', _copy.event_participant_id))
  ON CONFLICT DO NOTHING;

  -- YES, IT RESYNCS. The roadmap said milling never touches card_pulls, on the
  -- grounds that "Packed by N" counts pulls-ever — but that number is the ROW
  -- COUNT (getCardPullCounts counts rows, one per person per card), and
  -- pull_count is the owner's own copies-held. The spare rule above guarantees a
  -- copy survives, so the row survives, so the public count cannot move. Skipping
  -- this instead would leave pull_count overstating until some unrelated trade
  -- corrected it, and the vault would offer a mill for a copy that is not there.
  -- A mill is a trade to nobody; accept_trade_offer resyncs for the same reason.
  PERFORM public.resync_card_pull(_participant_id, _copy.event_participant_id);

  RETURN jsonb_build_object('ok', true, 'awarded', _award,
    'edition', _copy.edition,
    'eventParticipantId', _copy.event_participant_id,
    'balance', public.dust_balance(_participant_id));
END;
$$;

REVOKE ALL ON FUNCTION public.mill_card_copy(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mill_card_copy(uuid, uuid) TO service_role;

-- ============ SELL A SECRET TO THE HOUSE ============
CREATE OR REPLACE FUNCTION public.sell_secret_card(
  _participant_id uuid,
  _secret_pull_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET timezone = 'America/New_York'
AS $$
DECLARE
  _pull  public.secret_card_pulls;
  _award int;
BEGIN
  IF _participant_id IS NULL OR _secret_pull_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- BEFORE THE LOCK AND BEFORE ANYTHING ELSE. A refused call should touch no
  -- rows at all, and this is the cheapest possible way to say no.
  IF NOT public.dust_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'disabled');
  END IF;

  PERFORM 1 FROM public.participants WHERE id = _participant_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  SELECT * INTO _pull FROM public.secret_card_pulls
   WHERE id = _secret_pull_id AND participant_id = _participant_id
   FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_yours'); END IF;

  -- NOT STAKED ON A PENDING OFFER. trade_offer_items.secret_pull_id is
  -- ON DELETE CASCADE, so selling a staked copy silently removes an item from an
  -- offer somebody else has already read and is about to accept.
  -- trade_has_both_sides only catches a side reaching ZERO — an offer that
  -- shrinks from two cards to one passes every accept-time check, and the
  -- counterparty hands over their side for less than they agreed. The exact bug
  -- mill_card_copy guards against, refused here for the same reason.
  IF EXISTS (SELECT 1 FROM public.trade_offer_items i
               JOIN public.trade_offers o ON o.id = i.offer_id
              WHERE i.secret_pull_id = _secret_pull_id AND o.status = 'pending') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'staked');
  END IF;

  -- AND NOT ON THE MARKET. market_listings.secret_pull_id is ON DELETE CASCADE as
  -- well, so selling a listed copy to the house takes the shelf entry with it and
  -- nobody is told. Off the market first, and then it sells to the house freely.
  IF EXISTS (SELECT 1 FROM public.market_listings l
              WHERE l.secret_pull_id = _secret_pull_id AND l.status = 'active') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'staked');
  END IF;

  -- NO LAST-COPY GUARD, and that is the feature rather than an omission. It is
  -- the rule trading already keeps: trade_item_is_spare's 'secret' branch takes
  -- ANY copy, because unlike a roster card there is no public count riding on
  -- you keeping one — the only thing that has to survive is your own record
  -- staying coherent, and resync_secret_ownership below is what does that.
  --
  -- AND NO FLAT-FLOOR BRANCH either, which is the one place this departs from
  -- mill_card_copy's shape. That function pays 5 for anything a phone asserted,
  -- because card_copies.edition_asserted_by says a finish can arrive untrusted.
  -- secret_card_pulls.tier has no such path: it is only ever written by
  -- roll_secret_tier() or roll_secret_tier_at_least(), so every tier here is
  -- already the server's own. The asymmetry is deliberate, not a miss.
  _award := public.secret_sell_value(_pull.tier);

  DELETE FROM public.secret_card_pulls WHERE id = _secret_pull_id;

  INSERT INTO public.dust_ledger (participant_id, delta, reason, ref, detail)
  VALUES (_participant_id, _award, 'sell_secret', _secret_pull_id,
          jsonb_build_object('tier', _pull.tier, 'secretCardId', _pull.secret_card_id))
  ON CONFLICT DO NOTHING;

  -- If the row just sold was the OWNING one and duplicates remain, this promotes
  -- the best of them. Same reason mill_card_copy resyncs, and the same reason
  -- accept_trade_offer does: `is_duplicate = false` is the marker four separate
  -- counts read as "this person owns this card", and leaving it unset behind a
  -- sale would show a vault card that every count says is not theirs.
  PERFORM public.resync_secret_ownership(_participant_id, _pull.secret_card_id);

  RETURN jsonb_build_object('ok', true, 'awarded', _award,
    'tier', _pull.tier,
    'secretCardId', _pull.secret_card_id,
    'balance', public.dust_balance(_participant_id));
END;
$$;

REVOKE ALL ON FUNCTION public.sell_secret_card(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sell_secret_card(uuid, uuid) TO service_role;
