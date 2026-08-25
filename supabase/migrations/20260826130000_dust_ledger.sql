-- Dust: what a duplicate is worth.
--
-- The daily loop was strong and shallow — a pack and a secret a day, a good
-- ceremony, and nothing to do with a dupe except trade it. The code called the
-- dupe ceremony "a tax" after the third one. This is the release that gives a
-- spare somewhere to go: a dupe secret pays, a spare roster copy can be milled,
-- and the dust buys a bonus pull or a re-roll of a finish.
--
-- MEMBERS ONLY, deliberately, and this is the one place that decision is written
-- down. card_copies is keyed on a participant, so milling and re-rolling are
-- already unreachable for a guest; a guest ledger would be half an economy —
-- earnable and barely spendable — and every balance read would need a second
-- identity branch. A guest's streak, packs and secrets all carry across
-- claim_guest_secrets and claim_guest_packs. Dust starts at the claim.
--
-- Depends on 20260826120000: mill_card_copy pays by edition, and only for a
-- finish Postgres derived.

-- ============ THE LEDGER ============
CREATE TABLE IF NOT EXISTS public.dust_ledger (
  -- An identity bigint rather than the uuid the rest of the schema uses, for one
  -- reason: a ledger wants a total order, and created_at cannot give one. now()
  -- is transaction-start time, so a debit and a credit written by the same RPC
  -- carry the same timestamp and cannot be told apart by it.
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  participant_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  -- Signed. A sink is a negative row, never a subtraction from a stored total —
  -- there is no stored total. See dust_balance below.
  delta          int  NOT NULL,
  reason         text NOT NULL,
  -- The row this entry is ABOUT: the secret_card_pulls id for a dupe or a bought
  -- pull, the card_copies id for a mill or a re-roll. No foreign key, on purpose
  -- and for the same reason streak_milestone_claims.reward_ref has none — a
  -- mill's ref points at a row that very call deleted. A receipt, not a live
  -- reference.
  ref            uuid,
  detail         jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- A zero-delta row says nothing and still has to be summed.
  CONSTRAINT dust_ledger_delta_nonzero CHECK (delta <> 0),
  -- Append-only vocabulary, like source, via, tier and the award ids: the value
  -- is stored in the column, so renaming one orphans rows. 'milestone' and
  -- 'bounty' have no writer yet and are here so adding one is not a migration.
  CONSTRAINT dust_ledger_reason_ck CHECK (reason IN (
    'dupe_secret', 'mill_copy', 'buy_secret_pull', 'reroll_edition',
    'milestone', 'bounty', 'admin_adjust'))
);

COMMENT ON TABLE public.dust_ledger IS
  'Dust, one row per movement, append-only. Server-only, the card_pulls posture: a balance is a proxy for how deep somebody''s collection is, and ref points straight at secret_card_pulls ids, so publishing it would leak the secret ledger sideways.';

-- Serves both the balance sum and a "recent dust" list.
CREATE INDEX IF NOT EXISTS dust_ledger_owner_idx
  ON public.dust_ledger (participant_id, id DESC);

-- An earn is keyed to the thing that caused it, so a credit cannot land twice
-- however many times a handler retries. Partial and reason-scoped on purpose:
-- reroll_edition is DELIBERATELY re-payable — paying 50 twice for two re-rolls of
-- one copy is the feature — so it is not in this predicate.
CREATE UNIQUE INDEX IF NOT EXISTS dust_ledger_earn_once
  ON public.dust_ledger (participant_id, reason, ref)
  WHERE ref IS NOT NULL AND reason IN ('dupe_secret', 'mill_copy');

ALTER TABLE public.dust_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dust_ledger FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.dust_ledger TO service_role;
-- No policies, on purpose: RLS on with zero policies denies every non-BYPASSRLS
-- role, and the revoked grant denies it a second time. Same shape as card_pulls.

-- NO ALTER PUBLICATION supabase_realtime. Publishing this broadcasts what
-- everybody is spending, which is a live feed of who is about to buy a pull.

-- ============ THE BALANCE ============
-- sum(delta), every time, under whatever lock the caller already holds. A
-- denormalised balance is a second source of truth that drifts the first time a
-- payout path forgets to update it, and the drift is silent and always in
-- somebody's favour. Thirteen people and a few rows a day is not a number that
-- needs caching.
--
-- No CHECK can keep this non-negative — a CHECK is per row and the invariant is
-- over a sum — so the guard is entirely the participant row lock every spending
-- RPC below takes before it reads. That absence is deliberate, not an omission.
CREATE OR REPLACE FUNCTION public.dust_balance(_participant_id uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- COALESCE because an empty ledger is nought rather than NULL, and every caller
  -- compares this against a price: NULL < 150 is NULL, which is not false and
  -- would fall straight through an IF.
  SELECT COALESCE(sum(delta), 0)::int
    FROM public.dust_ledger
   WHERE participant_id = _participant_id;
$$;

REVOKE ALL ON FUNCTION public.dust_balance(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dust_balance(uuid) TO service_role;

-- ============ WHAT A COPY IS WORTH ============
-- 5 / 10 / 20 / 40 / 100, indexed by the ladder that already exists rather than
-- by a second copy of it. card_edition_rank returns 1..5 rarest first and 99 for
-- anything it does not recognise, and ARRAY[...][99] is NULL — so an unknown
-- finish pays the floor instead of raising inside a payout. Mirrored in
-- src/lib/dust.ts, and a db test pins the two together.
CREATE OR REPLACE FUNCTION public.mill_value(_edition text)
RETURNS int
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE((ARRAY[100, 40, 20, 10, 5])[public.card_edition_rank(_edition)], 5);
$$;

REVOKE ALL ON FUNCTION public.mill_value(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mill_value(text) TO service_role;

-- ============ EARN: THE DUPE STING BECOMES THE PAYOUT ============
-- CREATE OR REPLACE with the signature unchanged, so no DROP and no ACL to
-- restore — but the grants are restated at the end anyway, because the rule
-- belongs next to the function rather than inferred from history.
--
-- THE BODY BELOW IS 20260825120000_collection_trophies.sql's, which is the newest
-- definition, plus the credit. Check that before editing it again: 20260825120000
-- re-created accept_trade_offer from a stale copy and silently reverted the named
-- secret cards 20260825000127 had just added to the trade feed, because migrations
-- apply in filename order and both files looked correct in isolation.
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
  IF _dupe AND _participant_id IS NOT NULL THEN
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

REVOKE ALL ON FUNCTION public.pull_secret_card(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pull_secret_card(uuid, uuid, uuid) TO service_role;

-- ============ THE BONUS PULL, WHICH ALSO NEVER MINTED A TROPHY ============
-- Body from 20260824190000_streak_milestone_tier_floors.sql, the newest
-- definition, plus two additions.
--
-- The trophy is a REPAIR rather than a feature of this release. This function was
-- split out of pull_secret_card in 20260824130000, before collection_trophies
-- existed, and 20260825120000 added award_collection_trophy to pull_secret_card,
-- grant_secret_card, accept_trade_offer and claim_guest_secrets — but not here.
-- So a streak milestone that completed a set has been minting nothing since R1,
-- silently. buy_bonus_secret_pull below would make that worse in a way somebody
-- would actually notice: spend 150 dust on the card that finishes your set and
-- get no trophy and no ceremony for it.
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
  IF _dupe AND _participant_id IS NOT NULL THEN
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

REVOKE ALL ON FUNCTION public.pull_bonus_secret_card(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pull_bonus_secret_card(uuid, uuid, uuid, text) TO service_role;

-- ============ EARN: BURNING A SPARE ============
-- LOCK ORDER, which every function in this file obeys and which is what keeps it
-- out of accept_trade_offer's way: participants first, then the rows keyed to
-- them. accept_trade_offer takes two participant rows sorted by id and only then
-- the copies, so it can never hold a card_copies row while still wanting a
-- participants row. Take the copy first "to find its owner" and that reverse edge
-- appears, and with it the first genuine deadlock cycle in this schema. The owner
-- comes from the verified token; the copy is proved to be theirs UNDER the lock.
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

-- ============ SINK: A PULL YOU DID NOT WAIT FOR ============
-- 150 is about a bonus pull a week for somebody playing daily.
--
-- No parameter carries a DEFAULT, here or below. A DEFAULT added to a new
-- parameter later makes an OVERLOAD rather than a replacement, which is the trap
-- 20260824190000 had to DROP pull_bonus_secret_card to escape.
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

-- ============ SINK: ROLLING THE FINISH AGAIN ============
-- 50, and it can go down. See below.
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
