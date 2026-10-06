-- A card that changes hands takes its stale offers and listings with it.
--
-- Stakes are copy-specific: trade_offer_items and market_listings name a
-- card_copies / secret_card_pulls row, not a card. accept_trade_offer
-- (20260827130000) deliberately left every OTHER pending offer naming a moved
-- copy standing, and buy_market_listing (20260830120000) did the same, on the
-- theory that the next accept would void it. But the destructive RPCs refuse a
-- copy staked on ANY pending offer or active listing, whoever made it —
-- mill_card_copy and sell_secret_card (20260930120000), reroll_copy_edition
-- (20260830120000) answer 'staked', and list_card_for_dust (20260830120000)
-- answers 'already_listed' for the old owner's listing and counts the old
-- owner's offer against the new owner's commitments. So whoever received a
-- card could not mill, sell, re-roll or list it until a third person acted.
--
-- NOT fixed by narrowing those checks to "staked by the current owner": both
-- child tables are ON DELETE CASCADE from the copy, so milling a copy that
-- somebody else's stale offer still names would silently remove an item from
-- that offer, and an offer that shrinks without reaching zero still passes
-- trade_has_both_sides and can be accepted for less than was agreed.
--
-- Instead the settle paths clear what they made stale:
--
--   * accept_trade_offer voids every other pending offer that names a copy it
--     moved (either side), and voids every active listing of one;
--   * buy_market_listing voids every pending offer naming the copy it sold.
--
-- Both use SKIP LOCKED on the rows they void (see the comment in accept).
-- Statuses are the existing vocabulary — trade_offers 'voided',
-- market_listings 'voided', the word buy_market_listing already writes for a
-- listing whose card had moved. Nothing is published: trade_offers and
-- market_listings are in no publication, and the accept's `trades` row is what
-- reaches screens already.
--
-- And accept answers 'voided' rather than 'resolved' for an offer that is
-- already voided, so somebody tapping Accept on a stale inbox is told a card
-- moved on rather than that the offer was answered.
--
-- BODIES LIFTED WHOLE from their newest definitions — accept_trade_offer from
-- 20260827130000, buy_market_listing from 20260830120000 — with only the
-- statements above added and the comments that described the old behaviour
-- (accept's closing "left standing" block, and one sentence in buy's
-- re-validation comment that cited it) rewritten. For the reason 20260930120000
-- gives: a body retyped from a stale copy silently reverts whatever landed in
-- between.
--
-- Then a one-time cleanup of stakes the old behaviour already left behind, and
-- the two indexes the new lookups want.

-- ============ LOOKING UP A COPY'S STAKES ============
-- trade_offer_items' two unique indexes lead with offer_id, so "which offers
-- name this copy" was a scan. Also what the ON DELETE CASCADE from a copy uses.
-- market_listings needs nothing new: market_listings_one_active_copy and
-- market_listings_one_active_secret already index active listings by copy.
CREATE INDEX IF NOT EXISTS trade_offer_items_card_copy_idx
  ON public.trade_offer_items (card_copy_id)
  WHERE card_copy_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS trade_offer_items_secret_pull_idx
  ON public.trade_offer_items (secret_pull_id)
  WHERE secret_pull_id IS NOT NULL;

-- ============ THE ACCEPT ============
-- Body from 20260827130000 with the closing block replaced and the voided answer added.

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
-- Body from 20260830120000 with the void added after the sold flip.

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
    -- they own none of it now, which is exactly what selling it means. The buyer
    -- needs no equivalent — _dupe above already decided their side.
    PERFORM public.resync_secret_ownership(_listing.seller_id, _pull.secret_card_id);
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

-- ============ WHAT THE OLD BEHAVIOUR LEFT BEHIND ============
-- Idempotent: each statement only touches rows still in the state it repairs,
-- so a replay finds nothing. Reads card_copies and secret_card_pulls and never
-- writes them — no ownership, finish or level moves here.
--
-- A pending offer any of whose items is no longer held by the side giving it.
-- giver_side resolves against the offer's own proposer_id / recipient_id, the
-- way accept does. A guest-held secret row (participant_id NULL) is not held by
-- either side, so IS DISTINCT FROM counts it as moved.
UPDATE public.trade_offers o
   SET status = 'voided', resolved_at = now()
 WHERE o.status = 'pending'
   AND EXISTS (
     SELECT 1
       FROM public.trade_offer_items i
       LEFT JOIN public.card_copies       cc ON cc.id = i.card_copy_id
       LEFT JOIN public.secret_card_pulls sp ON sp.id = i.secret_pull_id
      WHERE i.offer_id = o.id
        AND CASE i.kind WHEN 'roster' THEN cc.participant_id ELSE sp.participant_id END
            IS DISTINCT FROM
            CASE i.giver_side WHEN 'proposer' THEN o.proposer_id ELSE o.recipient_id END);

-- An active listing whose seller no longer holds the copy.
UPDATE public.market_listings l
   SET status = 'voided', resolved_at = now()
 WHERE l.status = 'active'
   AND NOT EXISTS (
     SELECT 1 FROM public.card_copies c
      WHERE l.kind = 'roster' AND c.id = l.card_copy_id AND c.participant_id = l.seller_id)
   AND NOT EXISTS (
     SELECT 1 FROM public.secret_card_pulls p
      WHERE l.kind = 'secret' AND p.id = l.secret_pull_id AND p.participant_id = l.seller_id);
