-- The marketplace: a spare priced by the person selling it.
--
-- Dust has been a closed loop between each member and the house. You mill a spare
-- roster copy or sell a spare secret at a fixed ladder, and you spend it back at
-- the house on a bonus pull or a re-roll. Nobody's dust ever touches anybody
-- else's, and the Trading Post — which does move cards between people — has no
-- notion of price, so a swap only happens when two collections happen to want
-- each other. This is the missing edge: a member puts a spare on a shelf at a
-- price they choose, and anyone else buys it for dust.
--
-- IT CANNOT INFLATE ANYTHING, and that is worth stating because a marketplace
-- usually can. Dust is created only by mill_card_copy and sell_secret_card and
-- destroyed only by buy_bonus_secret_pull and reroll_copy_edition. A sale writes
-- -N and +N, so the sum over the ledger is unchanged. The obvious worry — list a
-- platinum for 1, the buyer mills it for 100 — nets the league the same 100 the
-- seller could have milled it for themselves. The dust moved; none was printed.
--
-- A MARKETPLACE IS A ONE-SIDED TRADE PRICED IN DUST, so almost nothing here is
-- new. trade_item_is_spare decides what may be listed, accept_trade_offer's two
-- transfer branches are copied line for line, and its sorted participant lock is
-- what keeps two sales — or a sale and a trade — from deadlocking. Read
-- 20260827130000_name_traded_secrets.sql before editing buy_market_listing.
--
-- Depends on 20260828120000 (dust_enabled) and 20260829120000 (sell_secret_card,
-- whose body is re-created below).

-- ============ THE SHELF ============
CREATE TABLE IF NOT EXISTS public.market_listings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Flavour, and nullable for the same reason trade_offers.event_id is: a sale can
  -- happen out of season and it outlives the combine it happened at.
  event_id       uuid REFERENCES public.events(id) ON DELETE SET NULL,
  seller_id      uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  kind           text NOT NULL,
  -- THE LISTING NAMES A COPY, NOT A CARD. Same grain as trade_offer_items, and for
  -- the same reason: "which of my three Alices am I selling" is otherwise
  -- undecidable, and the finish is most of what a buyer is paying for.
  card_copy_id   uuid REFERENCES public.card_copies(id) ON DELETE CASCADE,
  secret_pull_id uuid REFERENCES public.secret_card_pulls(id) ON DELETE CASCADE,
  price          int  NOT NULL,
  -- 'active' is the only state anything can be done to. Three ways out, and the
  -- last two are distinct on purpose, exactly as trade_offers separates them:
  -- `cancelled` is the seller taking it down, `voided` is the listing failing
  -- re-validation at buy time because the card had already moved.
  status         text NOT NULL DEFAULT 'active',
  buyer_id       uuid REFERENCES public.participants(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz,
  CONSTRAINT market_listings_kind_ck   CHECK (kind IN ('roster', 'secret')),
  CONSTRAINT market_listings_status_ck CHECK (status IN ('active', 'sold', 'cancelled', 'voided')),
  -- A ceiling rather than none. The dearest thing the house sells is 150, so 9999
  -- is far past any honest ask and still refuses a fat-fingered 50000 rather than
  -- banking it. The floor is 1 because a zero-price listing is a gift with a Buy
  -- button on it, and dust_ledger_delta_nonzero would reject the pair anyway.
  CONSTRAINT market_listings_price_ck  CHECK (price BETWEEN 1 AND 9999),
  -- Exactly one target, and it has to be the one the kind names. Same shape as
  -- trade_offer_items_identity_ck, which says the same thing about roster-or-secret.
  CONSTRAINT market_listings_identity_ck CHECK (
    (kind = 'roster' AND card_copy_id IS NOT NULL AND secret_pull_id IS NULL) OR
    (kind = 'secret' AND secret_pull_id IS NOT NULL AND card_copy_id IS NULL))
);

COMMENT ON TABLE public.market_listings IS
  'Cards on sale for dust, one row per listing. Server-only, the trade_offers posture: a listing names a card somebody holds and what they will part with it for, which is the private collection data card_pulls is locked down to protect. Reached only through requireMember()-guarded server functions.';

-- The shelf: what is on sale at this event, newest first.
CREATE INDEX IF NOT EXISTS market_listings_open_idx
  ON public.market_listings (event_id, status, created_at DESC);
-- "Your stall".
CREATE INDEX IF NOT EXISTS market_listings_seller_idx
  ON public.market_listings (seller_id, status);

-- ONE COPY CANNOT BE ON THE SHELF TWICE. Partial and status-scoped, so a sold or
-- cancelled listing does not stop the same copy being listed again later — by its
-- new owner or by the seller who changed their mind.
CREATE UNIQUE INDEX IF NOT EXISTS market_listings_one_active_copy
  ON public.market_listings (card_copy_id)
  WHERE status = 'active' AND card_copy_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS market_listings_one_active_secret
  ON public.market_listings (secret_pull_id)
  WHERE status = 'active' AND secret_pull_id IS NOT NULL;

ALTER TABLE public.market_listings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.market_listings FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.market_listings TO service_role;
-- No policies, on purpose: RLS on with zero policies denies every non-BYPASSRLS
-- role, and the revoked grant denies it a second time. Same shape as card_pulls.

-- NO ALTER PUBLICATION supabase_realtime. A published table has to be
-- anon-readable for the browser client to subscribe at all, and this one names
-- cards people hold — the exact leak trade_offers is unpublished to prevent. The
-- seller learns their card sold through the payload-free broadcast in
-- nudge.server.ts instead, which publishes nothing.

-- ============ ROOM IN THE LEDGER FOR A SALE ============
-- Both need DROP + CREATE rather than an edit: a CHECK cannot be extended and a
-- partial index's predicate cannot be altered. Written to replay from empty,
-- because tests/db/migrations.test.ts applies every migration against a fresh
-- cluster. The same block 20260829120000 used to make room for 'sell_secret'.
--
-- TWO reasons rather than one signed pair under a single name, because a ledger
-- is read by a person: 'market_buy' is what you spent and 'market_sale' is what
-- you were paid, and a single reason would need the sign of delta to tell them
-- apart in a list. The vocabulary is append-only — the value is stored in the
-- column, so renaming one orphans rows.
ALTER TABLE public.dust_ledger DROP CONSTRAINT IF EXISTS dust_ledger_reason_ck;
ALTER TABLE public.dust_ledger ADD CONSTRAINT dust_ledger_reason_ck CHECK (reason IN (
  'dupe_secret', 'sell_secret', 'mill_copy', 'buy_secret_pull', 'reroll_edition',
  'market_buy', 'market_sale',
  'milestone', 'bounty', 'admin_adjust'));

-- BOTH new reasons join the earn-once predicate, unlike reroll_edition. Paying
-- 50 twice for two re-rolls of one copy is the feature; buying or selling one
-- listing twice never is, because a listing goes 'sold' exactly once. The status
-- flip and the requestId replay inside buy_market_listing are the real guards —
-- this is the wall behind both of them, keyed on the listing id, which differs
-- from either row's counterpart in BOTH participant_id and reason.
DROP INDEX IF EXISTS public.dust_ledger_earn_once;
CREATE UNIQUE INDEX IF NOT EXISTS dust_ledger_earn_once
  ON public.dust_ledger (participant_id, reason, ref)
  WHERE ref IS NOT NULL
    AND reason IN ('dupe_secret', 'sell_secret', 'mill_copy',
                   'market_buy', 'market_sale');

-- ============ WHERE A BOUGHT COPY CAME FROM ============
-- 20260818192450 widened this the same way, so it replays. 'market' rather than
-- reusing 'trade' because provenance is the whole point of the column, and
-- nothing keys off 'trade' specifically: what matters everywhere is
-- source = 'pull' — card_copies_one_pull_per_day's predicate and
-- mill_card_copy's freshness guard — and a bought copy is correctly not that.
ALTER TABLE public.card_copies DROP CONSTRAINT IF EXISTS card_copies_source_ck;
ALTER TABLE public.card_copies ADD CONSTRAINT card_copies_source_ck
  CHECK (source IN ('pull', 'trade', 'backfill', 'adopt', 'grant', 'market'));

-- ============ PUTTING SOMETHING ON THE SHELF ============
-- The dust RPC invariant pattern, unchanged: the switch before any lock, the
-- participant row first, ownership proved UNDER that lock, and every refusal
-- returned rather than raised because all of them are things to say on a button.
--
-- No _request_id, unlike the two spending RPCs. Listing costs nothing, so there
-- is no debit for a lost response to duplicate — and the TARGET id is already the
-- key a retry would need: a repeat of the same tap finds the copy already on the
-- shelf and comes back with `already_listed` and the listing that is up, rather
-- than shelving it twice.
--
-- Which makes a price IMMUTABLE for the life of a listing, and that is the point
-- rather than a side effect: re-pricing is cancel-then-list, so a buyer can never
-- be charged more than the tile they tapped said, and buy_market_listing needs no
-- expected-price parameter to promise it.
CREATE OR REPLACE FUNCTION public.list_card_for_dust(
  _participant_id uuid,
  _kind           text,
  _card_copy_id   uuid,
  _secret_pull_id uuid,
  _price          int
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
-- trade_item_is_spare reads current_date for the secret branch, and every daily
-- thing in this app agrees about where the day ends.
SET timezone = 'America/New_York'
AS $$
DECLARE
  _copy      public.card_copies;
  _event     uuid;
  _committed int;
  _existing  uuid;
  _id        uuid;
BEGIN
  IF _participant_id IS NULL OR _kind IS NULL OR _price IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- The identity rule the table's CHECK states, asked before the insert so a
  -- malformed call gets a reason rather than a constraint violation.
  IF _kind NOT IN ('roster', 'secret')
     OR (_kind = 'roster' AND (_card_copy_id IS NULL OR _secret_pull_id IS NOT NULL))
     OR (_kind = 'secret' AND (_secret_pull_id IS NULL OR _card_copy_id IS NOT NULL)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- Mirrored in market_listings_price_ck and in MARKET_PRICE_MIN/MAX in
  -- src/lib/market.ts. Returned rather than left to the CHECK, which would raise —
  -- and the floor of 1 is load-bearing rather than cosmetic: a price of 0 would
  -- reach dust_ledger_delta_nonzero, which is also a CHECK, and raise inside a
  -- transaction that has already moved a card.
  IF _price < 1 OR _price > 9999 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_price');
  END IF;

  -- BEFORE THE LOCK AND BEFORE ANYTHING ELSE. A refused call should touch no
  -- rows at all, and this is the cheapest possible way to say no.
  IF NOT public.dust_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'disabled');
  END IF;

  -- Position one in the app's lock order: participants, then the rows keyed to
  -- them. Taking the copy first "to find its owner" is the reverse edge that
  -- would deadlock against accept_trade_offer.
  PERFORM 1 FROM public.participants WHERE id = _participant_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  IF _kind = 'roster' THEN
    SELECT * INTO _copy FROM public.card_copies
     WHERE id = _card_copy_id AND participant_id = _participant_id
     FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_yours'); END IF;
  ELSE
    PERFORM 1 FROM public.secret_card_pulls
     WHERE id = _secret_pull_id AND participant_id = _participant_id
     FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_yours'); END IF;
  END IF;

  -- ALREADY UP. Answered here rather than left to the partial unique indexes,
  -- which raise a unique violation and put a raw Postgres string on a button. The
  -- id comes back so the sheet can say what it is already listed at.
  --
  -- A PRICE IS IMMUTABLE for the life of a listing, and this is what enforces it:
  -- re-pricing is cancel-then-list. That is also what lets buy_market_listing take
  -- no expected-price parameter — a buyer can never be charged more than the tile
  -- they tapped said, because the number cannot move while the listing is up.
  SELECT id INTO _existing FROM public.market_listings
   WHERE status = 'active'
     AND ((_kind = 'roster' AND card_copy_id = _card_copy_id)
       OR (_kind = 'secret' AND secret_pull_id = _secret_pull_id));
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_listed', 'listingId', _existing);
  END IF;

  -- ONE CALL FOR BOTH RULES. The roster branch wants >= 2 copies held, which is
  -- what keeps the seller's card_pulls row alive through the sale — and that row
  -- count IS the public "Packed by N", which no sale may move. The secret branch
  -- takes any copy but refuses today's un-granted pull, which is a security rule
  -- rather than a product one: that row is the member's spent daily slot.
  IF NOT public.trade_item_is_spare(_participant_id, _kind, _card_copy_id, _secret_pull_id) THEN
    RETURN jsonb_build_object('ok', false,
      'reason', CASE WHEN _kind = 'roster' THEN 'last_copy' ELSE 'too_fresh' END);
  END IF;

  -- A CARD STAKED ON A PENDING OFFER MAY STILL BE LISTED, and the absence of a
  -- guard here is deliberate. create_trade_offer lets one copy sit on several
  -- pending offers at once, and accept_trade_offer says why out loud: hunting
  -- down the others means scanning every open offer on every settle to pre-empt a
  -- failure the settle path already handles. A listing promises rather than
  -- destroys, so it belongs on that side of the line. Whichever of the two
  -- settles first wins and the other fails its own re-validation — the accept
  -- voids the offer, the buy voids the listing.

  -- STRICTLY FEWER LISTINGS THAN COPIES, per seller per card. This is the one
  -- genuinely new invariant, and it is trade_leaves_a_copy's rule restated at the
  -- level it actually holds at. trade_item_is_spare above only asks "do you hold
  -- >= 2 of this card", which BOTH listings of a pair would pass, one at a time.
  -- If both then sold, resync_card_pull would take the seller's row to zero and
  -- delete it, and the public "Packed by N" for that card would have moved because
  -- of a sale. The + 1 is the row this call is about to write.
  --
  -- PENDING OFFERS COUNT TOO, which is what makes this a rule about commitments
  -- rather than about listings. Staking your second copy on an offer and then
  -- shelving the first is the same over-commitment wearing a different hat.
  --
  -- The buy path re-checks trade_item_is_spare under its own lock, so this is not
  -- the only thing standing there — but without it the shelf would happily accept
  -- a listing that is guaranteed to void, which reads as the app losing a card.
  --
  -- Secrets need no equivalent: no public count rides on holding one, which is the
  -- same reason trade_item_is_spare's secret branch takes any copy at all.
  IF _kind = 'roster' THEN
    SELECT (SELECT count(*) FROM public.market_listings l
              JOIN public.card_copies lc ON lc.id = l.card_copy_id
             WHERE l.seller_id = _participant_id
               AND l.status = 'active'
               AND lc.event_participant_id = _copy.event_participant_id)
         + (SELECT count(*) FROM public.trade_offer_items i
              JOIN public.trade_offers o  ON o.id = i.offer_id
              JOIN public.card_copies  ic ON ic.id = i.card_copy_id
             WHERE o.status = 'pending' AND i.kind = 'roster'
               AND ic.participant_id = _participant_id
               AND ic.event_participant_id = _copy.event_participant_id)
      INTO _committed;

    IF _committed + 1 >= (SELECT count(*) FROM public.card_copies o
                           WHERE o.participant_id = _participant_id
                             AND o.event_participant_id = _copy.event_participant_id) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'last_copy');
    END IF;
  END IF;

  -- A CEILING ON ONE PERSON'S SHELF. Thirteen people and a browse with no
  -- pagination: one member listing four hundred cards makes the screen useless
  -- for everybody else. Not an economic rule — it is the only shape of
  -- denial-of-service a marketplace of this size has.
  IF (SELECT count(*) FROM public.market_listings
       WHERE seller_id = _participant_id AND status = 'active') >= 20 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_many');
  END IF;

  -- The active event resolved here rather than taken as a parameter, the
  -- buy_bonus_secret_pull rule: an event id off a payload is both spoofable and
  -- racy. Nullable, so a listing made out of season is still a listing.
  SELECT id INTO _event FROM public.events WHERE active ORDER BY year DESC LIMIT 1;

  INSERT INTO public.market_listings
    (event_id, seller_id, kind, card_copy_id, secret_pull_id, price)
  VALUES (_event, _participant_id, _kind, _card_copy_id, _secret_pull_id, _price)
  -- The backstop under the check above, for the two-devices-one-member race it
  -- cannot see. RETURNING gives no row on a conflict, which is how that is caught.
  ON CONFLICT DO NOTHING
  RETURNING id INTO _id;

  IF _id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_listed');
  END IF;

  RETURN jsonb_build_object('ok', true, 'listingId', _id, 'price', _price, 'kind', _kind);
END;
$$;

REVOKE ALL ON FUNCTION public.list_card_for_dust(uuid, text, uuid, uuid, int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_card_for_dust(uuid, text, uuid, uuid, int) TO service_role;

-- ============ TAKING IT BACK DOWN ============
-- No participant lock: this touches one row, keyed on its own id, and the WHERE
-- proves it is the caller's under the row lock it takes. Nothing here reads a
-- balance or a count, so there is no read-then-write to serialise.
CREATE OR REPLACE FUNCTION public.cancel_market_listing(
  _participant_id uuid,
  _listing_id     uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _listing public.market_listings;
BEGIN
  IF _participant_id IS NULL OR _listing_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT * INTO _listing FROM public.market_listings
   WHERE id = _listing_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  -- The caller id comes from a verified member token, so this is somebody
  -- hand-posting another person's listing id. Still returned rather than raised —
  -- every other refusal in the feature is, and a stack trace is no more use here.
  IF _listing.seller_id <> _participant_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_yours');
  END IF;

  -- Somebody bought it while the sheet was open. A toast, not an error.
  IF _listing.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'resolved');
  END IF;

  -- NO dust_enabled() GATE, deliberately, and it is the only RPC in the feature
  -- without one. Everything else here moves dust or promises to; this only takes
  -- a promise back. A commissioner switching the economy off mid-party must not
  -- strand somebody's cards on a shelf they can no longer reach.
  UPDATE public.market_listings
     SET status = 'cancelled', resolved_at = now()
   WHERE id = _listing_id;

  RETURN jsonb_build_object('ok', true, 'listingId', _listing_id);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_market_listing(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_market_listing(uuid, uuid) TO service_role;

-- ============ THE SALE ============
-- Modelled line for line on accept_trade_offer (20260827130000), which is the
-- app's only other atomic two-party transfer. Read that function before editing
-- this one: the lock order, the void-rather-than-raise re-validation, the cleared
-- acquired_on and the mandatory granted = true are all its, and each of them is
-- load-bearing for a reason recorded there at length.
--
-- LOCK ORDER: the listing, then BOTH participants sorted by id, then the staked
-- row. accept_trade_offer takes trade_offers then the same sorted pair, so the two
-- top-level tables are disjoint and neither transaction ever wants the other's —
-- there is no cycle, only one queueing behind the other on the shared participant
-- rows. Every other dust RPC takes participants then the row keyed to them, which
-- is a suffix of this order.
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
  -- card the seller has since traded, milled or sold leaves the shelf: nobody
  -- hunts these down when the card moves, exactly as accept_trade_offer leaves
  -- other pending offers standing, because the settle path already handles it.
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

-- ============ A LISTED CARD IS SPOKEN FOR ============
-- The traffic is one way, and the asymmetry is the point. Listing a card that is
-- staked on a pending offer is allowed — see list_card_for_dust — because a
-- listing only promises. But the three RPCs that DESTROY or REWRITE a copy already
-- refuse one staked on a pending offer, and every word of their reasoning
-- transfers to a listing:
--
--   * mill_card_copy and sell_secret_card DELETE the row, and market_listings
--     cascades from card_copies and secret_card_pulls exactly as trade_offer_items
--     does. The shelf entry would go with it, silently — no 'voided' row, no
--     resolved_at, and nothing for a buyer mid-tap to read.
--   * reroll_copy_edition deletes nothing, which is the sharper case its own
--     comment already makes about trades: the listing survives, still advertising
--     a finish the copy no longer has, and the buyer agreed to the metal on the
--     tile.
--
-- Taking a listing down is one tap, so 'staked' reads as "take it off the market
-- first" rather than a dead end. create_trade_offer is deliberately NOT given the
-- same arm.
--
-- ALL THREE BODIES ARE LIFTED WHOLE FROM THE NEWEST DEFINITION — mill_card_copy
-- and reroll_copy_edition from 20260828120000_dust_switch.sql, sell_secret_card
-- from 20260829120000_sell_secrets.sql — with nothing changed but the block added
-- after each existing staked check. Extracted rather than retyped, for the reason
-- 20260825120000 demonstrated when it re-created accept_trade_offer from a stale
-- copy and silently reverted the named secret cards 20260825000127 had just added:
-- migrations apply in filename order and both files look correct in isolation.

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

  -- AND NOT ON THE MARKET, for the sharper of the two reasons again: a re-roll
  -- deletes nothing, so the listing survives it untouched and goes on advertising
  -- a finish this copy no longer has. The buyer agreed to the metal on the tile.
  IF EXISTS (SELECT 1 FROM public.market_listings l
              WHERE l.card_copy_id = _card_copy_id AND l.status = 'active') THEN
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