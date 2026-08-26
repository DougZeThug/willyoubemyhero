-- Selling a secret, priced by the tier on your copy.
--
-- Until now a secret could never become dust. mill_card_copy is the only burn
-- RPC and it takes a card_copies id, so a spare roster card had somewhere to go
-- and a secret did not — the only dust a secret ever produced was the flat 25
-- credited automatically when a duplicate landed. That credit ignored the tier
-- entirely: a mythic duplicate and a common one both paid 25, which is the
-- opposite of how every other payout in this schema behaves.
--
-- So the flat credit is FOLDED INTO A SALE. A duplicate no longer pays on
-- arrival; it becomes a thing worth selling, at 3x the mill ladder —
-- 300/120/60/30/15 against secret tier weights identical to the edition weights
-- (0.5 / 3.5 / 8 / 18 / 70 %). That averages 26.4 dust a copy against the old
-- flat 25, so income per duplicate is near enough unchanged and the prices in
-- 20260826130000 need no retuning. What is genuinely new is income from copies
-- you CHOSE to part with, and that has a real cost attached.
--
-- ANY copy is sellable, including your only one. That is the feature rather than
-- an omission — see the comment on sell_secret_card below.
--
-- Depends on 20260828120000: every RPC here checks dust_enabled() before it takes
-- a lock, and the two pull functions are re-created from that file's bodies.

-- ============ WHAT A COPY IS WORTH ============
-- 15 / 30 / 60 / 120 / 300, indexed by the ladder that already exists rather
-- than by a second copy of it. secret_tier_rank returns 1..5 rarest first and 99
-- for anything it does not recognise, and ARRAY[...][99] is NULL — so an unknown
-- tier pays the floor instead of raising inside a payout. Same shape and same
-- reasoning as mill_value. Mirrored in src/lib/dust.ts, and a db test pins the
-- two together.
CREATE OR REPLACE FUNCTION public.secret_sell_value(_tier text)
RETURNS int
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE((ARRAY[300, 120, 60, 30, 15])[public.secret_tier_rank(_tier)], 15);
$$;

REVOKE ALL ON FUNCTION public.secret_sell_value(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.secret_sell_value(text) TO service_role;

-- ============ ROOM IN THE LEDGER FOR A SALE ============
-- Both of these need DROP + CREATE rather than an edit: a CHECK cannot be
-- extended and a partial index's predicate cannot be altered. Both are written
-- to replay from empty, because tests/db/migrations.test.ts applies every
-- migration in filename order against a fresh cluster.
--
-- 'dupe_secret' STAYS in the vocabulary. The reason column is append-only —
-- existing rows carry it and renaming one orphans them — it simply loses its
-- writer below.
ALTER TABLE public.dust_ledger DROP CONSTRAINT IF EXISTS dust_ledger_reason_ck;
ALTER TABLE public.dust_ledger ADD CONSTRAINT dust_ledger_reason_ck CHECK (reason IN (
  'dupe_secret', 'sell_secret', 'mill_copy', 'buy_secret_pull', 'reroll_edition',
  'milestone', 'bounty', 'admin_adjust'));

-- An earn is keyed to the thing that caused it, so a credit cannot land twice
-- however many times a handler retries. A sale deletes its own row, so a replay
-- is already answered with not_yours — this is the backstop under that, exactly
-- as it is for mill_copy. reroll_edition is still deliberately absent: paying 50
-- twice for two re-rolls of one copy is the feature.
DROP INDEX IF EXISTS public.dust_ledger_earn_once;
CREATE UNIQUE INDEX IF NOT EXISTS dust_ledger_earn_once
  ON public.dust_ledger (participant_id, reason, ref)
  WHERE ref IS NOT NULL AND reason IN ('dupe_secret', 'sell_secret', 'mill_copy');

-- ============ EARN: SELLING A SECRET ============
-- Modelled on mill_card_copy line for line, including its LOCK ORDER, which is
-- what keeps every dust RPC out of accept_trade_offer's way: participants first,
-- then the row keyed to them. accept_trade_offer takes two participant rows
-- sorted by id and only then the items, so it can never hold a secret_card_pulls
-- row while still wanting a participants row. Take the pull first "to find its
-- owner" and that reverse edge appears. The owner comes from the verified token;
-- the row is proved to be theirs UNDER the lock.
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

  -- TODAY'S OWN PULL IS NOT A SPARE YET, and here — unlike in mill_card_copy —
  -- that is a SECURITY rule rather than a product one. The identical sentence is
  -- in trade_item_is_spare's secret branch: a member's un-granted row for the
  -- current league day IS their spent daily slot, because pull_secret_card looks
  -- for exactly `pulled_on = today AND NOT granted` to decide whether they have
  -- already pulled. Delete it and the slot comes back, so pull -> sell -> pull
  -- would farm dust indefinitely. Tomorrow the same row sells freely.
  IF NOT _pull.granted AND _pull.pulled_on = current_date THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_fresh');
  END IF;

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

-- ============ THE DUPE STOPS PAYING ON ARRIVAL ============
-- Both pull functions again, BODIES TAKEN FROM 20260828120000 — the newest
-- definitions — with the credit block, the `_dust` local and the `dust` key
-- removed from each. Extracted from that file rather than retyped, for the
-- reason 20260825120000 demonstrated when it re-created accept_trade_offer from
-- a stale copy and silently reverted the named secret cards 20260825000127 had
-- just added: migrations apply in filename order and both files look correct in
-- isolation.
--
-- The dupe sting is still the moment the economy answers — that has not changed
-- and was always the point of it. What changed is the answer: instead of an
-- automatic 25 nobody chose, the card in your hand is now worth something, and
-- selling it is a decision. The reveal says so; see pack-stand.tsx.
--
-- The tier upgrade and the award_collection_trophy call stay exactly where they
-- are: a duplicate still upgrades the copy you own, and a fresh card still mints
-- the trophy for a set it finishes.

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
    -- Already pulled today.
    RETURN jsonb_build_object('pullId', _row.id, 'cardId', _row.secret_card_id,
      'day', _row.pulled_on, 'duplicate', _row.is_duplicate, 'tier', _row.tier,
      'fresh', false, 'completedCollection', NULL);
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
      'fresh', false, 'completedCollection', NULL);
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
    'fresh', true, 'completedCollection', _trophy);
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

  -- The repair. Same rule and same position as pull_secret_card's.
  IF NOT _dupe AND _participant_id IS NOT NULL THEN
    SELECT c.collection INTO _collection FROM public.secret_cards c WHERE c.id = _card;
    _trophy := public.award_collection_trophy(_participant_id, _collection, 'pull', _event_id);
  END IF;

  RETURN jsonb_build_object('pullId', _row.id, 'cardId', _row.secret_card_id,
    'day', _row.pulled_on, 'duplicate', _row.is_duplicate, 'tier', _row.tier,
    'granted', true, 'completedCollection', _trophy);
END;
$$;

REVOKE ALL ON FUNCTION public.pull_secret_card(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pull_secret_card(uuid, uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.pull_bonus_secret_card(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pull_bonus_secret_card(uuid, uuid, uuid, text) TO service_role;
