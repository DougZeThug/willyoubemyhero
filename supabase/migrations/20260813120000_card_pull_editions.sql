-- The finish on a copy of a card.
--
-- A card's TIER is earned on the course and reads the same on every phone. Its
-- EDITION is rolled when you pull it, so two people can hold the same champion
-- and one of them holds a better print of it.
--
-- That is why the column lives HERE and not on event_participants: card_pulls is
-- a row about a person's copy, event_participants is a row about a player. An
-- edition on the player row would be a look an admin could hand to somebody who
-- never earned it, which is the thing secret_holo_cards refused to do to
-- card_rarity for the same reason.
--
-- ONE ROW PER PERSON PER CARD STILL HOLDS. The primary key does not move — see
-- 20260728160000_player_card_pulls.sql, whose whole argument is that a plain row
-- count per card IS the distinct-people count with no DISTINCT anywhere. A second
-- pull of a card you already hold, in a better finish, UPGRADES the row you have;
-- it never adds one.

ALTER TABLE public.card_pulls
  ADD COLUMN IF NOT EXISTS edition text NOT NULL DEFAULT 'standard';

COMMENT ON COLUMN public.card_pulls.edition IS
  'Best finish this person has ever pulled of this card. NOT NULL DEFAULT backfills every pre-existing row as standard, which is the honest statement: those cards were packed before editions existed. No CHECK, on purpose — the ids live in src/lib/card-edition.ts and an unrecognised value falls back to standard there, exactly as an unrecognised event_participants.card_rarity falls back to base.';

-- ============ THE LADDER ============
-- Rarest first, and this ordering exists in exactly two places: here, and
-- EDITION_ORDER in src/lib/card-edition.ts. A test pins the TS array against this
-- literal, because the best-wins rule has to be applied in both languages and
-- only one of them has a compiler that can see both.
--
-- Not SECURITY DEFINER — it reads nothing, so it needs nobody's privileges. It is
-- still revoked below, because the rule this schema actually holds itself to is
-- blanket rather than case-by-case: secret-cards.test.ts asserts that anon has
-- EXECUTE on NO function this app wrote, and "harmless" is not an exemption the
-- test offers.
--
-- An unknown id sorts last rather than raising, which is what lets a real finish
-- still displace a corrupt stored value instead of being blocked by it forever.
CREATE OR REPLACE FUNCTION public.card_edition_rank(_edition text)
RETURNS int
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE(
    array_position(ARRAY['platinum','gold','silver','bronze','standard'], _edition),
    99);
$$;

REVOKE ALL ON FUNCTION public.card_edition_rank(text) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.card_edition_rank(text) TO service_role;

-- ============ THE WRITE ============
-- Dropped, not replaced: CREATE OR REPLACE cannot change an argument list, so it
-- would leave the two-arg function standing as an OVERLOAD with its own grants —
-- and once the three-arg version carries DEFAULT NULL, a two-arg call becomes
-- genuinely ambiguous and PostgREST's resolution stops being predictable.
--
-- Dropping also drops that function's grants, which is why the REVOKE/GRANT pair
-- at the bottom has to be re-issued here rather than inherited.
DROP FUNCTION IF EXISTS public.record_card_pulls(uuid, uuid[]);

CREATE OR REPLACE FUNCTION public.record_card_pulls(
  _participant_id        uuid,
  _event_participant_ids uuid[],
  -- Positionally aligned with the ids above. DEFAULT NULL so a caller that
  -- predates editions — an old bundle still in a phone's cache mid-rollout —
  -- still resolves, and simply records standard.
  _editions              text[] DEFAULT NULL
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET timezone = 'America/New_York'
AS $$
DECLARE _n int;
BEGIN
  IF _participant_id IS NULL OR _event_participant_ids IS NULL THEN RETURN 0; END IF;

  -- Prove the member exists, so a still-valid token for a deleted participant
  -- returns zero rather than raising a foreign-key error into a call the client
  -- makes fire-and-forget and never surfaces.
  PERFORM 1 FROM public.participants WHERE id = _participant_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- The JOIN is what makes an unknown id harmless: it is dropped rather than
  -- failing the whole batch on a foreign key, so a pack dealt from a bundle that
  -- has since changed still records the cards that are still real.
  --
  -- unnest(a, b) zips the two arrays and pads the shorter with NULL, which is how
  -- a caller may omit editions entirely and still get standard out of the COALESCE.
  --
  -- DISTINCT ON rather than the plain DISTINCT this used to carry: ON CONFLICT
  -- cannot affect the same row twice in one INSERT, and the same card id can now
  -- arrive twice carrying two different finishes — which plain DISTINCT would no
  -- longer collapse. Ordering by rank inside the group keeps the better one, the
  -- same rule the conflict clause applies.
  INSERT INTO public.card_pulls AS cp (participant_id, event_participant_id, edition)
  SELECT DISTINCT ON (ep.id)
         _participant_id, ep.id, COALESCE(t.edition, 'standard')
    FROM unnest(_event_participant_ids, _editions) AS t(id, edition)
    JOIN public.event_participants ep ON ep.id = t.id
   ORDER BY ep.id, public.card_edition_rank(t.edition)
  ON CONFLICT (participant_id, event_participant_id) DO UPDATE
    SET pull_count = cp.pull_count
                   + CASE
                       WHEN (cp.last_pulled_at AT TIME ZONE 'America/New_York')::date
                            = current_date THEN 0
                       ELSE 1
                     END,
        -- Best wins, and only upward. A worse finish of a card you already hold
        -- is a duplicate, not a downgrade. bestEdition() in card-edition.ts
        -- applies the identical rule to the device's own collection, because the
        -- two have to agree about which copy you own.
        edition = CASE
                    WHEN public.card_edition_rank(EXCLUDED.edition)
                       < public.card_edition_rank(cp.edition)
                    THEN EXCLUDED.edition
                    ELSE cp.edition
                  END,
        last_pulled_at = now();

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

-- Same reasoning as before the signature changed: a SECURITY DEFINER function
-- keeps Postgres's default EXECUTE TO PUBLIC, and the publishable key ships to
-- every browser. Without these two lines anyone can credit themselves every card,
-- now in any finish they like.
REVOKE ALL ON FUNCTION public.record_card_pulls(uuid, uuid[], text[]) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_card_pulls(uuid, uuid[], text[]) TO service_role;
