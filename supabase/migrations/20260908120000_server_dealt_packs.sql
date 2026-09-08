-- The pack is dealt here now, and a secret is just a card in it.
--
-- Until this migration a pack was three roster cards dealt ON THE PHONE from a
-- seed, reported afterwards through record_card_pulls, plus a separate fourth
-- card: the daily secret, drawn by pull_secret_card and never a secret you
-- already owned while one was left to find. That was two authorities over one
-- pack, two midnights (the device's for the roster, the league's for the
-- secret), and a long comment in card-pulls.functions.ts admitting a phone
-- could post its own roster ids.
--
-- Now one RPC deals three slots from ONE pool -- every roster card of the
-- active event and every active secret -- owned or not, purely at random.
-- Roster cards join at weight 100, the secret default, so a default-weight
-- secret and a roster card are equally likely and the commissioner's weights
-- still tune the secrets against each other. The rarity ladders are untouched:
-- a roster slot's finish is still roll_card_edition, a secret slot's level is
-- still roll_secret_tier, and a duplicate secret still upgrades the copy you
-- own. What changed is only WHICH cards can be in the pack.
--
-- The dealt slots are stored on pack_opens as jsonb rather than in a child
-- table: that row is already one per identity per league day, so it is the
-- natural key for "give me the same pack again", and claim_guest_packs /
-- merge_guest_packs re-parent whole rows so the slots travel with them for
-- free. A pack is history and must survive a card being deleted later, which is
-- also why the slots carry no foreign keys.

-- ============ THE PACK ROW CARRIES ITS CARDS ============
ALTER TABLE public.pack_opens ADD COLUMN IF NOT EXISTS cards jsonb;

COMMENT ON COLUMN public.pack_opens.cards IS
  'The three slots as dealt, in order, written once by open_pack. NULL on rows from before the server dealt packs. Each slot is {kind, id, ...} -- see open_pack for the shapes.';

-- ============ MORE THAN ONE SECRET A DAY ============
-- A pack can now hold two or three secrets, so the one-per-day rule the old
-- fourth card rested on has to go. Plain indexes replace the unique ones so the
-- today-lookups in sell_secret_card and trade_item_is_spare stay indexed. The
-- owned-once indexes are untouched: a card is still owned exactly once.
--
-- pull_secret_card was the only function whose ON CONFLICT targeted these
-- indexes, and it is replaced outright below rather than left to fail at call
-- time.
DROP INDEX IF EXISTS public.secret_card_pulls_one_per_day;
DROP INDEX IF EXISTS public.secret_card_pulls_guest_one_per_day;

CREATE INDEX IF NOT EXISTS secret_card_pulls_day_idx
  ON public.secret_card_pulls (participant_id, pulled_on)
  WHERE participant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS secret_card_pulls_guest_day_idx
  ON public.secret_card_pulls (guest_id, pulled_on)
  WHERE guest_id IS NOT NULL;

DROP FUNCTION IF EXISTS public.pull_secret_card(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.secret_pull_status(uuid, uuid);

-- ============ THE DEAL ============
-- Returns NULL when there is nothing to deal at all (no event and no secrets).
-- Otherwise:
--
--   { day, fresh, packsOpened, cards: [slot, slot, slot] }
--
-- where a roster slot is
--   {kind:'roster', id, edition, heldBefore, editionBefore}   -- member
--   {kind:'roster', id}                                       -- guest
-- and a secret slot is
--   {kind:'secret', id, pullId, tier, duplicate, tierBefore, completedCollection}
--
-- `fresh` is false when today's row already existed, in which case the stored
-- slots come back byte-for-byte: a reload, a double tap and a second phone all
-- see the same pack. `edition` is NULL when record_card_pulls rationed the mint
-- (the daily cap) or dropped an id it did not know; the client renders standard
-- and stays quiet, the same rule it already had for a finish not yet answered.
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
    -- the first is a duplicate that can only ever raise the copy you own.
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

    -- Best wins, never down.
    IF _dupe THEN
      UPDATE public.secret_card_pulls o
         SET tier = _tier
       WHERE o.secret_card_id = _card
         AND NOT o.is_duplicate
         AND ((_participant_id IS NOT NULL AND o.participant_id = _participant_id)
           OR (_guest_id IS NOT NULL AND o.guest_id = _guest_id))
         AND public.secret_tier_rank(_tier) < public.secret_tier_rank(o.tier);
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

-- ============ IS THERE A PACK TODAY ============
-- A pure read, replacing secret_pull_status. Opening the pack screen must never
-- spend the pack. Says whether today's pack has been opened and how many secrets
-- this identity owns -- never how many exist, and no longer whether "something
-- is available": a pack is always available, and a secret in it is a surprise.
CREATE OR REPLACE FUNCTION public.pack_status(
  _participant_id uuid,
  _guest_id       uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET timezone = 'America/New_York'
AS $$
DECLARE _day date := current_date;
BEGIN
  RETURN jsonb_build_object(
    'day', _day,
    'openedToday', EXISTS (
      SELECT 1 FROM public.pack_opens
       WHERE opened_on = _day
         AND ((_participant_id IS NOT NULL AND participant_id = _participant_id)
           OR (_guest_id IS NOT NULL AND guest_id = _guest_id))),
    'secretsOwned', (
      SELECT count(*) FROM public.secret_card_pulls
       WHERE NOT is_duplicate
         AND ((_participant_id IS NOT NULL AND participant_id = _participant_id)
           OR (_guest_id IS NOT NULL AND guest_id = _guest_id))),
    'resetsAt', ((_day + 1)::timestamp AT TIME ZONE current_setting('TimeZone'))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pack_status(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pack_status(uuid, uuid) TO service_role;
