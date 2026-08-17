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
  event_participant_id uuid REFERENCES public.event_participants(id) ON DELETE CASCADE,
  -- A specific COPY, not a card: secret ownership is per-row (surrogate id,
  -- is_duplicate), so a trade names the exact ledger row being handed over.
  secret_pull_id       uuid REFERENCES public.secret_card_pulls(id) ON DELETE CASCADE,
  CONSTRAINT trade_offer_items_side_ck CHECK (giver_side IN ('proposer', 'recipient')),
  CONSTRAINT trade_offer_items_kind_ck CHECK (kind IN ('roster', 'secret')),
  -- Exactly one target, and it has to be the one the kind names. Same shape as
  -- secret_card_pulls_identity_ck, which says the same thing about member-or-guest.
  CONSTRAINT trade_offer_items_identity_ck CHECK (
    (kind = 'roster' AND event_participant_id IS NOT NULL AND secret_pull_id IS NULL)
    OR
    (kind = 'secret' AND secret_pull_id IS NOT NULL AND event_participant_id IS NULL)
  )
);

COMMENT ON TABLE public.trade_offer_items IS
  'The cards staked on each side of an offer. Server-only for the same reason trade_offers is.';

CREATE INDEX IF NOT EXISTS trade_offer_items_offer_idx
  ON public.trade_offer_items (offer_id);

-- The same card cannot be staked twice in one offer. For roster cards that is the
-- real rule rather than tidiness: the accept decrements pull_count once per item,
-- so two items naming one card would spend two copies against a single spare
-- check and could drive the count to zero.
CREATE UNIQUE INDEX IF NOT EXISTS trade_offer_items_roster_once
  ON public.trade_offer_items (offer_id, giver_side, event_participant_id)
  WHERE kind = 'roster';

-- No giver_side here: a secret pull row has exactly one owner, so naming it twice
-- in one offer is a contradiction whichever sides claim it. Two DIFFERENT copies
-- of the same secret card are still fine — that is two rows, and it is a real
-- thing somebody might want to trade.
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
  _giver_id             uuid,
  _kind                 text,
  _event_participant_id uuid,
  _secret_pull_id       uuid
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
      -- >= 2 is what makes the decrement legal under card_pulls_count_positive:
      -- the giver's row survives at 1, so the public "Packed by N" row count for
      -- this card is unchanged by the trade.
      SELECT 1 FROM public.card_pulls
       WHERE participant_id = _giver_id
         AND event_participant_id = _event_participant_id
         AND pull_count >= 2)
    WHEN 'secret' THEN EXISTS (
      SELECT 1 FROM public.secret_card_pulls
       WHERE id = _secret_pull_id
         AND participant_id = _giver_id
         AND is_duplicate
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
       (e.v->>'kind' = 'roster' AND e.v->>'eventParticipantId' IS NOT NULL)
       OR (e.v->>'kind' = 'secret' AND e.v->>'secretPullId' IS NOT NULL))
  ) THEN
    RAISE EXCEPTION 'Every card in a trade must name a roster card or a secret copy';
  END IF;

  INSERT INTO public.trade_offers (event_id, proposer_id, recipient_id)
  VALUES (_event_id, _proposer_id, _recipient_id)
  RETURNING id INTO _offer_id;

  INSERT INTO public.trade_offer_items
    (offer_id, giver_side, kind, event_participant_id, secret_pull_id)
  SELECT _offer_id, s.side, e.v->>'kind',
         CASE WHEN e.v->>'kind' = 'roster' THEN (e.v->>'eventParticipantId')::uuid END,
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
             i.kind, i.event_participant_id, i.secret_pull_id)
  ) THEN
    RAISE EXCEPTION 'Every card in a trade has to be a spare its owner still holds';
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
     FROM public.card_pulls cp
     JOIN public.trade_offer_items i
       ON i.kind = 'roster'
      AND i.event_participant_id = cp.event_participant_id
      AND cp.participant_id = CASE i.giver_side
                                WHEN 'proposer' THEN _offer.proposer_id
                                ELSE _offer.recipient_id
                              END
    WHERE i.offer_id = _offer_id
      FOR UPDATE OF cp;

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
             i.kind, i.event_participant_id, i.secret_pull_id)
  ) THEN
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
           i.event_participant_id,
           i.secret_pull_id,
           CASE i.giver_side WHEN 'proposer' THEN _offer.proposer_id
                             ELSE _offer.recipient_id END AS giver_id,
           CASE i.giver_side WHEN 'proposer' THEN _offer.recipient_id
                             ELSE _offer.proposer_id END AS receiver_id
      FROM public.trade_offer_items i
     WHERE i.offer_id = _offer_id
     ORDER BY i.id
  LOOP
    IF _item.kind = 'roster' THEN
      -- The giver's row is decremented, never deleted. It was >= 2, so it lands
      -- at >= 1 and card_pulls_count_positive holds — and the row surviving is
      -- what keeps the public "Packed by N" count honest across a trade.
      UPDATE public.card_pulls
         SET pull_count = pull_count - 1
       WHERE participant_id = _item.giver_id
         AND event_participant_id = _item.event_participant_id;

      -- EDITIONS DO NOT TRANSFER, and this is deliberate. There is no per-copy
      -- edition to move — card_pulls.edition is the best finish that person has
      -- ever pulled — and the value is client-asserted (see the long comment in
      -- src/lib/card-pulls.functions.ts). Transferring it would launder an
      -- unverified number into a second member's row. A traded card arrives
      -- standard, and a receiver who already holds a better finish keeps it: the
      -- conflict clause below touches pull_count and nothing else.
      --
      -- KNOWN AND ACCEPTED: a fresh insert defaults last_pulled_at to now(), and
      -- record_card_pulls skips its pull_count bump for a card already counted
      -- today. So packing this same card later the same day will not bump the
      -- count. That is a private stat, off by one, for one day.
      INSERT INTO public.card_pulls AS cp
        (participant_id, event_participant_id, pull_count, edition)
      VALUES (_item.receiver_id, _item.event_participant_id, 1, 'standard')
      ON CONFLICT (participant_id, event_participant_id) DO UPDATE
        SET pull_count = cp.pull_count + 1,
            last_pulled_at = now();
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
    END IF;
  END LOOP;

  -- THE PUBLIC RECORD. Roster items keep their event_participant_id — that is a
  -- public card anyone can already browse. Secret items collapse to their kind and
  -- nothing else, because this jsonb lands in an anon-readable, realtime-published
  -- table and a secret_card_id here would leak the catalogue to every phone in the
  -- garden. Built here and nowhere else, so there is one place to get it right.
  SELECT
    coalesce(jsonb_agg(
      CASE i.kind
        WHEN 'roster' THEN jsonb_build_object('kind', 'roster',
                                              'eventParticipantId', i.event_participant_id)
        ELSE jsonb_build_object('kind', 'secret')
      END ORDER BY i.kind, i.id), '[]'::jsonb)
    INTO _proposer_gave
    FROM public.trade_offer_items i
   WHERE i.offer_id = _offer_id AND i.giver_side = 'proposer';

  SELECT
    coalesce(jsonb_agg(
      CASE i.kind
        WHEN 'roster' THEN jsonb_build_object('kind', 'roster',
                                              'eventParticipantId', i.event_participant_id)
        ELSE jsonb_build_object('kind', 'secret')
      END ORDER BY i.kind, i.id), '[]'::jsonb)
    INTO _recipient_gave
    FROM public.trade_offer_items i
   WHERE i.offer_id = _offer_id AND i.giver_side = 'recipient';

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
