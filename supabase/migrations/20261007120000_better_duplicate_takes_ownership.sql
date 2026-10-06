-- A duplicate secret that rolls better becomes the copy you own. It no longer
-- rewrites the level on the copy you already had.
--
-- Every path that adds a secret copy inserted the new row at its rolled level
-- AND raised the owning row to the same level ("best wins, never down"). That
-- was harmless while a duplicate could only be credited flat. Since per-copy
-- selling and trading (20260829120000) every row is something you can sell,
-- trade or list at its own level, so the raise minted a second copy at the
-- better level: two mythics where one was rolled, and the better roll paid
-- twice at the counter.
--
-- Now no row's tier is ever written after the insert. The better copy takes
-- over ownership instead (`is_duplicate = false`) and the old owner becomes the
-- spare. The vault still shows the best level, because the owning row is still
-- the best one; what changes is that the spare is the copy actually rolled worse.
--
-- promote_best_secret_copy is the one place that decides it, called after the
-- insert or re-parent in every add-a-copy path: open_pack, pull_bonus_secret_card
-- (bonus pull, bought pull and streak rung), grant_secret_card,
-- claim_guest_secrets, merge_guest_pulls, and the receiving side of
-- accept_trade_offer and buy_market_listing, where a better copy arriving by
-- trade or purchase used to stay a duplicate under a worse owner.
--
-- What does not change:
--   * Existing rows. No data migration; copies already doubled stay as they
--     are. The helper only runs when a copy is added, and only re-points
--     ownership for that one card.
--   * resync_secret_ownership, which only fills a gap after a copy LEAVES and
--     which sell_secret_card and the giving side of a trade still rely on.
--   * open_pack's slot shape and the stored pack_opens.cards replay. tierBefore
--     is still the owning row's level read before the insert, so the reveal
--     still says "Upgraded to X"; the slot's pullId is the new row, which is
--     now the owned copy when it rolled better, and "Sell for N" on it pays the
--     level it shows.
--   * claim_streak_milestone, which already freezes reward_tier
--     (20260911120000).
--
-- BODIES LIFTED WHOLE from their newest definitions — open_pack from
-- 20260908165733, pull_bonus_secret_card from 20260829120000, grant_secret_card
-- from 20260825120000, claim_guest_secrets and merge_guest_pulls from
-- 20261006120000, accept_trade_offer and buy_market_listing from 20261006130000
-- — with only the "raise the owned row" UPDATE replaced by the helper (and, in
-- the two guest merges, the "hands its tier over" UPDATE and the inline
-- DISTINCT ON ownership fill dropped, so the helper is the single decider), for the
-- reason 20260930120000 gives: a body retyped from a stale copy silently
-- reverts whatever landed in between. The audit fixes in the two 20261006
-- files (the pack_opens / cards IS NOT NULL predicate, stake voiding with SKIP
-- LOCKED, accept's 'voided' answer) are carried over untouched.

-- ============ WHICH COPY OWNS THE CARD ============
-- Exactly one of _participant_id / _guest_id, the same either-or open_pack takes.
--
-- Best level first, then the copy that already owns it (so a tie never moves
-- ownership), then the oldest — resync_secret_ownership's order, with the owner
-- tiebreak added because that function only ever runs when there is no owner.
--
-- DEMOTE BEFORE PROMOTE. secret_card_pulls_owned_once and
-- secret_card_pulls_guest_owned_once are partial unique indexes, checked per
-- statement and not deferrable, so promoting first would collide with the row
-- it replaces.
--
-- NO LOCKS OF ITS OWN. Every caller already holds the owner's serialisation —
-- the participants row FOR UPDATE for a member, the guest's advisory lock for a
-- guest — and every other writer of these rows takes that lock first. The two
-- UPDATEs below touch only this owner's rows for this one card, so they add row
-- locks under a lock the caller already holds, in no new order.
--
-- The one writer that does not: an accept_trade_offer, reopen_trade_offer or
-- buy_market_listing whose stake is STALE row-locks the staked secret row
-- under its own two participant locks, and that row may since have moved to a
-- third person — whose lock it does not hold. Harmless here. It takes that row
-- lock only after both of its participant locks are granted, and from then on
-- it only re-validates, voids its own already-locked offer or listing and
-- returns; it never waits on the new owner's participant lock. So at worst one
-- side waits for the other's row lock to clear, and neither can be waiting on
-- something the other holds.
CREATE OR REPLACE FUNCTION public.promote_best_secret_copy(
  _participant_id uuid,
  _guest_id       uuid,
  _secret_card_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _best uuid;
  _best_owns boolean;
BEGIN
  IF (_participant_id IS NULL) = (_guest_id IS NULL) THEN
    RAISE EXCEPTION 'Exactly one of participant or guest is required';
  END IF;
  IF _secret_card_id IS NULL THEN RETURN; END IF;

  SELECT p.id, NOT p.is_duplicate INTO _best, _best_owns
    FROM public.secret_card_pulls p
   WHERE p.secret_card_id = _secret_card_id
     AND ((_participant_id IS NOT NULL AND p.participant_id = _participant_id)
       OR (_guest_id       IS NOT NULL AND p.guest_id       = _guest_id))
   ORDER BY public.secret_tier_rank(p.tier) ASC, (NOT p.is_duplicate) DESC,
            p.pulled_on ASC, p.id ASC
   LIMIT 1;

  -- Nothing held, or the best copy already owns it: nothing moves.
  IF _best IS NULL OR _best_owns THEN RETURN; END IF;

  UPDATE public.secret_card_pulls o
     SET is_duplicate = true
   WHERE o.secret_card_id = _secret_card_id
     AND NOT o.is_duplicate
     AND ((_participant_id IS NOT NULL AND o.participant_id = _participant_id)
       OR (_guest_id       IS NOT NULL AND o.guest_id       = _guest_id));

  UPDATE public.secret_card_pulls SET is_duplicate = false WHERE id = _best;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_best_secret_copy(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_best_secret_copy(uuid, uuid, uuid) TO service_role;

-- ============ THE PACK ============
-- Body from 20260908165733 with the raise replaced.

CREATE OR REPLACE FUNCTION public.open_pack(
  _participant_id uuid,
  _guest_id       uuid,
  _event_id       uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
-- The same zone as every other daily thing. This is the pack's midnight now:
-- the device's local date used to decide when the roster re-sealed, and the
-- two clocks drifted apart for anyone up past one of them.
SET timezone = 'America/New_York'
AS $$
DECLARE
  _day        date := current_date;
  _row        public.pack_opens;
  _pick       record;
  _slots      jsonb := '[]'::jsonb;
  _roster     uuid[] := '{}'::uuid[];
  _editions   jsonb := '{}'::jsonb;
  _slot       jsonb;
  _card       uuid;
  _held       int;
  _edition_before text;
  _dupe       boolean;
  _tier_before text;
  _tier       text;
  _pull       public.secret_card_pulls;
  _collection text;
  _trophy     jsonb;
  _n          int;
  _i          int;
BEGIN
  IF (_participant_id IS NULL) = (_guest_id IS NULL) THEN
    RAISE EXCEPTION 'Exactly one of participant or guest is required';
  END IF;

  -- Serialise on the identity, exactly as pull_secret_card did: the row lock
  -- for a member, an advisory lock for a guest who has no row. Two taps racing
  -- each other queue here and the loser reads the winner's pack back.
  IF _participant_id IS NOT NULL THEN
    PERFORM 1 FROM public.participants WHERE id = _participant_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Participant not found'; END IF;
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended(_guest_id::text, 0));
  END IF;

  -- Today's pack, if it has already been dealt.
  --
  -- A row for today WITHOUT cards is one the old client recorded through
  -- record_pack_open on deploy day. It is dealt into rather than refused: the
  -- alternative is a screen with nothing on it, and the daily mint cap bounds
  -- the one-day double to three extra copies.
  SELECT * INTO _row FROM public.pack_opens
   WHERE opened_on = _day
     AND ((_participant_id IS NOT NULL AND participant_id = _participant_id)
       OR (_guest_id IS NOT NULL AND guest_id = _guest_id));
  IF FOUND AND _row.cards IS NOT NULL THEN
    -- A GUEST'S PACK, NOW A MEMBER'S. claim_guest_packs re-parents the row when
    -- a guest claims a player, and a guest's roster slots were never minted
    -- (there was nobody to mint them for). The phone files each one through
    -- adopt_card_copies as it is flipped, but a phone that never comes back
    -- to the pack — or one that claimed from another device — would leave the
    -- cards dealt and never held. So the replay files them here, once: a
    -- guest-shaped slot is one with no `edition` key, and it is marked
    -- `adopted` so the next replay does not look again. adopt_card_copies is
    -- idempotent (one standard copy per card not already held), so the phone
    -- doing the same for the same card is a no-op either way.
    IF _participant_id IS NOT NULL THEN
      SELECT coalesce(array_agg((s->>'id')::uuid), '{}'::uuid[]) INTO _roster
        FROM jsonb_array_elements(_row.cards) AS s
       WHERE s->>'kind' = 'roster' AND NOT (s ? 'edition') AND NOT (s ? 'adopted');
      IF cardinality(_roster) > 0 THEN
        PERFORM public.adopt_card_copies(_participant_id, _roster, NULL);
        SELECT jsonb_agg(
                 CASE WHEN s->>'kind' = 'roster' AND NOT (s ? 'edition') AND NOT (s ? 'adopted')
                      THEN s || '{"adopted": true}'::jsonb
                      ELSE s END)
          INTO _slots
          FROM jsonb_array_elements(_row.cards) AS s;
        UPDATE public.pack_opens SET cards = _slots
         WHERE participant_id = _participant_id AND opened_on = _day;
        _row.cards := _slots;
      END IF;
    END IF;
    SELECT count(*)::int INTO _n FROM public.pack_opens
     WHERE (_participant_id IS NOT NULL AND participant_id = _participant_id)
        OR (_guest_id IS NOT NULL AND guest_id = _guest_id);
    RETURN jsonb_build_object('day', _day, 'fresh', false, 'packsOpened', _n, 'cards', _row.cards);
  END IF;

  -- ONE POOL, THREE DISTINCT PICKS. Efraimidis-Spirakis weighted sampling without
  -- replacement, the same trick pull_secret_card used for one card: each row
  -- draws a key of -ln(u)/w and the three smallest keys win. Ordering by the key
  -- rather than re-rolling per slot is what makes the picks distinct for free.
  FOR _pick IN
    WITH pool AS (
      SELECT ep.id, 'roster'::text AS kind, 100::numeric AS weight
        FROM public.event_participants ep
       WHERE _event_id IS NOT NULL AND ep.event_id = _event_id
      UNION ALL
      SELECT c.id, 'secret'::text, c.weight::numeric
        FROM public.secret_cards c
       WHERE c.active AND c.art_path IS NOT NULL AND c.weight > 0)
    SELECT id, kind FROM pool ORDER BY (-ln(random()) / weight) ASC LIMIT 3
  LOOP
    IF _pick.kind = 'roster' THEN _roster := _roster || _pick.id; END IF;
    _slots := _slots || jsonb_build_object('kind', _pick.kind, 'id', _pick.id);
  END LOOP;

  -- Nothing dealable. No row is written, so the day is not spent.
  IF jsonb_array_length(_slots) = 0 THEN RETURN NULL; END IF;

  -- ---- roster slots ----
  -- A member's copies are minted through record_card_pulls, which already owns
  -- the daily cap, the copy insert, the derived finish and the ownership resync.
  -- Its FOR UPDATE on the participant is a no-op inside this transaction. "Held
  -- before" is read first, because the mint moves it.
  --
  -- A guest mints nothing: card_copies is keyed on a participant, their local
  -- store is their collection until they claim, and adopt_card_copies files it
  -- then. Their roster slots carry just the id.
  IF _participant_id IS NOT NULL AND cardinality(_roster) > 0 THEN
    _editions := COALESCE(
      (public.record_card_pulls(_participant_id, _roster, NULL))->'editions',
      '{}'::jsonb);
  END IF;

  FOR _i IN 0 .. jsonb_array_length(_slots) - 1 LOOP
    _slot := _slots->_i;
    _card := (_slot->>'id')::uuid;

    IF _slot->>'kind' = 'roster' THEN
      IF _participant_id IS NOT NULL THEN
        -- card_pulls is derived from the copies by resync_card_pull, so after
        -- the mint above pull_count already counts this pack. Subtract it back
        -- out: one copy landed today for this card if the mint went through.
        SELECT cp.pull_count, cp.edition INTO _held, _edition_before
          FROM public.card_pulls cp
         WHERE cp.participant_id = _participant_id AND cp.event_participant_id = _card;
        IF NOT FOUND THEN
          _held := 0; _edition_before := NULL;
        ELSIF _editions ? _card::text THEN
          _held := GREATEST(0, _held - 1);
          -- The best finish BEFORE this pack: recomputed over the copies that
          -- were not minted today, because card_pulls.edition already includes
          -- the new one.
          SELECT cc.edition INTO _edition_before
            FROM public.card_copies cc
           WHERE cc.participant_id = _participant_id
             AND cc.event_participant_id = _card
             AND NOT (cc.source = 'pull' AND cc.acquired_on = _day)
           ORDER BY public.card_edition_rank(cc.edition) ASC
           LIMIT 1;
          IF _held = 0 THEN _edition_before := NULL; END IF;
        END IF;
        _slots := jsonb_set(_slots, ARRAY[_i::text], _slot || jsonb_build_object(
          'edition', _editions->_card::text,
          'heldBefore', _held,
          'editionBefore', _edition_before));
      END IF;
      CONTINUE;
    END IF;

    -- ---- secret slots ----
    -- Exactly pull_secret_card's body, minus the one-a-day gate. Ownership is
    -- still one row per card (secret_card_pulls_owned_once); everything after
    -- the first lands as a duplicate, and takes ownership over if it rolled better.
    SELECT o.tier INTO _tier_before FROM public.secret_card_pulls o
     WHERE o.secret_card_id = _card AND NOT o.is_duplicate
       AND ((_participant_id IS NOT NULL AND o.participant_id = _participant_id)
         OR (_guest_id IS NOT NULL AND o.guest_id = _guest_id));
    _dupe := FOUND;
    IF NOT _dupe THEN _tier_before := NULL; END IF;

    _tier := public.roll_secret_tier();

    INSERT INTO public.secret_card_pulls
      (participant_id, guest_id, secret_card_id, pulled_on, event_id, is_duplicate, granted, tier)
    VALUES (_participant_id, _guest_id, _card, _day, _event_id, _dupe, false, _tier)
    RETURNING * INTO _pull;

    -- The better copy owns the card; no row's level is rewritten. tierBefore
    -- was read above, before this could move ownership, so the reveal still
    -- compares against the copy they held.
    IF _dupe THEN
      PERFORM public.promote_best_secret_copy(_participant_id, _guest_id, _card);
    END IF;

    -- Only a card they did not already hold can finish a set, and only a member
    -- can hold a trophy; a guest banks theirs at claim_guest_secrets. Stored on
    -- the slot because award_collection_trophy answers once, and the replay
    -- above has to be able to say it again.
    _trophy := NULL;
    IF NOT _dupe AND _participant_id IS NOT NULL THEN
      SELECT c.collection INTO _collection FROM public.secret_cards c WHERE c.id = _card;
      _trophy := public.award_collection_trophy(_participant_id, _collection, 'pull', _event_id);
    END IF;

    _slots := jsonb_set(_slots, ARRAY[_i::text], _slot || jsonb_build_object(
      'pullId', _pull.id,
      'tier', _tier,
      'duplicate', _dupe,
      'tierBefore', _tier_before,
      'completedCollection', _trophy));
  END LOOP;

  -- The pack itself, through the counter the streak walks. Same row, same
  -- upsert, so a row the old client already wrote today is reused rather than
  -- duplicated -- and then given its cards, once.
  _n := public.record_pack_open(_participant_id, _event_id, jsonb_array_length(_slots), _guest_id);

  UPDATE public.pack_opens
     SET cards = _slots
   WHERE opened_on = _day
     AND cards IS NULL
     AND ((_participant_id IS NOT NULL AND participant_id = _participant_id)
       OR (_guest_id IS NOT NULL AND guest_id = _guest_id));

  RETURN jsonb_build_object('day', _day, 'fresh', true, 'packsOpened', _n, 'cards', _slots);
END;
$$;

REVOKE ALL ON FUNCTION public.open_pack(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_pack(uuid, uuid, uuid) TO service_role;


-- ============ THE BONUS PULL ============
-- Body from 20260829120000 with the raise replaced.

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

  -- A duplicate that rolled better becomes the copy you own, and the old one
  -- the spare; no row's level is rewritten. Same rule as open_pack — and it
  -- needs no floor of its own, because it compares ranks and so a floored tier
  -- takes ownership like any other.
  IF _dupe THEN
    PERFORM public.promote_best_secret_copy(_participant_id, _guest_id, _card);
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
REVOKE ALL ON FUNCTION public.pull_bonus_secret_card(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pull_bonus_secret_card(uuid, uuid, uuid, text) TO service_role;

-- ============ THE COMMISSIONER'S GRANT ============
-- Body from 20260825120000 with the raise replaced.

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
  _collection text;
  _trophy    jsonb;
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
    PERFORM public.promote_best_secret_copy(_participant_id, NULL, _secret_card_id);
  END IF;

  -- The commissioner handing somebody their last card finishes the set exactly
  -- as a pull would. The ceremony cannot fire here — the recipient is somewhere
  -- else in the garden — which is why collection_trophies is published to
  -- realtime. This value is for the admin's own toast.
  IF NOT _already THEN
    SELECT c.collection INTO _collection FROM public.secret_cards c WHERE c.id = _secret_card_id;
    _trophy := public.award_collection_trophy(_participant_id, _collection, 'grant', _event_id);
  END IF;

  RETURN jsonb_build_object(
    'pullId', _row.id,
    'cardId', _row.secret_card_id,
    'day', _row.pulled_on,
    'duplicate', _row.is_duplicate,
    'tier', _row.tier,
    'granted', true,
    'completedCollection', _trophy
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.grant_secret_card(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_secret_card(uuid, uuid, uuid) TO service_role;

-- ============ THE GUEST MERGES ============
-- Bodies from 20261006120000 with the tier hand-over dropped and the promotion added.

CREATE OR REPLACE FUNCTION public.claim_guest_secrets(_participant_id uuid, _guest_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _n int;
  _c record;
  _cards uuid[];
  _card uuid;
BEGIN
  IF _participant_id IS NULL OR _guest_id IS NULL THEN RETURN 0; END IF;

  -- Does double duty, as in pull_secret_card: proves the member exists, and
  -- serialises this merge against every other write that moves or promotes
  -- their secret rows.
  PERFORM 1 FROM public.participants WHERE id = _participant_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  -- And the guest whose rows are about to move, so a pull for that guest
  -- queues behind the merge rather than landing on an id nothing reads again.
  PERFORM pg_advisory_xact_lock(hashtextextended(_guest_id::text, 0));

  -- Only the guest's DAILY pull loses to the member's daily pull. A granted row
  -- — a milestone's reward, a bought pull — spent no slot and keeps its place.
  --
  -- "The member's daily pull" is their dealt pack for that day, not whatever
  -- secret rows they still hold from it: a member who sold today's secret, or
  -- whose pack dealt none, has spent the day all the same. A pack row with no
  -- cards predates server-dealt packs, when the secret was a separate pull, so
  -- it does not count. Every caller runs this
  -- BEFORE claim_guest_packs, so the pack_opens row read here is the member's
  -- own and never the guest's, which has not moved yet.
  DELETE FROM public.secret_card_pulls g
   WHERE g.guest_id = _guest_id
     AND NOT g.granted
     AND (EXISTS (SELECT 1 FROM public.pack_opens po
                   WHERE po.participant_id = _participant_id
                     AND po.opened_on = g.pulled_on
                     AND po.cards IS NOT NULL)
       OR EXISTS (SELECT 1 FROM public.secret_card_pulls m
                   WHERE m.participant_id = _participant_id
                     AND m.pulled_on = g.pulled_on
                     AND NOT m.granted));

  -- The cards about to move, read after the day rule above has dropped what it
  -- drops. A better guest copy no longer hands its tier to the member's row;
  -- each of these gets its best copy promoted once the rows have landed, below.
  SELECT coalesce(array_agg(DISTINCT g.secret_card_id), '{}'::uuid[]) INTO _cards
    FROM public.secret_card_pulls g
   WHERE g.guest_id = _guest_id;

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

  -- Merging two identities must not lose the better roll: for every card that
  -- moved, the best copy now owns it and the rest are spares, with no level
  -- rewritten. A tie keeps the member's own row. The one decider: this also
  -- gives an owner to a card the member held only as duplicates, which an
  -- inline DISTINCT ON used to do first with a tiebreak of its own.
  FOREACH _card IN ARRAY _cards LOOP
    PERFORM public.promote_best_secret_copy(_participant_id, NULL, _card);
  END LOOP;

  -- BANKING A GUEST'S TROPHIES. See 20260825120000_collection_trophies.sql for
  -- why this sweeps every set and why it never raises.
  BEGIN
    FOR _c IN
      SELECT DISTINCT c.collection
        FROM public.secret_card_pulls p
        JOIN public.secret_cards c ON c.id = p.secret_card_id
       WHERE p.participant_id = _participant_id
         AND NOT p.is_duplicate
         AND c.collection IS NOT NULL
    LOOP
      PERFORM public.award_collection_trophy(_participant_id, _c.collection, 'claim', NULL);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN _n;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_guest_secrets(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_guest_secrets(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.merge_guest_pulls(_into_guest uuid, _from_guest uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _n int;
  _cards uuid[];
  _card uuid;
BEGIN
  IF _into_guest IS NULL OR _from_guest IS NULL OR _into_guest = _from_guest THEN
    RETURN 0;
  END IF;

  -- A guest has no row to lock; this is the key pull_secret_card and the streak
  -- claim already serialise on. Both guests, in a fixed order, exactly as
  -- merge_guest_packs does: a pull for either side queues behind the merge, and
  -- two merges pointing at each other cannot deadlock.
  IF _into_guest::text < _from_guest::text THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(_into_guest::text, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended(_from_guest::text, 0));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended(_from_guest::text, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended(_into_guest::text, 0));
  END IF;

  -- The same rule as claim_guest_secrets: a day the destination guest was
  -- dealt a pack is spent, whether or not they still hold what it dealt. Runs before
  -- merge_guest_packs, so the row read here is the destination's own.
  DELETE FROM public.secret_card_pulls g
   WHERE g.guest_id = _from_guest
     AND NOT g.granted
     AND (EXISTS (SELECT 1 FROM public.pack_opens po
                   WHERE po.guest_id = _into_guest
                     AND po.opened_on = g.pulled_on
                     AND po.cards IS NOT NULL)
       OR EXISTS (SELECT 1 FROM public.secret_card_pulls m
                   WHERE m.guest_id = _into_guest
                     AND m.pulled_on = g.pulled_on
                     AND NOT m.granted));

  -- The cards about to move, for the promotion below — the same rule as
  -- claim_guest_secrets, in place of the tier hand-over.
  SELECT coalesce(array_agg(DISTINCT g.secret_card_id), '{}'::uuid[]) INTO _cards
    FROM public.secret_card_pulls g
   WHERE g.guest_id = _from_guest;

  UPDATE public.secret_card_pulls g
     SET is_duplicate = true
   WHERE g.guest_id = _from_guest
     AND NOT g.is_duplicate
     AND EXISTS (SELECT 1 FROM public.secret_card_pulls m
                  WHERE m.guest_id = _into_guest
                    AND m.secret_card_id = g.secret_card_id
                    AND NOT m.is_duplicate);

  UPDATE public.secret_card_pulls
     SET guest_id = _into_guest
   WHERE guest_id = _from_guest;

  GET DIAGNOSTICS _n = ROW_COUNT;

  -- The best copy of each card that moved owns it — including one the
  -- destination held only as duplicates. A tie keeps the destination's own row.
  -- promote_best_secret_copy is the one decider, as in claim_guest_secrets.
  FOREACH _card IN ARRAY _cards LOOP
    PERFORM public.promote_best_secret_copy(NULL, _into_guest, _card);
  END LOOP;

  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_guest_pulls(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_guest_pulls(uuid, uuid) TO service_role;

-- ============ THE ACCEPT ============
-- Body from 20261006130000 with the receiver's promotion added.

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
  --
  -- A VOIDED offer says so. Since this migration most voids happen off-screen —
  -- another accept or a market buy moved one of its copies — and the recipient
  -- may still have it in an inbox rendered before that. 'resolved' told them
  -- somebody had answered it; 'voided' is the truth, and the same answer the
  -- re-validation below gives when it is the one that finds the copy gone.
  IF _offer.status = 'voided' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'voided');
  END IF;
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
      -- The receiver's side is settled after the trophy loop below.
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

  -- A BETTER COPY ARRIVING TAKES OWNERSHIP, the rule every other way of adding
  -- a copy follows. Before this a better copy received in a trade sat as a
  -- duplicate under a worse owner. After the trophy loop on purpose: that loop
  -- reads a moved row's `is_duplicate` as "the receiver did not hold this card
  -- before", and a promotion here would make an arrival that took over an
  -- existing card look like a new one. Still inside both participant locks.
  FOR _rec IN
    SELECT DISTINCT sp.participant_id AS receiver_id, sp.secret_card_id
      FROM public.trade_offer_items i
      JOIN public.secret_card_pulls sp ON sp.id = i.secret_pull_id
     WHERE i.offer_id = _offer_id
       AND i.kind = 'secret'
  LOOP
    PERFORM public.promote_best_secret_copy(_rec.receiver_id, NULL, _rec.secret_card_id);
  END LOOP;

  -- THE PUBLIC RECORD, built by trade_summary and nowhere else. It used to be two
  -- copies of one query inlined here, which is how it got lost: 20260825000127
  -- taught both of them to name the secret, and 20260825120000 re-created this
  -- function from a copy that predated that and silently reverted it. Migrations
  -- apply in filename order, both files looked right in isolation, and nothing
  -- failed. One definition cannot drift from itself.
  _proposer_gave := public.trade_summary(_offer_id, 'proposer');

  _recipient_gave := public.trade_summary(_offer_id, 'recipient');

  UPDATE public.trade_offers
     SET status = 'accepted', resolved_at = now()
   WHERE id = _offer_id;

  INSERT INTO public.trades
    (event_id, offer_id, proposer_id, recipient_id, proposer_gave, recipient_gave)
  VALUES (_offer.event_id, _offer_id, _offer.proposer_id, _offer.recipient_id,
          _proposer_gave, _recipient_gave)
  RETURNING id INTO _trade_id;

  -- EVERY OTHER STAKE ON A COPY THAT JUST MOVED GOES WITH IT. Stakes are
  -- copy-specific: an offer or a listing names this row, not the card, so once the
  -- row has a new owner nothing still naming it can ever settle — the accept or
  -- buy re-validation would void it. Left standing, though, it blocked the NEW
  -- owner: mill, sell and re-roll refuse a copy staked on ANY pending offer or
  -- active listing, and list_card_for_dust answers already_listed and counts the
  -- stale offer against their commitments. They could not use a card they owned
  -- until somebody else pressed a button.
  --
  -- Voided here rather than loosening those checks to "staked by the current
  -- owner": trade_offer_items and market_listings cascade from the copy, so
  -- milling a copy somebody else's offer still names would silently shrink that
  -- offer, and a smaller offer can still be accepted.
  --
  -- Only offers naming a MOVED row. One staking a different copy of the same card
  -- is untouched — trading away one of three copies does not invalidate an offer
  -- on another. The listing gets 'voided', the word buy_market_listing already
  -- writes for one whose card had moved on.
  --
  -- SKIP LOCKED, because a row somebody else holds is one an accept, buy or
  -- answer is already deciding: those take the offer (or listing) first and the
  -- participants second, so waiting here, under the participant locks, is a
  -- deadlock. Whatever is holding it re-validates under the participant locks
  -- once this commits and finds the copy gone.
  UPDATE public.trade_offers o
     SET status = 'voided', resolved_at = now()
   WHERE o.id IN (
     SELECT s.id FROM public.trade_offers s
      WHERE s.status = 'pending'
        AND s.id <> _offer_id
        AND s.id IN (
          SELECT i.offer_id FROM public.trade_offer_items i
           WHERE i.card_copy_id IN (SELECT m.card_copy_id FROM public.trade_offer_items m
                                     WHERE m.offer_id = _offer_id AND m.card_copy_id IS NOT NULL)
              OR i.secret_pull_id IN (SELECT m.secret_pull_id FROM public.trade_offer_items m
                                       WHERE m.offer_id = _offer_id AND m.secret_pull_id IS NOT NULL))
        FOR NO KEY UPDATE OF s SKIP LOCKED);

  UPDATE public.market_listings l
     SET status = 'voided', resolved_at = now()
   WHERE l.id IN (
     SELECT x.id FROM public.market_listings x
      WHERE x.status = 'active'
        AND (x.card_copy_id IN (SELECT m.card_copy_id FROM public.trade_offer_items m
                                 WHERE m.offer_id = _offer_id AND m.card_copy_id IS NOT NULL)
          OR x.secret_pull_id IN (SELECT m.secret_pull_id FROM public.trade_offer_items m
                                   WHERE m.offer_id = _offer_id AND m.secret_pull_id IS NOT NULL))
        FOR NO KEY UPDATE OF x SKIP LOCKED);

  RETURN jsonb_build_object('ok', true, 'tradeId', _trade_id,
                            'completedCollections', _trophies);
END;
$$;

REVOKE ALL ON FUNCTION public.accept_trade_offer(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_trade_offer(uuid, uuid) TO service_role;

-- ============ THE SALE ============
-- Body from 20261006130000 with the buyer's promotion added.

CREATE OR REPLACE FUNCTION public.buy_market_listing(
  _participant_id uuid,
  _listing_id     uuid,
  _request_id     uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET timezone = 'America/New_York'
AS $$
DECLARE
  _listing    public.market_listings;
  _copy       public.card_copies;
  _pull       public.secret_card_pulls;
  _lo         uuid;
  _hi         uuid;
  _bal        int;
  _dupe       boolean;
  _collection text;
  _trophy     jsonb;
  _prior      jsonb;
  _out        jsonb;
BEGIN
  IF _participant_id IS NULL OR _listing_id IS NULL OR _request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- BEFORE THE LOCK AND BEFORE ANYTHING ELSE. A refused call should touch no
  -- rows at all, and this is the cheapest possible way to say no.
  IF NOT public.dust_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'disabled');
  END IF;

  -- The listing first, and this row lock is what serialises two buyers racing the
  -- same shelf entry: the loser blocks here and reads `sold` on the other side.
  SELECT * INTO _listing FROM public.market_listings
   WHERE id = _listing_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  -- Buying your own listing would move a copy to itself and write a pair of
  -- ledger rows that cancel out — harmless, and still meaningless. Refused with a
  -- reason of its own so the button can say "that one's yours" rather than
  -- pretending something happened.
  IF _listing.seller_id = _participant_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'own_listing');
  END IF;

  -- DETERMINISTIC LOCK ORDER, and the reason is the mirror-image case:
  -- Alice buying Bob's listing at the same instant Bob buys Alice's. Locking
  -- "seller then buyer" would have the two transactions take the same two rows in
  -- opposite orders, which is a deadlock. Sorted, they queue instead. These are
  -- also the rows pull_secret_card and every dust RPC lock, so a sale and a daily
  -- pull touching the same person serialise against each other for free.
  _lo := least(_listing.seller_id, _participant_id);
  _hi := greatest(_listing.seller_id, _participant_id);
  PERFORM 1 FROM public.participants WHERE id = _lo FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  PERFORM 1 FROM public.participants WHERE id = _hi FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  -- A lost response on a purchase is the worst bug this feature could ship, and
  -- the listing id alone cannot key it — a retry and a genuine second attempt on
  -- the same listing are indistinguishable by it. Same rule as
  -- buy_bonus_secret_pull: the caller mints one id per tap and reuses it on retry.
  SELECT detail INTO _prior FROM public.dust_ledger
   WHERE participant_id = _participant_id
     AND reason = 'market_buy'
     AND detail->>'requestId' = _request_id::text;
  IF FOUND THEN RETURN _prior->'outcome'; END IF;

  -- AND THE STATUS CHECK COMES AFTER THE REPLAY, WHICH IS THE WHOLE POINT OF THE
  -- ORDER. A retry of a SUCCESSFUL buy finds the listing already 'sold' — sold to
  -- this very caller — so a status check placed first would answer somebody's own
  -- purchase with a refusal and leave them looking for the dust they spent. The
  -- replay above hands back what they already bought; only a caller who has NOT
  -- bought this listing reaches here.
  --
  -- Returned rather than raised: somebody else got there first, or the seller took
  -- it down, or it voided. 'resolved' is the word accept_trade_offer already uses.
  IF _listing.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'resolved');
  END IF;

  -- Lock the staked row before re-reading it, so the re-validation below and the
  -- transfer after it see the same world.
  IF _listing.kind = 'roster' THEN
    SELECT * INTO _copy FROM public.card_copies
     WHERE id = _listing.card_copy_id FOR UPDATE;
  ELSE
    SELECT * INTO _pull FROM public.secret_card_pulls
     WHERE id = _listing.secret_pull_id FOR UPDATE;
  END IF;

  -- RE-VALIDATE, then VOID AND RETURN rather than RAISE. A raise would roll the
  -- transaction back, and the void written just above it with it — leaving the
  -- listing active and the same failure waiting on every retry. This is where a
  -- card the seller has since milled or sold leaves the shelf. (One they traded
  -- is already off it: accept_trade_offer voids the listings of every copy it
  -- moves, since 20261006130000. This stays as the backstop for a listing that
  -- accept had to skip because this very buy held its lock.)
  --
  -- trade_item_is_spare answers ownership and spare-ness in one call: its roster
  -- branch requires the copy to still be the seller's AND a second one to remain,
  -- which is what keeps the seller's card_pulls row — the public "Packed by N" —
  -- alive through the sale. Two listings of a pair both selling is exactly what
  -- this catches: the first sale leaves one copy, so the second fails here.
  IF NOT public.trade_item_is_spare(
           _listing.seller_id, _listing.kind, _listing.card_copy_id, _listing.secret_pull_id) THEN
    UPDATE public.market_listings
       SET status = 'voided', resolved_at = now()
     WHERE id = _listing_id;
    RETURN jsonb_build_object('ok', false, 'reason', 'voided');
  END IF;

  -- The lock came before this read, and that ordering is the entire overdraft
  -- guard. Reading first lets two concurrent buys both see the same balance and
  -- both spend it; there is no CHECK that can catch it, because the invariant is
  -- over a sum. Under READ COMMITTED this is a separate statement taking a fresh
  -- snapshot AFTER the lock is granted, so the second buy sees the first's debit.
  _bal := public.dust_balance(_participant_id);
  IF _bal < _listing.price THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient',
                              'balance', _bal, 'price', _listing.price);
  END IF;

  -- ONE STATEMENT, TWO ROWS, SUMMING TO ZERO, and the single statement is the
  -- point rather than a tidiness. "No house cut, nothing minted" is then a
  -- property of one INSERT rather than of two INSERTs staying in step across
  -- every future edit — there is no code path that can write a debit without its
  -- credit. dust_ledger_earn_once keys on (participant_id, reason, ref) and these
  -- two differ in BOTH of the first two columns, so they cannot collide with each
  -- other; the index only catches a genuine repeat of either.
  --
  -- And the money moves BEFORE the card does, the rule buy_bonus_secret_pull
  -- keeps: reversed, a payout that raised would already have handed over a card
  -- nobody paid for.
  INSERT INTO public.dust_ledger (participant_id, delta, reason, ref, detail)
  VALUES (_participant_id, -_listing.price, 'market_buy', _listing_id,
          jsonb_build_object('requestId', _request_id,
                             'listingId', _listing_id,
                             'sellerId', _listing.seller_id,
                             'kind', _listing.kind)),
         (_listing.seller_id, _listing.price, 'market_sale', _listing_id,
          jsonb_build_object('listingId', _listing_id,
                             'buyerId', _participant_id,
                             'kind', _listing.kind))
  -- The backstop under the status flip above, which is the real guard: a listing
  -- goes 'sold' once, so a second buy is refused before it reaches here.
  ON CONFLICT DO NOTHING;

  -- ---- AND ONLY THEN THE CARD ----
  IF _listing.kind = 'roster' THEN
    -- THE FINISH TRAVELS, because the copy does — the same re-parenting
    -- accept_trade_offer does rather than copying a person-level best from one row
    -- to another. edition_asserted_by travels untouched too, so a copy Postgres
    -- rolled still mills at its full rate for the buyer and a hand-asserted one
    -- still mills at the floor. Buying cannot launder a forged finish.
    --
    -- acquired_on is cleared for the reason the accept clears it: the buyer may
    -- have pulled this very card today, and a bought copy carrying that date would
    -- collide on card_copies_one_pull_per_day and abort the whole sale. It is also
    -- true on its own terms — a card you bought was not your pull for that day.
    UPDATE public.card_copies
       SET participant_id = _participant_id,
           source         = 'market',
           acquired_on    = NULL
     WHERE id = _listing.card_copy_id;

    -- Both sides recomputed from the copies they now hold. The seller's best
    -- finish can FALL here — sell your only platinum and standard is the honest
    -- answer — which is the second place in the app where that column moves down.
    PERFORM public.resync_card_pull(_listing.seller_id, _copy.event_participant_id);
    PERFORM public.resync_card_pull(_participant_id, _copy.event_participant_id);
  ELSE
    -- Does the buyer already own this one? An already-owned card arrives as a
    -- duplicate rather than a second ownership row, which is what
    -- secret_card_pulls_owned_once requires.
    SELECT EXISTS (
      SELECT 1 FROM public.secret_card_pulls o
       WHERE o.participant_id = _participant_id
         AND o.secret_card_id = _pull.secret_card_id
         AND NOT o.is_duplicate
    ) INTO _dupe;

    -- granted = true ALWAYS, and it is the single most important line in this
    -- branch. secret_card_pulls_one_per_day is UNIQUE (participant_id, pulled_on)
    -- WHERE NOT granted: leave granted false and re-parenting the row aborts the
    -- whole sale whenever the buyer already pulled on the day the bought copy was
    -- pulled — which, since everyone pulls daily, is the common case. It is also
    -- what stops a bought secret masquerading as the buyer's unspent daily slot.
    --
    -- tier travels with the row untouched. Unlike an edition it is server-rolled
    -- by roll_secret_tier(), so it is a fact about the copy rather than a claim.
    UPDATE public.secret_card_pulls
       SET participant_id = _participant_id,
           is_duplicate   = _dupe,
           granted        = true
     WHERE id = _listing.secret_pull_id;

    -- The seller may have just handed over the row that said they own this card.
    -- If they still hold copies one of them takes over; if they held only the one,
    -- they own none of it now, which is exactly what selling it means.
    PERFORM public.resync_secret_ownership(_listing.seller_id, _pull.secret_card_id);

    -- And on the buyer's side a better copy arriving takes ownership, the rule
    -- every other way of adding a copy follows. The trophy check below reads
    -- _dupe, not the row, so this cannot make an arrival look like a new card.
    IF _dupe THEN
      PERFORM public.promote_best_secret_copy(_participant_id, NULL, _pull.secret_card_id);
    END IF;
  END IF;

  UPDATE public.market_listings
     SET status = 'sold', buyer_id = _participant_id, resolved_at = now()
   WHERE id = _listing_id;

  -- And the offers that named the copy just bought, for the reason accept_trade_offer
  -- gives at length (20261006130000): they can never settle now, and left pending
  -- they stop the buyer milling, selling, re-rolling or listing what they paid for.
  -- SKIP LOCKED for the same deadlock: an accept holds its offer before it waits
  -- on the participant rows this buy holds, and re-validates once this commits.
  UPDATE public.trade_offers o
     SET status = 'voided', resolved_at = now()
   WHERE o.id IN (
     SELECT s.id FROM public.trade_offers s
      WHERE s.status = 'pending'
        AND s.id IN (
          SELECT i.offer_id FROM public.trade_offer_items i
           WHERE (_listing.kind = 'roster' AND i.card_copy_id = _listing.card_copy_id)
              OR (_listing.kind = 'secret' AND i.secret_pull_id = _listing.secret_pull_id))
        FOR NO KEY UPDATE OF s SKIP LOCKED);

  -- WHAT THIS SALE FINISHED. After resync_secret_ownership has settled, for the
  -- reason accept_trade_offer hoists its own trophy loop out of the transfer: a
  -- set can read complete against a row that is about to move on. Singular here,
  -- unlike the accept — one card changes hands, so at most one set can close.
  --
  -- via = 'trade' rather than a sixth value in collection_trophies' vocabulary. A
  -- purchase IS a card changing hands between two members, the column is
  -- append-only, and widening it would mean dropping an auto-named inline CHECK
  -- for a distinction nothing reads.
  IF _listing.kind = 'secret' AND NOT _dupe THEN
    SELECT c.collection INTO _collection
      FROM public.secret_cards c WHERE c.id = _pull.secret_card_id;
    IF _collection IS NOT NULL THEN
      _trophy := public.award_collection_trophy(
                   _participant_id, _collection, 'trade', _listing.event_id);
    END IF;
  END IF;

  _out := jsonb_build_object('ok', true,
    'price', _listing.price,
    'kind', _listing.kind,
    'sellerId', _listing.seller_id,
    'eventParticipantId', _copy.event_participant_id,
    'edition', _copy.edition,
    'secretCardId', _pull.secret_card_id,
    'tier', _pull.tier,
    'duplicate', COALESCE(_dupe, false),
    'completedCollection', _trophy,
    'balance', public.dust_balance(_participant_id));

  -- Filed onto the debit so a retry that lost its response is answered with the
  -- sale it already made rather than a second one. Same shape as
  -- reroll_copy_edition and buy_bonus_secret_pull.
  UPDATE public.dust_ledger
     SET detail = detail || jsonb_build_object('outcome', _out)
   WHERE participant_id = _participant_id
     AND reason = 'market_buy'
     AND detail->>'requestId' = _request_id::text;

  RETURN _out;
END;
$$;

REVOKE ALL ON FUNCTION public.buy_market_listing(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.buy_market_listing(uuid, uuid, uuid) TO service_role;
