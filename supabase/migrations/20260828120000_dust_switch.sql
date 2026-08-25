-- A switch for the dust economy, off until somebody says otherwise.
--
-- R4 shipped dust whole — earn, sinks, chip and shop — and it is not wanted live
-- yet. This is the commissioner's switch for it.
--
-- ON THE EVENT, like awards_locked and splits_enabled, and read through the
-- ACTIVE event: dust_ledger carries no event id because a balance is a fact
-- about a person rather than about a combine, so "is dust live" is one question
-- with one answer rather than one per event. No active event means off, which is
-- the safe direction for a question asked from a rate-limited endpoint.
--
-- DEFAULT false, which is what makes deploying this a no-op: every existing row
-- turns the feature off on the way in, including the live one.
--
-- The switch lives in SQL rather than in the handlers because that is where the
-- money moves. src/lib/dust.functions.ts reads it too, so the sheet can say why
-- a button is missing, but a client that skipped that check would still be
-- refused here.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS dust_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.events.dust_enabled IS
  'Commissioner switch for the whole dust economy: earning, burning, buying and the shop. Read through the active event by dust_enabled(). Off means nothing accrues at all — see that function.';

-- THREE PLACES, NOT ONE. `events` is read by the app through the events_public
-- VIEW, so a column added only to the table is invisible to getActiveEvent and
-- the vault could never hide itself. 20260727130000 wrote the rule down when
-- awards_locked went in: "events is read through the events_public view, so the
-- new column has to be added to both the column grant and the view."
--
-- Public on purpose. Whether the shop exists is not a secret — every player can
-- see whether their own chip is there — and the alternative is a second round
-- trip on a screen that already holds the event.
GRANT SELECT (dust_enabled) ON public.events TO anon, authenticated;

DROP VIEW IF EXISTS public.events_public;
CREATE VIEW public.events_public AS
SELECT id, name, year, event_date, location, status, timing_mode, splits_enabled,
       draft_size, results_locked, draft_locked, running_order_locked, awards_locked,
       dust_enabled,
       active, created_at, updated_at
FROM public.events;
GRANT SELECT ON public.events_public TO anon, authenticated;

-- ============ IS DUST LIVE ============
CREATE OR REPLACE FUNCTION public.dust_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- COALESCE, because "no active event" has to read as off rather than as NULL:
  -- every caller uses this in an IF, and NULL is not false — it would fall
  -- straight through to the payout.
  SELECT COALESCE((SELECT e.dust_enabled FROM public.events e
                    WHERE e.active ORDER BY e.year DESC LIMIT 1), false);
$$;

REVOKE ALL ON FUNCTION public.dust_enabled() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dust_enabled() TO service_role;

-- ============ THE EARN ============
-- Both pull functions again, bodies taken from 20260826130000 — the newest
-- definitions — with one condition added to each credit. Extracted from that file
-- rather than retyped, for the reason 20260825120000 demonstrated when it
-- re-created accept_trade_offer from a stale copy and reverted a feature nobody
-- noticed for two commits.

CREATE OR REPLACE FUNCTION public.pull_secret_card(_participant_id uuid, _guest_id uuid, _event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET "TimeZone" TO 'America/New_York'
AS $$
DECLARE
  _day  date := current_date;
  _card uuid;
  _dupe boolean := false;
  _tier text;
  _row  public.secret_card_pulls;
  _collection text;
  _trophy jsonb;
  _dust int := 0;
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
    -- Already pulled today. `dust` is null rather than zero: the credit happened
    -- on the call that made this row, and repeating the number here would have
    -- the ceremony announce it twice.
    RETURN jsonb_build_object('pullId', _row.id, 'cardId', _row.secret_card_id,
      'day', _row.pulled_on, 'duplicate', _row.is_duplicate, 'tier', _row.tier,
      'fresh', false, 'completedCollection', NULL, 'dust', NULL);
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
      'fresh', false, 'completedCollection', NULL, 'dust', NULL);
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

  -- THE EARN. A dupe is the one moment in the day that felt like nothing, so it
  -- is the one that pays. Members only — see the header — and below the early
  -- returns above, which are what stop a second call the same league day paying
  -- twice. The unique index makes the retry free on top of that.
  -- AND ONLY WHILE DUST IS LIVE. Nothing accrues behind the switch: a balance
  -- built out of history nobody knew was being scored, during a stretch when
  -- burning was unavailable, would be lopsided towards whoever pulled most. Off
  -- means off, and the day it goes on everyone starts level.
  IF _dupe AND _participant_id IS NOT NULL AND public.dust_enabled() THEN
    INSERT INTO public.dust_ledger (participant_id, delta, reason, ref, detail)
    VALUES (_participant_id, 25, 'dupe_secret', _row.id,
            jsonb_build_object('tier', _row.tier))
    ON CONFLICT DO NOTHING;
    IF FOUND THEN _dust := 25; END IF;
  END IF;

  -- Only a card they did not already hold can finish anything, and only a member
  -- can hold a trophy. A guest who finishes a set banks it at
  -- claim_guest_secrets, the moment these rows become somebody's.
  --
  -- After the tier upgrade above rather than before, so the trophy is minted
  -- against settled ownership.
  IF NOT _dupe AND _participant_id IS NOT NULL THEN
    SELECT c.collection INTO _collection FROM public.secret_cards c WHERE c.id = _card;
    _trophy := public.award_collection_trophy(_participant_id, _collection, 'pull', _event_id);
  END IF;

  RETURN jsonb_build_object('pullId', _row.id, 'cardId', _row.secret_card_id,
    'day', _row.pulled_on, 'duplicate', _row.is_duplicate, 'tier', _row.tier,
    'fresh', true, 'completedCollection', _trophy, 'dust', _dust);
END;
$$;

CREATE OR REPLACE FUNCTION public.pull_bonus_secret_card(
  _participant_id uuid,
  _guest_id       uuid,
  _event_id       uuid,
  -- NULL is day 3's floor, and the answer for any caller that has none.
  _floor_tier     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET timezone = 'America/New_York'
AS $$
DECLARE
  _day  date := current_date;
  _card uuid;
  _dupe boolean := false;
  _tier text;
  _row  public.secret_card_pulls;
  _collection text;
  _trophy jsonb;
  _dust int := 0;
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

  SELECT c.id INTO _card FROM public.secret_cards c
   WHERE c.active AND c.art_path IS NOT NULL AND c.weight > 0
     AND NOT EXISTS (SELECT 1 FROM public.secret_card_pulls p
                      WHERE p.secret_card_id = c.id
                        AND NOT p.is_duplicate
                        AND ((_participant_id IS NOT NULL AND p.participant_id = _participant_id)
                          OR (_guest_id       IS NOT NULL AND p.guest_id       = _guest_id)))
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

  -- The one line that differs from pull_secret_card. WHICH card you get is still
  -- the plain weighted draw above — the milestone buys the level, not the art,
  -- because biasing the draw as well would quietly undo secret_cards.weight.
  _tier := public.roll_secret_tier_at_least(_floor_tier);

  IF _participant_id IS NOT NULL THEN
    INSERT INTO public.secret_card_pulls
      (participant_id, secret_card_id, pulled_on, event_id, is_duplicate, granted, tier)
    VALUES (_participant_id, _card, _day, _event_id, _dupe, true, _tier)
    RETURNING * INTO _row;
  ELSE
    INSERT INTO public.secret_card_pulls
      (guest_id, secret_card_id, pulled_on, event_id, is_duplicate, granted, tier)
    VALUES (_guest_id, _card, _day, _event_id, _dupe, true, _tier)
    RETURNING * INTO _row;
  END IF;

  -- Best wins, never down. A duplicate that rolled better upgrades the copy you
  -- already own, which is the row the vault reads from. Same rule as
  -- pull_secret_card — and it needs no floor of its own, because it compares
  -- ranks and so carries a floored tier upward for free.
  IF _dupe THEN
    UPDATE public.secret_card_pulls o
       SET tier = _row.tier
     WHERE o.secret_card_id = _card
       AND NOT o.is_duplicate
       AND ((_participant_id IS NOT NULL AND o.participant_id = _participant_id)
         OR (_guest_id       IS NOT NULL AND o.guest_id       = _guest_id))
       AND public.secret_tier_rank(_row.tier) < public.secret_tier_rank(o.tier);
  END IF;

  -- A bonus dupe pays exactly what a daily dupe pays. Every bonus pull mints its
  -- own secret_card_pulls row, so ref is fresh and the earn-once index never
  -- collapses two of them.
  -- Gated the same way the daily dupe is; see pull_secret_card.
  IF _dupe AND _participant_id IS NOT NULL AND public.dust_enabled() THEN
    INSERT INTO public.dust_ledger (participant_id, delta, reason, ref, detail)
    VALUES (_participant_id, 25, 'dupe_secret', _row.id,
            jsonb_build_object('tier', _row.tier, 'bonus', true))
    ON CONFLICT DO NOTHING;
    IF FOUND THEN _dust := 25; END IF;
  END IF;

  -- The repair. Same rule and same position as pull_secret_card's.
  IF NOT _dupe AND _participant_id IS NOT NULL THEN
    SELECT c.collection INTO _collection FROM public.secret_cards c WHERE c.id = _card;
    _trophy := public.award_collection_trophy(_participant_id, _collection, 'pull', _event_id);
  END IF;

  RETURN jsonb_build_object('pullId', _row.id, 'cardId', _row.secret_card_id,
    'day', _row.pulled_on, 'duplicate', _row.is_duplicate, 'tier', _row.tier,
    'granted', true, 'completedCollection', _trophy, 'dust', _dust);
END;
$$;

REVOKE ALL ON FUNCTION public.pull_secret_card(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pull_secret_card(uuid, uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.pull_bonus_secret_card(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pull_bonus_secret_card(uuid, uuid, uuid, text) TO service_role;

-- ============ THE SINKS AND THE MILL ============
-- Same three functions from 20260826130000, each with the switch checked before
-- it takes a lock or reads a balance. 'disabled' joins the soft-failure reasons
-- rather than raising: it is something to say on a button, and a client that
-- somehow still has one is not doing anything wrong by asking.

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

  -- TODAY'S OWN PULL IS NOT A SPARE YET, the same sentence trade_item_is_spare's
  -- secret branch carries. It was written here as a security rule, on the grounds
  -- that milling today's copy frees a slot in record_card_pulls' daily mint cap.
  -- 20260827120000 took that job away: the cap counts card_mints rows now, and a
  -- mint row outlives the copy it minted, so nothing this function does can buy
  -- one back. What is left is a product rule, and a good one — a card pulled an
  -- hour ago is not yet a spare. Tomorrow it burns like any other.
  IF _copy.source = 'pull' AND _copy.acquired_on = current_date THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_fresh');
  END IF;

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

CREATE OR REPLACE FUNCTION public.buy_bonus_secret_pull(
  _participant_id uuid,
  _event_id       uuid,
  -- One id per tap, minted by the client and reused across its retries. A lost
  -- response on a 150-dust purchase is the worst bug this release could ship, and
  -- nothing else in the shape of this call is unique enough to key on: buying two
  -- pulls in a row is legitimate, so the ledger cannot dedupe on the reason.
  _request_id     uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET timezone = 'America/New_York'
AS $$
DECLARE
  _price constant int := 150;
  _bal   int;
  _entry bigint;
  _prior jsonb;
  _pull  jsonb;
  _out   jsonb;
BEGIN
  IF _participant_id IS NULL OR _request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- BEFORE THE LOCK AND BEFORE ANYTHING ELSE. A refused call should touch no
  -- rows at all, and this is the cheapest possible way to say no.
  IF NOT public.dust_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'disabled');
  END IF;

  -- The lock comes before the balance read, and that ordering is the entire
  -- guard. Reading first lets two concurrent buys both see the same balance and
  -- both spend it; there is no CHECK that can catch it, because the invariant is
  -- over a sum. Under READ COMMITTED the balance read below is a separate
  -- statement taking a fresh snapshot AFTER the lock is granted, so the second
  -- buyer sees the first one's committed debit.
  PERFORM 1 FROM public.participants WHERE id = _participant_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  SELECT detail INTO _prior FROM public.dust_ledger
   WHERE participant_id = _participant_id
     AND reason = 'buy_secret_pull'
     AND detail->>'requestId' = _request_id::text;
  IF FOUND THEN RETURN _prior->'outcome'; END IF;

  _bal := public.dust_balance(_participant_id);
  IF _bal < _price THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient',
                              'balance', _bal, 'price', _price);
  END IF;

  IF _event_id IS NULL THEN
    SELECT id INTO _event_id FROM public.events WHERE active ORDER BY year DESC LIMIT 1;
  END IF;

  -- The catalogue is checked BEFORE the debit, so an empty pool is a soft answer
  -- rather than a rolled-back transaction and a raw Postgres string on a button.
  -- Same guard in the same position as claim_streak_milestone's.
  IF NOT EXISTS (SELECT 1 FROM public.secret_cards
                  WHERE active AND art_path IS NOT NULL AND weight > 0) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unavailable');
  END IF;

  -- THE DEBIT GOES FIRST, exactly as claim_streak_milestone files its claim row
  -- before paying out. Reversed, a payout that raised would have already handed
  -- over a card nobody paid for; this way the failure takes the debit with it.
  INSERT INTO public.dust_ledger (participant_id, delta, reason, detail)
  VALUES (_participant_id, -_price, 'buy_secret_pull',
          jsonb_build_object('requestId', _request_id))
  RETURNING id INTO _entry;

  -- Re-takes the participant lock, which is free: row locks are held per
  -- transaction, so this is re-entrant rather than a self-deadlock.
  --
  -- No floor tier. A bought pull buys a pull; the rarity floors stay something
  -- a streak earns.
  _pull := public.pull_bonus_secret_card(_participant_id, NULL, _event_id, NULL);
  -- RAISED, NOT RETURNED, and the difference is 150 dust. The debit is already
  -- filed by this point, and a plpgsql RETURN commits the transaction it is in —
  -- so answering softly here would take the payment and hand over nothing. The
  -- exception rolls the debit back with it.
  --
  -- Only reachable as a race: the catalogue guard above already answers the
  -- ordinary empty-pool case softly, before any money moves. Getting here means
  -- the last card was retired in between, which is a genuine "should not happen"
  -- and is worth surfacing as one.
  IF _pull IS NULL THEN
    RAISE EXCEPTION 'No secret card available to buy';
  END IF;

  _out := jsonb_build_object('ok', true, 'price', _price,
    'balance', public.dust_balance(_participant_id), 'pull', _pull);

  -- Filed onto the debit so a replay of the same tap can be answered with the
  -- outcome it already bought rather than a second card.
  UPDATE public.dust_ledger
     SET ref = (_pull->>'pullId')::uuid,
         detail = detail || jsonb_build_object('outcome', _out)
   WHERE id = _entry;

  RETURN _out;
END;
$$;

REVOKE ALL ON FUNCTION public.buy_bonus_secret_pull(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.buy_bonus_secret_pull(uuid, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.reroll_copy_edition(
  _participant_id uuid,
  _card_copy_id   uuid,
  _request_id     uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET timezone = 'America/New_York'
AS $$
DECLARE
  _price constant int := 50;
  _copy  public.card_copies;
  _bal   int;
  _new   text;
  _out   jsonb;
  _prior jsonb;
BEGIN
  IF _participant_id IS NULL OR _card_copy_id IS NULL OR _request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- BEFORE THE LOCK AND BEFORE ANYTHING ELSE. A refused call should touch no
  -- rows at all, and this is the cheapest possible way to say no.
  IF NOT public.dust_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'disabled');
  END IF;

  -- Same order as mill_card_copy: participants, then the copy.
  PERFORM 1 FROM public.participants WHERE id = _participant_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  SELECT detail INTO _prior FROM public.dust_ledger
   WHERE participant_id = _participant_id
     AND reason = 'reroll_edition'
     AND detail->>'requestId' = _request_id::text;
  IF FOUND THEN RETURN _prior->'outcome'; END IF;

  SELECT * INTO _copy FROM public.card_copies
   WHERE id = _card_copy_id AND participant_id = _participant_id
   FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_yours'); END IF;

  -- Refused on a staked copy for a sharper reason than mill's: a re-roll does not
  -- delete anything, so nothing downstream would notice. The counterparty agreed
  -- to a finish they can see in the offer and would receive a different one.
  IF EXISTS (SELECT 1 FROM public.trade_offer_items i
               JOIN public.trade_offers o ON o.id = i.offer_id
              WHERE i.card_copy_id = _card_copy_id AND o.status = 'pending') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'staked');
  END IF;

  _bal := public.dust_balance(_participant_id);
  IF _bal < _price THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient',
                              'balance', _bal, 'price', _price);
  END IF;

  -- RANDOM, not roll_card_edition(), and this is the one place in R4 where that
  -- is the right call. The pull derivation exists so a retry cannot re-draw;
  -- a re-roll is the opposite, and re-deriving the same triple would hand back
  -- the finish this copy already has and charge fifty dust for nothing. Its
  -- idempotence comes from _request_id above instead.
  _new := (SELECT CASE WHEN d <   50 THEN 'platinum'
                       WHEN d <  400 THEN 'gold'
                       WHEN d < 1200 THEN 'silver'
                       WHEN d < 3000 THEN 'bronze'
                       ELSE 'standard' END
             FROM (SELECT floor(random() * 10000)::int AS d) t);

  -- IT REPLACES, and is NOT a best-of. Everything around it — record_card_pulls,
  -- pull_secret_card, resync_card_pull, claim_guest_secrets — takes the better of
  -- two finishes, so the instinct to make this one do the same is strong and
  -- wrong: a best-of turns fifty dust into a risk-free ratchet, the whole league
  -- converges on platinum, and the ladder stops meaning anything. A re-roll is a
  -- gamble. It can go down.
  UPDATE public.card_copies
     SET edition = _new, edition_asserted_by = 'server'
   WHERE id = _card_copy_id;

  INSERT INTO public.dust_ledger (participant_id, delta, reason, ref, detail)
  VALUES (_participant_id, -_price, 'reroll_edition', _card_copy_id,
          jsonb_build_object('requestId', _request_id, 'from', _copy.edition, 'to', _new));

  -- card_pulls.edition is derived from the copies and one just changed —
  -- including possibly downward, which after a trade is the second path in the
  -- app where that column can fall.
  PERFORM public.resync_card_pull(_participant_id, _copy.event_participant_id);

  _out := jsonb_build_object('ok', true, 'price', _price,
    'from', _copy.edition, 'to', _new,
    'eventParticipantId', _copy.event_participant_id,
    'balance', public.dust_balance(_participant_id));

  UPDATE public.dust_ledger
     SET detail = detail || jsonb_build_object('outcome', _out)
   WHERE participant_id = _participant_id
     AND reason = 'reroll_edition'
     AND detail->>'requestId' = _request_id::text;

  RETURN _out;
END;
$$;

REVOKE ALL ON FUNCTION public.reroll_copy_edition(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reroll_copy_edition(uuid, uuid, uuid) TO service_role;
