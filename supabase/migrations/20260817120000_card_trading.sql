-- The Trading Post: move a spare card from one member to another.
--
-- Everybody pulls a pack a day and ends up with duplicates, and until now there
-- was no way to move one. This adds offer-and-accept swaps across both halves of
-- a collection — roster spares and secret spares — with pending offers private to
-- the two people involved and completed trades announced to the whole league.
--
-- THE ONE RULE THE WHOLE DESIGN HANGS OFF: only a SPARE can be staked. A roster
-- card needs pull_count >= 2, a secret needs a specific ledger row with
-- is_duplicate. That is a product decision (you cannot trade away the only copy
-- of somebody you have) and simultaneously the thing that keeps the schema
-- honest: the giver's card_pulls row is decremented but never deleted, so the row
-- count per card — which IS the public "Packed by N" number, see
-- 20260728160000_player_card_pulls.sql — cannot move because of a trade.
--
-- THREE TABLES, TWO PRIVACY POSTURES. trade_offers and trade_offer_items are
-- server-only and unpublished, like card_pulls: a pending offer names cards
-- somebody holds, and the offer tables would leak the same private collection
-- data card_pulls is locked down to protect. `trades` is the opposite — it is the
-- public announcement, anon-readable and published to realtime so a completed
-- swap lands on everyone's phone. Which is exactly why the secret half of a trade
-- is redacted on the way into it. See the column comments below.

-- ============ OFFERS ============
CREATE TABLE IF NOT EXISTS public.trade_offers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Flavour, and nullable for the same reason secret_card_pulls.event_id is: a
  -- trade can happen out of season, and it outlives the combine it happened at.
  event_id     uuid REFERENCES public.events(id) ON DELETE SET NULL,
  proposer_id  uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  -- pending is the only state anything can be done to. `voided` is distinct from
  -- `declined` on purpose: declined is a person saying no, voided is the offer
  -- failing re-validation at accept time because a staked card had already moved.
  status       text NOT NULL DEFAULT 'pending',
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  CONSTRAINT trade_offers_status_ck
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'voided')),
  CONSTRAINT trade_offers_not_self_ck CHECK (proposer_id <> recipient_id)
);

COMMENT ON TABLE public.trade_offers IS
  'Pending and resolved swap offers. Server-only: an offer names cards a member holds, which is the same private collection data card_pulls exists to keep off the wire. Never published to realtime.';

-- The two screens this table has: "what is waiting for me" and "what have I sent".
CREATE INDEX IF NOT EXISTS trade_offers_recipient_idx
  ON public.trade_offers (recipient_id, status);
CREATE INDEX IF NOT EXISTS trade_offers_proposer_idx
  ON public.trade_offers (proposer_id, status);

ALTER TABLE public.trade_offers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trade_offers FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.trade_offers TO service_role;
-- No policies, on purpose: RLS on with zero policies denies every non-BYPASSRLS
-- role, and the revoked grant denies it a second time. Same shape as card_pulls,
-- award_votes and secret_card_pulls.

-- ============ WHAT IS ON THE TABLE ============
CREATE TABLE IF NOT EXISTS public.trade_offer_items (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.trade_offers(id) ON DELETE CASCADE,
  -- WHO IS GIVING THIS ONE UP, not who is getting it. Every item is resolved
  -- against the offer's proposer_id/recipient_id at accept time, so a side is two
  -- characters here rather than a participant id that could disagree with the
  -- offer it hangs off.
  giver_side text NOT NULL,
  kind       text NOT NULL,
  -- BOTH SIDES NAME A SPECIFIC COPY, not a card. Secret ownership was always
  -- per-row, and card_copies (20260817115000) gives roster cards the same grain —
  -- which is what makes a finish tradeable at all. Naming the card instead would
  -- leave "which of my three Alices am I giving you" undecidable, and every
  -- traded card arriving standard is exactly the bug that had.
  card_copy_id   uuid REFERENCES public.card_copies(id) ON DELETE CASCADE,
  secret_pull_id uuid REFERENCES public.secret_card_pulls(id) ON DELETE CASCADE,
  CONSTRAINT trade_offer_items_side_ck CHECK (giver_side IN ('proposer', 'recipient')),
  CONSTRAINT trade_offer_items_kind_ck CHECK (kind IN ('roster', 'secret')),
  -- Exactly one target, and it has to be the one the kind names. Same shape as
  -- secret_card_pulls_identity_ck, which says the same thing about member-or-guest.
  CONSTRAINT trade_offer_items_identity_ck CHECK (
    (kind = 'roster' AND card_copy_id IS NOT NULL AND secret_pull_id IS NULL)
    OR
    (kind = 'secret' AND secret_pull_id IS NOT NULL AND card_copy_id IS NULL)
  )
);

COMMENT ON TABLE public.trade_offer_items IS
  'The cards staked on each side of an offer. Server-only for the same reason trade_offers is.';

CREATE INDEX IF NOT EXISTS trade_offer_items_offer_idx
  ON public.trade_offer_items (offer_id);

-- The same COPY cannot be staked twice in one offer. No giver_side in either
-- index: a copy has exactly one owner, so naming it twice is a contradiction
-- whichever sides claim it. Two different copies of the same card are still fine —
-- that is two rows, and trading two of your three Alices is a real thing to want.
CREATE UNIQUE INDEX IF NOT EXISTS trade_offer_items_roster_once
  ON public.trade_offer_items (offer_id, card_copy_id)
  WHERE kind = 'roster';

CREATE UNIQUE INDEX IF NOT EXISTS trade_offer_items_secret_once
  ON public.trade_offer_items (offer_id, secret_pull_id)
  WHERE kind = 'secret';

ALTER TABLE public.trade_offer_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trade_offer_items FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.trade_offer_items TO service_role;

-- ============ THE ANNOUNCEMENT ============
-- The only public table here, and the only one written by nobody but the accept
-- RPC below. This is the trash-talk feed: "Alice and Bob swapped two cards".
CREATE TABLE IF NOT EXISTS public.trades (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       uuid REFERENCES public.events(id) ON DELETE SET NULL,
  offer_id       uuid REFERENCES public.trade_offers(id) ON DELETE SET NULL,
  proposer_id    uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  recipient_id   uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  proposer_gave  jsonb NOT NULL DEFAULT '[]'::jsonb,
  recipient_gave jsonb NOT NULL DEFAULT '[]'::jsonb,
  executed_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.trades IS
  'Completed swaps. THE ONLY PUBLIC TABLE IN THE TRADING FEATURE: anon-readable and published to realtime, so every phone sees a trade land.';

-- These two comments are load-bearing. Read them before touching build_summary().
COMMENT ON COLUMN public.trades.proposer_gave IS
  'PUBLIC-SAFE SUMMARY. Roster items carry their event_participant_id, which is public data on a public card. Secret items are {"kind":"secret"} and NOTHING ELSE — this table is anon-readable and published, so a secret_card_id here would hand the whole catalogue to anyone with devtools, which is the exact leak secret_cards being server-only exists to prevent. Built only inside accept_trade_offer.';
COMMENT ON COLUMN public.trades.recipient_gave IS
  'PUBLIC-SAFE SUMMARY. Same redaction rule as proposer_gave: never name a secret card here.';

CREATE INDEX IF NOT EXISTS trades_event_idx
  ON public.trades (event_id, executed_at DESC);

ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.trades TO anon, authenticated;
GRANT ALL ON public.trades TO service_role;
DROP POLICY IF EXISTS "trades public read" ON public.trades;
CREATE POLICY "trades public read" ON public.trades FOR SELECT USING (true);

-- ============ REALTIME ============
-- A completed trade lands on every phone. This is also the app's only live ping
-- for the trading feature at all: an insert here is what tells the two parties to
-- refetch their collections, so their vaults update without a reload.
--
-- Guarded, unlike the ALTER PUBLICATION calls in the older migrations: those ran
-- once against an empty database, and this file has to survive being replayed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'trades'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.trades;
  END IF;
END $$;

-- NO ALTER PUBLICATION for trade_offers or trade_offer_items. Publishing either
-- broadcasts a private offer — and the cards behind it — to every connected phone.

-- ============ WHAT COUNTS AS A SPARE ============
-- One definition, called by both RPCs below, because "is this tradeable" is
-- asked twice: once when the offer is composed and again under lock when it is
-- accepted. Two copies of this rule would drift, and the accept-time copy is the
-- one that actually protects the database.
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
-- For current_date below. Same zone as the pack drop and the secret drop; three
-- daily things in this app and they all have to agree about where the day ends.
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
         -- TODAY'S OWN PULL IS NOT A SPARE YET, and this line is a security rule
         -- rather than a product one. A member's un-granted row for the current
         -- league day IS their spent daily slot — pull_secret_card looks for
         -- exactly `pulled_on = today AND NOT granted` to decide whether they have
         -- already pulled. The accept below sets granted = true on the row it
         -- moves, so trading away today's duplicate would hand the giver a second
         -- daily pull. Tomorrow the same row trades freely.
         AND NOT (NOT granted AND pulled_on = current_date))
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public.trade_item_is_spare(uuid, text, uuid, uuid)
  FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.trade_item_is_spare(uuid, text, uuid, uuid) TO service_role;

-- ============ AND STILL A COPY LEFT, ACROSS THE WHOLE OFFER ============
-- trade_item_is_spare answers "is this ONE copy tradeable", which is necessary and
-- NOT sufficient: two copies of the same card can now be staked in one offer (that
-- is the point of keying the item on a copy), and against a holding of exactly two
-- they would each pass a per-item check that only ever sees the count before
-- anything moved. Both would then transfer, resync_card_pull would find zero
-- copies, and the giver's card_pulls row — which IS the public "Packed by N"
-- count — would be deleted by a trade.
--
-- So the rule is stated once more at the level it actually holds at: per giver,
-- per card, you may stake strictly fewer copies than you hold.
CREATE OR REPLACE FUNCTION public.trade_leaves_a_copy(_offer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    WITH staked AS (
      SELECT cc.participant_id AS pid, cc.event_participant_id AS ep, count(*) AS n
        FROM public.trade_offer_items i
        JOIN public.card_copies cc ON cc.id = i.card_copy_id
       WHERE i.offer_id = _offer_id AND i.kind = 'roster'
       GROUP BY cc.participant_id, cc.event_participant_id
    )
    SELECT 1 FROM staked s
     WHERE s.n >= (SELECT count(*) FROM public.card_copies o
                    WHERE o.participant_id = s.pid
                      AND o.event_participant_id = s.ep)
  );
$$;

REVOKE ALL ON FUNCTION public.trade_leaves_a_copy(uuid) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.trade_leaves_a_copy(uuid) TO service_role;

-- ============ WHO OWNS A SECRET, AFTER ONE HAS MOVED ============
-- The direct analogue of resync_card_pull, and it exists for the same reason:
-- something derived has to be recomputed once a trade moves the row it was
-- derived from.
--
-- `is_duplicate = false` is not just a flag on a pull, it is the marker for "this
-- person owns this card", and FOUR things read it: secret_pull_status's `pulled`
-- count, pull_secret_card's first pass (which cards can still be found fresh),
-- getMySecrets' ownerCount, and the commissioner's catalogue. While only
-- duplicates could be traded, the giver always kept their ownership row and those
-- four could never disagree with the vault. Now that any copy can go, somebody can
-- hand over the ownership row and keep duplicates — leaving a member whose vault
-- still shows the card (getMySecrets lists any row) while every count says they do
-- not own it, and to whom pull_secret_card would happily deal it again as new.
--
-- So: if they still hold copies but none of them owns the card, promote one.
CREATE OR REPLACE FUNCTION public.resync_secret_ownership(
  _participant_id uuid,
  _secret_card_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _promote uuid;
BEGIN
  IF _participant_id IS NULL OR _secret_card_id IS NULL THEN RETURN; END IF;

  -- Already have an owning row, or nothing left at all: either way, nothing to do.
  IF EXISTS (
    SELECT 1 FROM public.secret_card_pulls
     WHERE participant_id = _participant_id
       AND secret_card_id = _secret_card_id
       AND NOT is_duplicate
  ) THEN RETURN; END IF;

  -- Best tier first, then the oldest — best-wins is the rule bestSecretTier and
  -- pull_secret_card already apply to every other copy question, and taking the
  -- oldest keeps the `firstPulledOn` the vault shows honest.
  SELECT id INTO _promote
    FROM public.secret_card_pulls
   WHERE participant_id = _participant_id
     AND secret_card_id = _secret_card_id
   ORDER BY public.secret_tier_rank(tier) ASC, pulled_on ASC
   LIMIT 1;

  IF _promote IS NULL THEN RETURN; END IF;

  -- secret_card_pulls_owned_once is satisfied by construction: the guard above
  -- proved there is no other non-duplicate row for this pair.
  UPDATE public.secret_card_pulls SET is_duplicate = false WHERE id = _promote;
END;
$$;

REVOKE ALL ON FUNCTION public.resync_secret_ownership(uuid, uuid)
  FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.resync_secret_ownership(uuid, uuid) TO service_role;

-- ============ COMPOSING AN OFFER ============
-- An RPC rather than two supabase-js calls because the offer and its items span
-- two tables and supabase-js has no transactions — a failed second insert would
-- leave an offer with nothing on the table, which the accept path would read as a
-- valid empty swap.
--
-- Items arrive as jsonb arrays of {kind, eventParticipantId} / {kind, secretPullId}.
CREATE OR REPLACE FUNCTION public.create_trade_offer(
  _proposer_id  uuid,
  _recipient_id uuid,
  _event_id     uuid,
  _give         jsonb,
  _want         jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _offer_id uuid;
BEGIN
  IF _proposer_id IS NULL OR _recipient_id IS NULL THEN
    RAISE EXCEPTION 'A trade needs two people';
  END IF;
  IF _proposer_id = _recipient_id THEN
    RAISE EXCEPTION 'You cannot trade with yourself';
  END IF;

  PERFORM 1 FROM public.participants WHERE id = _proposer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Participant not found'; END IF;

  -- The recipient has to be somebody who can actually answer. An unclaimed player
  -- has no device holding a member token, so an offer to them would sit pending
  -- forever with no way to decline it.
  PERFORM 1 FROM public.member_codes
   WHERE participant_id = _recipient_id AND claimed_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'That player has not claimed their card yet'; END IF;

  IF jsonb_typeof(_give) <> 'array' OR jsonb_typeof(_want) <> 'array' THEN
    RAISE EXCEPTION 'A trade needs a list of cards on each side';
  END IF;
  -- Both sides non-empty: a one-sided "trade" is a gift, and the accept path's
  -- whole safety story is a swap of two validated spares.
  IF jsonb_array_length(_give) < 1 OR jsonb_array_length(_give) > 4
     OR jsonb_array_length(_want) < 1 OR jsonb_array_length(_want) > 4 THEN
    RAISE EXCEPTION 'Each side of a trade is one to four cards';
  END IF;

  -- Checked before the insert so a malformed item gets this sentence rather than
  -- the identity CHECK's constraint-violation text.
  IF EXISTS (
    SELECT 1 FROM (
      SELECT jsonb_array_elements(_give) AS v
      UNION ALL
      SELECT jsonb_array_elements(_want)
    ) AS e
     WHERE NOT (
       (e.v->>'kind' = 'roster' AND e.v->>'cardCopyId' IS NOT NULL)
       OR (e.v->>'kind' = 'secret' AND e.v->>'secretPullId' IS NOT NULL))
  ) THEN
    RAISE EXCEPTION 'Every card in a trade must name a card copy or a secret copy';
  END IF;

  INSERT INTO public.trade_offers (event_id, proposer_id, recipient_id)
  VALUES (_event_id, _proposer_id, _recipient_id)
  RETURNING id INTO _offer_id;

  INSERT INTO public.trade_offer_items
    (offer_id, giver_side, kind, card_copy_id, secret_pull_id)
  SELECT _offer_id, s.side, e.v->>'kind',
         CASE WHEN e.v->>'kind' = 'roster' THEN (e.v->>'cardCopyId')::uuid END,
         CASE WHEN e.v->>'kind' = 'secret' THEN (e.v->>'secretPullId')::uuid END
    FROM (VALUES ('proposer', _give), ('recipient', _want)) AS s(side, items)
    CROSS JOIN LATERAL jsonb_array_elements(s.items) AS e(v);

  -- Every staked card has to be a spare its own side actually holds. Same
  -- function the accept re-runs under lock, so an offer that passes here fails
  -- there only because the world moved, never because the two disagree.
  IF EXISTS (
    SELECT 1 FROM public.trade_offer_items i
     WHERE i.offer_id = _offer_id
       AND NOT public.trade_item_is_spare(
             CASE i.giver_side WHEN 'proposer' THEN _proposer_id ELSE _recipient_id END,
             i.kind, i.card_copy_id, i.secret_pull_id)
  ) THEN
    RAISE EXCEPTION 'Every card in a trade has to be a spare its owner still holds';
  END IF;

  -- And, across the whole offer, nobody empties a card out. See the comment on
  -- trade_leaves_a_copy: the per-item check above cannot see this one.
  IF NOT public.trade_leaves_a_copy(_offer_id) THEN
    RAISE EXCEPTION 'You have to keep a copy of every card you trade';
  END IF;

  RETURN jsonb_build_object('ok', true, 'offerId', _offer_id);
END;
$$;

REVOKE ALL ON FUNCTION public.create_trade_offer(uuid, uuid, uuid, jsonb, jsonb)
  FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_trade_offer(uuid, uuid, uuid, jsonb, jsonb) TO service_role;

-- ============ THE SWAP ============
-- Everything below happens in one transaction or none of it does. This is the
-- only place in the app where two people's collections change at once, so it is
-- also the only place a race can hand somebody a card that was already spent.
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
  ) OR NOT public.trade_leaves_a_copy(_offer_id) THEN
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
  RETURN jsonb_build_object('ok', true, 'tradeId', _trade_id);
END;
$$;

REVOKE ALL ON FUNCTION public.accept_trade_offer(uuid, uuid) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_trade_offer(uuid, uuid) TO service_role;

-- Declining and cancelling are deliberately NOT RPCs. Each is a single UPDATE
-- guarded on the actor and on status = 'pending', which is atomic by itself —
-- wrapping it in a function would add a hop and nothing else. See
-- declineTradeOffer / cancelTradeOffer in src/lib/trades.functions.ts.
