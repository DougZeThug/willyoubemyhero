-- Who has packed which roster card.
--
-- Until now there was no server-side record of a player-card pull at all:
-- collectCard in src/lib/card-collection.ts writes to this device's IndexedDB and
-- nowhere else. This is the league-wide half of that number, and the only thing
-- it exists to answer is "how many people have this card".
--
-- ONE ROW PER PERSON PER CARD, not one row per pull. A plain row count per card
-- is therefore the distinct-people count with no DISTINCT anywhere — and the
-- composite primary key means one person can contribute at most 1 to any card's
-- count however many times they call in. There is nothing here to inflate.

CREATE TABLE IF NOT EXISTS public.card_pulls (
  participant_id       uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  event_participant_id uuid NOT NULL REFERENCES public.event_participants(id) ON DELETE CASCADE,
  -- Never displayed. The number the UI shows is the ROW count, which a retry
  -- cannot move; this is here because it is free now and a migration later.
  pull_count           int NOT NULL DEFAULT 1,
  first_pulled_at      timestamptz NOT NULL DEFAULT now(),
  last_pulled_at       timestamptz NOT NULL DEFAULT now(),
  -- The primary key IS the uniqueness rule, so there is no surrogate id and
  -- nothing to reference a row by. (secret_card_pulls needs one because its two
  -- uniqueness rules are partial indexes and its ledger rows are individually
  -- referenceable; neither is true here.)
  PRIMARY KEY (participant_id, event_participant_id),
  CONSTRAINT card_pulls_count_positive CHECK (pull_count > 0)
);

COMMENT ON TABLE public.card_pulls IS
  'Which people have packed which roster card. Server-only: the aggregate ("7 people have this card") is public and served by getCardPullCounts, but the per-member rows ("Alice has never packed Bob") are nobody else''s business.';

-- The primary key leads on participant_id, so the count query — group by card
-- across a whole event — needs its own index. Same shape as card_reactions_card_idx.
CREATE INDEX IF NOT EXISTS card_pulls_card_idx ON public.card_pulls (event_participant_id);

ALTER TABLE public.card_pulls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.card_pulls FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.card_pulls TO service_role;
-- No policies, on purpose: RLS on with zero policies denies every non-BYPASSRLS
-- role, and the revoked grant denies it a second time. Same shape as award_votes
-- and secret_card_pulls.

-- NO ALTER PUBLICATION supabase_realtime. Publishing this broadcasts every pull,
-- with the puller's id attached, to every connected phone.

-- ============ THE WRITE ============
-- One statement, so a three-card pack is one round trip and one transaction.
CREATE OR REPLACE FUNCTION public.record_card_pulls(
  _participant_id        uuid,
  _event_participant_ids uuid[]
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  -- DISTINCT because ON CONFLICT cannot affect the same row twice in one INSERT.
  INSERT INTO public.card_pulls AS cp (participant_id, event_participant_id)
  SELECT DISTINCT _participant_id, ep.id
    FROM unnest(_event_participant_ids) AS t(id)
    JOIN public.event_participants ep ON ep.id = t.id
  ON CONFLICT (participant_id, event_participant_id) DO UPDATE
    SET pull_count = cp.pull_count + 1,
        last_pulled_at = now();

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

-- Same reasoning as pull_secret_card: a SECURITY DEFINER function keeps
-- Postgres's default EXECUTE TO PUBLIC, and the publishable key ships to every
-- browser. Without these two lines anyone can credit themselves every card.
REVOKE ALL ON FUNCTION public.record_card_pulls(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_card_pulls(uuid, uuid[]) TO service_role;
