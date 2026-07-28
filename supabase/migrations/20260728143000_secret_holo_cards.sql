-- Secret holo cards: a permanent league collection, not an event's roster.
--
-- Standalone admin-authored cards — the dog, the grill, the legendary moment —
-- with no participant behind them, so they get their own table rather than
-- borrowing event_participants. Deliberately NOT event-scoped: uploaded once,
-- they keep working every combine, and a member's collection carries forward.
--
-- BOTH TABLES ARE SERVER-ONLY, AND THAT IS THE WHOLE FEATURE. One anon SELECT
-- grant and anybody with devtools reads the entire set without opening a pack.

-- ============ CATALOGUE ============
CREATE TABLE IF NOT EXISTS public.secret_cards (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  -- The admin's one line. Its own field rather than a reused player quote,
  -- because a secret card's whole personality is the line written for it.
  flavour    text,
  -- Holo treatment id, resolved in src/lib/secret-cards.ts. Deliberately NOT one
  -- of the six rarity tiers — that vocabulary is persisted in
  -- event_participants.card_rarity and secrets must not squat in it. No CHECK, so
  -- an unknown string falls back in TS the way card-rarity.ts does for an
  -- unrecognised override.
  foil       text NOT NULL DEFAULT 'rosette',
  -- Storage paths in the private participant-photos bucket. Never public URLs.
  art_path   text,
  back_path  text,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT secret_cards_name_len CHECK (char_length(name) BETWEEN 1 AND 60)
);

COMMENT ON TABLE public.secret_cards IS
  'League-wide secret card catalogue. Deliberately not event-scoped: the set is uploaded once and carries forward across combines. Server-only; never exposed through events_public or realtime.';

ALTER TABLE public.secret_cards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.secret_cards FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.secret_cards TO service_role;
-- No policies, on purpose: RLS on with zero policies denies every non-BYPASSRLS
-- role, and the revoked grant denies it a second time. Same shape as
-- event_secrets and member_codes.

CREATE OR REPLACE TRIGGER secret_cards_updated
  BEFORE UPDATE ON public.secret_cards
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ PULL LEDGER ============
CREATE TABLE IF NOT EXISTS public.secret_card_pulls (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  -- RESTRICT, not CASCADE: the ledger is the permanent record of what somebody
  -- actually pulled. Cascading a catalogue delete would erase that.
  secret_card_id uuid NOT NULL REFERENCES public.secret_cards(id) ON DELETE RESTRICT,
  -- The league day this pull was spent on, decided by the SERVER. A date, not a
  -- text day-key, so the unique index is exact.
  pulled_on      date NOT NULL,
  -- Flavour only, and nullable: a pull can happen out of season. SET NULL rather
  -- than CASCADE because the pull outlives the event — that is the whole point.
  event_id       uuid REFERENCES public.events(id) ON DELETE SET NULL,
  is_duplicate   boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.secret_card_pulls IS
  'Who pulled which secret card, and on which league day. Readable by anon this would be worse than the catalogue: it leaks card ids, who owns what, and the set size from a row count against the roster.';

-- THE one-per-day rule, in the schema rather than in the UI. Same reasoning as
-- award_votes' UNIQUE (event_id, category, voter_participant_id). An INDEX rather
-- than a table constraint so it is re-runnable; every ON CONFLICT that targets it
-- therefore infers by COLUMNS, never by constraint name.
CREATE UNIQUE INDEX IF NOT EXISTS secret_card_pulls_one_per_day
  ON public.secret_card_pulls (participant_id, pulled_on);

-- At most one *ownership* row per member per card. Duplicates are exempt, and a
-- duplicate can only exist because a non-duplicate already does.
CREATE UNIQUE INDEX IF NOT EXISTS secret_card_pulls_owned_once
  ON public.secret_card_pulls (participant_id, secret_card_id)
  WHERE NOT is_duplicate;

CREATE INDEX IF NOT EXISTS secret_card_pulls_card_idx
  ON public.secret_card_pulls (secret_card_id);

ALTER TABLE public.secret_card_pulls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.secret_card_pulls FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.secret_card_pulls TO service_role;

-- NO ALTER PUBLICATION supabase_realtime for either table. Publishing them would
-- broadcast every pull to every connected phone: the leak above, and the exact
-- opposite of the design.

-- ============ ONE ACTIVE EVENT ============
-- requireLeagueAdmin resolves "the current combine" server-side to authorize
-- edits to a catalogue that has no event of its own. events.active is a plain
-- boolean today, so two active events are representable and that resolution could
-- disagree with getActiveEvent's.
CREATE UNIQUE INDEX IF NOT EXISTS events_one_active
  ON public.events (active) WHERE active;

-- ============ THE DAILY PULL ============
--
-- Selection happens in SQL for two reasons: atomicity (read-what-you-don't-own
-- and insert are one transaction) and shape (the catalogue never leaves Postgres
-- as a *set*, so there is no variable holding it one careless return from the wire).
CREATE OR REPLACE FUNCTION public.pull_secret_card(
  _participant_id uuid,
  _event_id       uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
-- The league day is decided here and nowhere else. The zone is baked in rather
-- than passed as an argument: a caller-chosen zone can shift the day boundary by
-- 26 hours and farm two cards across one wall-clock day.
SET search_path = public
SET timezone = 'America/New_York'
AS $$
DECLARE
  _day  date := current_date;
  _card uuid;
  _dupe boolean := false;
  _row  public.secret_card_pulls;
BEGIN
  -- Serialize this member's concurrent pulls and prove the member exists, the way
  -- cast_award_vote locks the event row before touching award_votes.
  PERFORM 1 FROM public.participants WHERE id = _participant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Participant not found'; END IF;

  -- Already spent today: return the same card. A double-tap or a retried request
  -- should resume the reveal, not fail.
  SELECT * INTO _row FROM public.secret_card_pulls
   WHERE participant_id = _participant_id AND pulled_on = _day;
  IF FOUND THEN
    RETURN jsonb_build_object('pullId', _row.id, 'cardId', _row.secret_card_id,
      'day', _row.pulled_on, 'duplicate', _row.is_duplicate, 'fresh', false);
  END IF;

  -- `art_path IS NOT NULL` is load-bearing: createSecretCards commits the row
  -- before the upload, so a failed upload would otherwise leave a pullable blank
  -- that burns somebody's once-a-day pull forever.
  SELECT c.id INTO _card FROM public.secret_cards c
   WHERE c.active AND c.art_path IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.secret_card_pulls p
                      WHERE p.participant_id = _participant_id
                        AND p.secret_card_id = c.id)
   ORDER BY random() LIMIT 1;

  IF _card IS NULL THEN
    -- Whole set owned. A duplicate keeps the daily ritual alive; it writes a
    -- ledger row but no new ownership (see secret_card_pulls_owned_once).
    SELECT c.id INTO _card FROM public.secret_cards c
     WHERE c.active AND c.art_path IS NOT NULL ORDER BY random() LIMIT 1;
    _dupe := _card IS NOT NULL;
  END IF;

  -- Nothing pullable yet. Burn no pull and record nothing, so the member can try
  -- again the moment the commissioner uploads the first card.
  IF _card IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.secret_card_pulls
    (participant_id, secret_card_id, pulled_on, event_id, is_duplicate)
  VALUES (_participant_id, _card, _day, _event_id, _dupe)
  -- Inferred by columns. secret_card_pulls_one_per_day is an INDEX, not a
  -- constraint, so ON CONFLICT ON CONSTRAINT <name> would raise on every call.
  ON CONFLICT (participant_id, pulled_on) DO NOTHING
  RETURNING * INTO _row;

  IF _row.id IS NULL THEN
    -- The row lock should make this unreachable; the unique index makes it
    -- harmless. The loser of a race gets a card, not an error.
    SELECT * INTO _row FROM public.secret_card_pulls
     WHERE participant_id = _participant_id AND pulled_on = _day;
    RETURN jsonb_build_object('pullId', _row.id, 'cardId', _row.secret_card_id,
      'day', _row.pulled_on, 'duplicate', _row.is_duplicate, 'fresh', false);
  END IF;

  RETURN jsonb_build_object('pullId', _row.id, 'cardId', _row.secret_card_id,
    'day', _row.pulled_on, 'duplicate', _row.is_duplicate, 'fresh', true);
END;
$$;

-- These two lines are the most important in the migration. A SECURITY DEFINER
-- function keeps Postgres's default EXECUTE TO PUBLIC; without the revoke,
-- POST /rest/v1/rpc/pull_secret_card with the publishable key — which ships to
-- every browser — hands out the entire set with no token at all, and spends
-- everyone else's daily pull while doing it.
REVOKE ALL ON FUNCTION public.pull_secret_card(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pull_secret_card(uuid, uuid) TO service_role;

-- ============ STATUS (pure read) ============
-- Separate from the pull so that opening the pack screen can never spend the drop.
CREATE OR REPLACE FUNCTION public.secret_pull_status(_participant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET timezone = 'America/New_York'   -- must match pull_secret_card
AS $$
DECLARE _day date := current_date;
BEGIN
  RETURN jsonb_build_object(
    'day', _day,
    'pulledToday', EXISTS (SELECT 1 FROM public.secret_card_pulls
                            WHERE participant_id = _participant_id AND pulled_on = _day),
    -- How many this member owns. Never how many exist — the vault line has no
    -- denominator precisely because there is none to show.
    'pulled', (SELECT count(*) FROM public.secret_card_pulls
                WHERE participant_id = _participant_id AND NOT is_duplicate),
    -- Only ever "there is something to pull", never how much.
    'available', EXISTS (SELECT 1 FROM public.secret_cards
                          WHERE active AND art_path IS NOT NULL),
    -- Counted against the league day rather than the phone's, which can be hours
    -- out for someone travelling.
    'resetsAt', ((_day + 1)::timestamp AT TIME ZONE current_setting('TimeZone'))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.secret_pull_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.secret_pull_status(uuid) TO service_role;
