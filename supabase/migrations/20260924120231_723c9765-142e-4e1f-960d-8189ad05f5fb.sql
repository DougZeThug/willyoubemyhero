-- ===== MIGRATION: keep_market_receipts =====

-- A sale's receipt outlives the card that was sold.
--
-- The seller's stall is the ONLY place a market sale is ever visible: a sale
-- writes no row into `trades` and reaches no feed (see getMyStall). But
-- market_listings named its card through card_copy_id / secret_pull_id, both
-- ON DELETE CASCADE, so the moment the BUYER milled the copy or sold the secret
-- to the house, the seller's sold row was deleted with it. The dust stayed in
-- their balance and the record of where it came from went. "Huh, I have more
-- dust" was the whole of what they could learn.
--
-- Three parts, and the first is what makes the other two worth having:
--
--   1. THE LISTING REMEMBERS WHAT IT LISTED. A row that has lost its copy can
--      still say which card it was, in which finish, and who decided the finish.
--      Taken at listing time, which is also sale time for everything shown: a
--      listed copy cannot be re-rolled (20260830120000's "a listed card is
--      spoken for"), and buy_market_listing carries the finish across untouched.
--      Taken AFTER the sale instead, a buyer's re-roll would rewrite the
--      seller's receipt.
--
--   2. A SETTLED LISTING IS DETACHED, NOT DELETED. A BEFORE DELETE trigger on
--      both source tables nulls the reference on every non-active listing that
--      points at the row going away.
--
--      THE CASCADE STAYS, for the ACTIVE listing, and for the reason
--      tests/db/market.test.ts gives: a live listing whose target has gone is a
--      Buy button on nothing, and letting the row go is better than keeping it.
--      Referential actions run as AFTER triggers, so by the time the cascade
--      looks, the only rows still pointing at the dead copy are the live ones
--      this trigger left alone.
--
--   3. THE IDENTITY CHECK ALLOWS A MISSING TARGET ONLY ONCE SETTLED. Kind and
--      target must still agree, and an active listing must still name a card.
--
-- A trigger rather than another copy of list_card_for_dust, for the reason
-- 20260830120000's header gives about re-creating RPC bodies from stale copies.

-- ============ 1. WHAT WAS LISTED ============
-- No foreign keys, on purpose: these are a record of what the card WAS, and a
-- reference would put the receipt back at the mercy of whatever deletes the card.
ALTER TABLE public.market_listings
  ADD COLUMN IF NOT EXISTS listed_event_participant_id uuid,
  ADD COLUMN IF NOT EXISTS listed_edition              text,
  ADD COLUMN IF NOT EXISTS listed_edition_asserted_by  text,
  ADD COLUMN IF NOT EXISTS listed_secret_card_id       uuid,
  ADD COLUMN IF NOT EXISTS listed_tier                 text;

COMMENT ON COLUMN public.market_listings.listed_secret_card_id IS
  'The secret card this listing was for, as of listing time. Server-only like every secret card id: read by getMyStall to name a sold card whose pull has since been destroyed, never shipped.';

CREATE OR REPLACE FUNCTION public.snapshot_market_listing_item() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- list_card_for_dust has already locked and verified the row it names; this
  -- only copies it. A listing naming a row that does not exist fails its foreign
  -- key a moment later either way.
  IF NEW.kind = 'roster' THEN
    SELECT c.event_participant_id, c.edition, c.edition_asserted_by
      INTO NEW.listed_event_participant_id, NEW.listed_edition, NEW.listed_edition_asserted_by
      FROM public.card_copies c
     WHERE c.id = NEW.card_copy_id;
  ELSE
    SELECT p.secret_card_id, p.tier
      INTO NEW.listed_secret_card_id, NEW.listed_tier
      FROM public.secret_card_pulls p
     WHERE p.id = NEW.secret_pull_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER market_listings_snapshot_item
  BEFORE INSERT ON public.market_listings
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_market_listing_item();

-- Every listing that exists today still has its card — the cascade guaranteed
-- that — so this fills all of them. For one that already sold and was re-rolled
-- by its buyer, today's finish is the best record left.
UPDATE public.market_listings l
   SET listed_event_participant_id = c.event_participant_id,
       listed_edition              = c.edition,
       listed_edition_asserted_by  = c.edition_asserted_by
  FROM public.card_copies c
 WHERE l.kind = 'roster'
   AND c.id = l.card_copy_id
   AND l.listed_event_participant_id IS NULL;

UPDATE public.market_listings l
   SET listed_secret_card_id = p.secret_card_id,
       listed_tier           = p.tier
  FROM public.secret_card_pulls p
 WHERE l.kind = 'secret'
   AND p.id = l.secret_pull_id
   AND l.listed_secret_card_id IS NULL;

-- ============ 3. A SETTLED LISTING MAY OUTLIVE ITS CARD ============
-- Before the trigger below, which is the first thing that writes such a row.
ALTER TABLE public.market_listings DROP CONSTRAINT IF EXISTS market_listings_identity_ck;
ALTER TABLE public.market_listings ADD CONSTRAINT market_listings_identity_ck CHECK (
  (kind = 'roster' AND secret_pull_id IS NULL AND (card_copy_id IS NOT NULL OR status <> 'active')) OR
  (kind = 'secret' AND card_copy_id IS NULL AND (secret_pull_id IS NOT NULL OR status <> 'active')));

-- ============ 2. DETACH, DON'T DELETE ============
CREATE OR REPLACE FUNCTION public.keep_settled_market_listings() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'card_copies' THEN
    UPDATE public.market_listings
       SET card_copy_id = NULL
     WHERE card_copy_id = OLD.id
       AND status <> 'active';
  ELSE
    UPDATE public.market_listings
       SET secret_pull_id = NULL
     WHERE secret_pull_id = OLD.id
       AND status <> 'active';
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE TRIGGER card_copies_keep_market_receipts
  BEFORE DELETE ON public.card_copies
  FOR EACH ROW EXECUTE FUNCTION public.keep_settled_market_listings();

CREATE OR REPLACE TRIGGER secret_card_pulls_keep_market_receipts
  BEFORE DELETE ON public.secret_card_pulls
  FOR EACH ROW EXECUTE FUNCTION public.keep_settled_market_listings();