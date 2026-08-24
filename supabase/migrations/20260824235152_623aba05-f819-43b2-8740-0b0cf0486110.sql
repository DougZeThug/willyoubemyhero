-- Completion trophies: the one moment a set's size is allowed across the wire.
--
-- Everything else in the secret-card feature exists to withhold that number.
-- SecretBackPanel refuses to print "3 of 12", getSecretCollections hands back
-- names and order and no sizes, and secret_cards is not published to realtime so
-- a row count cannot be inferred from a broadcast. Not knowing how much is left
-- is what makes the daily pull worth taking.
--
-- Finishing a set is the designed exception, because there the number IS the
-- prize: "you have all nine" means nothing if you never learn there were nine.
-- An UNFINISHED set stays exactly as silent as it was — the size only ever
-- leaves the database attached to a trophy that was just minted, or to one
-- already sitting in this table.
--
-- Detection lives in SQL rather than in a server function on purpose. It has to
-- be atomic with the write that caused it: two cards of the same set arriving at
-- once (a pull and an accepted trade) would otherwise both read "not complete"
-- and nobody would ever be told. Every caller here already holds the participant
-- row lock, so the check runs inside it for free.

-- ============ THE TABLE ============
--
-- Public + realtime, the `trades` shape rather than the `card_pulls` one. Three
-- reasons it is worth publishing what everything else in this feature hides:
--
--   1. A finished set is meant to be lore. Other people's trophies showing up on
--      their player page is most of the point.
--   2. `grant_secret_card` runs on the commissioner's phone and the person who
--      just completed a set is somewhere else in the garden. There is no other
--      channel that reaches them — grantSecretCard can only invalidate the admin's
--      own query key.
--   3. Nothing here is secret once it exists. The row says a set was finished and
--      how big it was; both are facts the completion response already published.
--
-- Keyed (participant, collection) with no guest half, unlike
-- streak_milestone_claims. A guest CAN finish a set — pull_secret_card has a
-- guest branch — but the trophy is banked by claim_guest_secrets at the moment
-- their pulls become somebody's, which is below. A public table wants a name on
-- every row, and "claim your player to bank your trophy" is a better nudge than
-- a nameless row nobody can render.
CREATE TABLE IF NOT EXISTS public.collection_trophies (
  participant_id     uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  -- The first foreign key into secret_collections. secret_cards.collection is
  -- unconstrained text — it has never had one — which is exactly why
  -- award_collection_trophy checks the set exists before inserting rather than
  -- letting a typo'd id abort the pull that called it.
  --
  -- RESTRICT, not CASCADE: deleting a set somebody finished would quietly erase
  -- the trophy. deleteSecretCollection turns that into a sentence.
  collection_id      text NOT NULL REFERENCES public.secret_collections(id) ON DELETE RESTRICT,
  completed_on       date NOT NULL,
  -- How big the set was on the day it was finished, not how big it is now.
  -- Adding a fourteenth card to a set somebody completed at thirteen does not
  -- take their trophy away, and this column is why the shelf can still say what
  -- they actually did.
  size_at_completion int  NOT NULL CHECK (size_at_completion > 0),
  -- Append-only, like every other stored vocabulary in this app: the value is in
  -- the table, so renaming one orphans rows. 'claim' is the guest carry below;
  -- 'backfill' is the one-time sweep at the bottom of this file, named the same
  -- way card_copies.source names its own.
  via                text NOT NULL CHECK (via IN ('pull', 'trade', 'grant', 'claim', 'backfill')),
  event_id           uuid REFERENCES public.events(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- The whole idempotence story. Every acquiring path calls the helper below on
  -- every acquisition; this is what makes the second call silent.
  PRIMARY KEY (participant_id, collection_id)
);

COMMENT ON TABLE public.collection_trophies IS
  'One row per person per finished secret-card set. Public: this is the only place a set size is allowed to be readable.';

ALTER TABLE public.collection_trophies ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.collection_trophies TO anon, authenticated;
GRANT ALL ON public.collection_trophies TO service_role;

DROP POLICY IF EXISTS "collection trophies public read" ON public.collection_trophies;
CREATE POLICY "collection trophies public read"
  ON public.collection_trophies FOR SELECT USING (true);

-- Read-only for anon, and the write side is a server function holding
-- service_role. A forged row here is a trophy for a set somebody never finished,
-- announced on their player page.

-- Guarded exactly like the `trades` publication add, so this migration replays.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'collection_trophies'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.collection_trophies;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS collection_trophies_collection_idx
  ON public.collection_trophies (collection_id);

-- ============ THE DETECTOR ============
--
-- "Do they now own every active card in this set, and if so, is this the first
-- time anybody has said so?"
--
-- Returns NULL in every case except a trophy MINTED BY THIS CALL. That is what
-- lets the three acquiring RPCs pass the result straight into their response and
-- have the ceremony fire exactly once: a second pull from a finished set gets
-- NULL from the ON CONFLICT below, not a second reveal.
--
-- No parameter defaults, deliberately. A DEFAULT on a parameter added later
-- creates an OVERLOAD rather than a replacement, which is the trap
-- 20260824190000 had to DROP pull_bonus_secret_card to escape.
CREATE OR REPLACE FUNCTION public.award_collection_trophy(
  _participant_id uuid,
  _collection     text,
  _via            text,
  _event_id       uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
-- It stamps completed_on from current_date, so it is the sixth daily thing in
-- this app and belongs in the same zone as the other five. Fixed here rather
-- than passed in for the reason claim_streak_milestone states: a phone with a
-- wrong clock must not get to decide what day it is.
SET timezone = 'America/New_York'
AS $$
DECLARE
  _size  int;
  _owned int;
  _label text;
  _day   date := current_date;
BEGIN
  IF _participant_id IS NULL THEN RETURN NULL; END IF;

  -- Unsorted is not a set. `= ''` as well as NULL because the column is
  -- unconstrained text and holds both — groupBySecretCollection uses `||` rather
  -- than `??` for the same reason, and a trophy for "" would be a trophy for a
  -- shelf with no name.
  IF _collection IS NULL OR _collection = '' THEN RETURN NULL; END IF;

  -- Checked rather than trusted, for two different failures. An id that is not in
  -- secret_collections violates the foreign key above, and a raise here would
  -- abort the PULL that called this — somebody loses their card because an admin
  -- typo'd a set name. A set that exists but is hidden should not be minting
  -- public trophies either.
  --
  -- The label comes back with it so the ceremony has everything it needs from the
  -- one response. Looking it up client-side would work, but the acquiring
  -- response is the ONLY place a completion is announced — an admin grant never
  -- reaches the recipient's phone at all — and a second round trip is a second
  -- thing that can be missing at the moment it matters.
  SELECT label INTO _label FROM public.secret_collections WHERE id = _collection AND active;
  IF _label IS NULL THEN RETURN NULL; END IF;

  -- The set, and how much of it they hold, in one pass.
  --
  -- `active AND art_path IS NOT NULL` is the whole definition. Note what is NOT
  -- here: `weight > 0`. Weight removes a card from the daily draw without
  -- retiring it (see 20260728231834) — it is still real, still tradeable, still
  -- grantable — so it still counts. Excluding it would mean an admin nudging a
  -- weight to 0 silently finished somebody's set for them.
  --
  -- NOT is_duplicate is the ownership marker; four things in this schema read it
  -- that way and this is the fifth.
  SELECT count(*)::int,
         count(*) FILTER (
           WHERE EXISTS (SELECT 1 FROM public.secret_card_pulls p
                          WHERE p.secret_card_id = c.id
                            AND p.participant_id = _participant_id
                            AND NOT p.is_duplicate))::int
    INTO _size, _owned
    FROM public.secret_cards c
   WHERE c.collection = _collection
     AND c.active
     AND c.art_path IS NOT NULL;

  -- An empty set is not a finished set. Without this, a collection whose cards
  -- were all deactivated completes vacuously for all thirteen people at once, on
  -- whatever they happen to pull next.
  IF _size = 0 OR _owned < _size THEN RETURN NULL; END IF;

  -- DO NOTHING and then check what came back, rather than an EXISTS beforehand:
  -- the EXISTS would be a second read of a row this statement is about to take a
  -- lock on anyway, and under two concurrent acquisitions it is the version that
  -- can hand two callers the same trophy.
  INSERT INTO public.collection_trophies
    (participant_id, collection_id, completed_on, size_at_completion, via, event_id)
  VALUES (_participant_id, _collection, _day, _size, _via, _event_id)
  ON CONFLICT (participant_id, collection_id) DO NOTHING;

  IF NOT FOUND THEN RETURN NULL; END IF;

  RETURN jsonb_build_object('collection', _collection, 'label', _label,
                            'size', _size, 'completedOn', _day);
END;
$$;

REVOKE ALL ON FUNCTION public.award_collection_trophy(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_collection_trophy(uuid, text, text, uuid) TO service_role;

-- ============ THE THREE ACQUIRING PATHS ============
--
-- Every one of these is the CURRENT body, re-created with the trophy check
-- folded in. CREATE OR REPLACE with the signature unchanged, so nothing needs
-- dropping and types.ts needs no regeneration — all three already declare
-- `Returns: Json`.
--
-- The check goes in each of them rather than into one shared wrapper because
-- there is no shared wrapper to put it in: the three take different locks, decide
-- "is this new to them" three different ways, and hand back three different
-- shapes. What they do share is the participant row lock, which is what makes
-- detection atomic with the write in all three.

CREATE OR REPLACE FUNCTION public.pull_secret_card(_participant_id uuid, _guest_id uuid, _event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/New_York'
AS $function$
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
$function$;

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
    UPDATE public.secret_card_pulls o
       SET tier = _row.tier
     WHERE o.participant_id = _participant_id
       AND o.secret_card_id = _secret_card_id
       AND NOT o.is_duplicate
       AND public.secret_tier_rank(_row.tier) < public.secret_tier_rank(o.tier);
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

CREATE OR REPLACE FUNCTION public.claim_guest_secrets(_participant_id uuid, _guest_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _n int;
  _c record;
BEGIN
  IF _participant_id IS NULL OR _guest_id IS NULL THEN RETURN 0; END IF;

  PERFORM 1 FROM public.participants WHERE id = _participant_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  DELETE FROM public.secret_card_pulls g
   WHERE g.guest_id = _guest_id
     AND EXISTS (SELECT 1 FROM public.secret_card_pulls m
                  WHERE m.participant_id = _participant_id
                    AND m.pulled_on = g.pulled_on
                    AND NOT m.granted);

  -- A guest copy that outranks the member copy hands its tier over before it is
  -- demoted to a duplicate: merging two identities must not lose the better roll.
  UPDATE public.secret_card_pulls m
     SET tier = g.tier
    FROM public.secret_card_pulls g
   WHERE g.guest_id = _guest_id
     AND NOT g.is_duplicate
     AND m.participant_id = _participant_id
     AND m.secret_card_id = g.secret_card_id
     AND NOT m.is_duplicate
     AND public.secret_tier_rank(g.tier) < public.secret_tier_rank(m.tier);

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

  -- BANKING A GUEST'S TROPHIES.
  --
  -- collection_trophies has no guest half — it is a public table and a nameless
  -- row is not a trophy anybody can render — so a guest who finished a set has
  -- been collecting toward one without earning it. The rows they built are now
  -- this participant's, so this is the moment it becomes real. Every set they
  -- hold a card in is swept, because the one that completed could have been
  -- finished at any point in that guest's history.
  --
  -- Every read below is of rows this function has already re-parented, so the
  -- sweep sees the merged collection and not the half of it that was here first.
  --
  -- NEVER RAISES, like the rest of this function and like claim_guest_packs. A
  -- missed trophy costs a badge somebody can re-earn on their next pull. A claim
  -- that throws costs them their whole collection.
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
-- Re-stated rather than relied on. CREATE OR REPLACE keeps a function's existing
-- ACL, so these four are already correct on replay — but the rule this repo
-- spent a whole migration (20260817110000) making is that the grant is written
-- down next to the function, not inferred from history.
REVOKE ALL ON FUNCTION public.pull_secret_card(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pull_secret_card(uuid, uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.grant_secret_card(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_secret_card(uuid, uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.accept_trade_offer(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_trade_offer(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.claim_guest_secrets(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_guest_secrets(uuid, uuid) TO service_role;

-- ============ THE SETS ALREADY FINISHED ============
--
-- Everything above only ever looks at the set a card just ARRIVED in. That is the
-- right shape for a league that has always had this table, and exactly the wrong
-- one for a league that has been collecting for months without it: somebody who
-- already owns all of a set is locked out permanently, because every remaining
-- pull from it is a duplicate, every grant sets `_already`, and every trade of a
-- card they hold arrives as a duplicate too. No amount of playing fixes it.
--
-- So: one sweep over every set anybody already holds a card in, at the moment
-- this table comes into existence.
--
-- A FUNCTION rather than a bare INSERT, for two reasons. The db suite applies
-- migrations once against an empty database, so a statement here would insert
-- nothing and could never be tested — a function can be seeded against and
-- called. And it is re-runnable, which matters more than it looks: re-activating
-- a retired card, or filling in a missing art_path, grows the set and the
-- holder's share of it by one at the same time, so they stay complete and no call
-- site ever fires. This is the repair for that too.
--
-- It calls award_collection_trophy rather than reimplementing the completeness
-- test. Two copies of that predicate would drift, and the one that drifted would
-- hand out trophies for sets nobody finished.
CREATE OR REPLACE FUNCTION public.backfill_collection_trophies() RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rec record;
  _n   int := 0;
BEGIN
  FOR _rec IN
    SELECT DISTINCT p.participant_id, c.collection
      FROM public.secret_card_pulls p
      JOIN public.secret_cards c ON c.id = p.secret_card_id
     WHERE p.participant_id IS NOT NULL
       AND NOT p.is_duplicate
       AND c.collection IS NOT NULL
  LOOP
    -- NULL back means "not complete" or "already had it", and both are the normal
    -- answer here. Only a trophy minted by this call is counted.
    IF public.award_collection_trophy(_rec.participant_id, _rec.collection,
                                      'backfill', NULL) IS NOT NULL THEN
      _n := _n + 1;
    END IF;
  END LOOP;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_collection_trophies() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_collection_trophies() TO service_role;

-- Idempotent by the primary key inside the helper, so this replays with the rest
-- of the file. A no-op on an empty database, which is every run of the db suite —
-- the tests seed and call the function directly instead.
SELECT public.backfill_collection_trophies();