-- Pack streaks, and the milestones they pay out.
--
-- A streak is not stored: it is a walk over `pack_opens`, which has carried one
-- row per identity per league day since 20260731120000. That is why this feature
-- needs so little schema — the ledger already exists, and `claim_guest_packs`
-- already moves it onto a participant, so a streak survives the guest -> member
-- claim without anything here knowing about it.
--
-- What IS stored is the claim, because a payout must happen exactly once.

-- ============ THE RUN WALK ============
--
-- Gaps and islands: within a run of consecutive days `opened_on - row_number()`
-- is constant, so grouping on it collapses each run to one row.
--
-- The ::int cast is load-bearing. row_number() is bigint and there is no
-- `date - bigint` operator, so without it this fails at call time rather than at
-- create time.
--
-- A function rather than a CTE inlined at its one call site, because
-- src/lib/streaks.ts walks the same days in TypeScript to decide whether to show
-- the claim button. Two implementations that disagree would show a button that
-- does nothing, so a db test calls this directly and pins it against walkStreak().
CREATE OR REPLACE FUNCTION public.streak_runs(_participant_id uuid, _guest_id uuid)
RETURNS TABLE (started_on date, ended_on date, len int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- DISTINCT because pack_opens_one_per_day is PARTIAL: "one row per day" only
  -- holds where participant_id IS NOT NULL. True of this filter either way, but
  -- the walk should not depend on reading the index that closely.
  WITH days AS (
    SELECT DISTINCT opened_on
      FROM public.pack_opens
     WHERE (_participant_id IS NOT NULL AND participant_id = _participant_id)
        OR (_guest_id       IS NOT NULL AND guest_id       = _guest_id)
  ), walk AS (
    SELECT opened_on,
           opened_on - (row_number() OVER (ORDER BY opened_on))::int AS grp
      FROM days
  )
  SELECT min(opened_on), max(opened_on), count(*)::int
    FROM walk
   GROUP BY grp;
$$;

REVOKE ALL ON FUNCTION public.streak_runs(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.streak_runs(uuid, uuid) TO service_role;

-- ============ THE CLAIMS ============
--
-- Keyed on the run's FIRST day, not on the milestone alone: a streak that breaks
-- and is rebuilt is a new run and legitimately re-earns its rewards. Keying this
-- way makes that fall out instead of needing a reset column somebody has to
-- remember to clear.
--
-- Actor-keyed with two partial unique indexes rather than the flat primary key
-- the roadmap sketched, because a guest builds a real streak and can cash it
-- once they have an account — and a nullable column cannot carry a PK. Same
-- shape pack_opens itself moved to in 20260818192450 when it gained guest_id.
CREATE TABLE IF NOT EXISTS public.streak_milestone_claims (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id    uuid REFERENCES public.participants(id) ON DELETE CASCADE,
  guest_id          uuid,
  streak_started_on date NOT NULL,
  milestone         int  NOT NULL,
  claimed_on        date NOT NULL,
  -- Append-only vocabulary. Only 'secret' is written today: card_copies is keyed
  -- on a participant, so a roster payout is unreachable for a guest. The column
  -- exists so adding one later is not a migration.
  reward_kind       text NOT NULL DEFAULT 'secret',
  -- The secret_card_pulls row this paid out. No foreign key, on purpose: a pull
  -- moves between identities when a guest claims, and this is a receipt rather
  -- than a live reference.
  reward_ref        uuid,
  event_id          uuid REFERENCES public.events(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT streak_milestone_claims_milestone_positive CHECK (milestone > 0),
  CONSTRAINT streak_milestone_claims_reward_kind_ck CHECK (reward_kind IN ('secret', 'roster')),
  CONSTRAINT streak_milestone_claims_one_identity
    CHECK ((participant_id IS NULL) <> (guest_id IS NULL))
);

COMMENT ON TABLE public.streak_milestone_claims IS
  'One row per milestone cashed in, per identity, per streak run. Server-only, same posture as pack_opens: nobody is ever told what somebody else has claimed.';

CREATE UNIQUE INDEX IF NOT EXISTS streak_milestone_claims_once
  ON public.streak_milestone_claims (participant_id, streak_started_on, milestone)
  WHERE participant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS streak_milestone_claims_guest_once
  ON public.streak_milestone_claims (guest_id, streak_started_on, milestone)
  WHERE guest_id IS NOT NULL;

ALTER TABLE public.streak_milestone_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.streak_milestone_claims FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.streak_milestone_claims TO service_role;
-- No policies, on purpose: RLS on with zero policies denies every non-BYPASSRLS
-- role, and the revoked grant denies it a second time. Same shape as pack_opens.

-- NO ALTER PUBLICATION supabase_realtime. Publishing this tells every connected
-- phone who just collected what, which is the opposite of a reveal.

-- ============ THE BONUS PULL ============
--
-- A secret outside the daily drop. `granted = true` is what sidesteps
-- secret_card_pulls_one_per_day, whose predicate is WHERE NOT granted — the same
-- escape hatch grant_secret_card uses, and for the same reason. A bonus pull
-- therefore never costs somebody their free pull for the day.
--
-- Selection is lifted from pull_secret_card unchanged, including the
-- Efraimidis-Spirakis weighted draw: key = -ln(random()) / weight, smallest key
-- wins. Weight 0 is excluded up front so a retired card never appears even as a
-- duplicate.
--
-- No ON CONFLICT, matching grant_secret_card: pass 1 only ever picks a card this
-- owner does not hold, it runs under the lock taken above, and pass 2 sets
-- is_duplicate, which is outside secret_card_pulls_owned_once's predicate
-- entirely. A unique violation here is a bug, and raising rolls the caller's
-- claim row back with it — which is the outcome we want.
CREATE OR REPLACE FUNCTION public.pull_bonus_secret_card(
  _participant_id uuid,
  _guest_id       uuid,
  _event_id       uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET timezone = 'America/New_York'
AS $$
DECLARE
  _day  date := current_date;
  _card uuid;
  _dupe boolean := false;
  _tier text;
  _row  public.secret_card_pulls;
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

  SELECT c.id INTO _card FROM public.secret_cards c
   WHERE c.active AND c.art_path IS NOT NULL AND c.weight > 0
     AND NOT EXISTS (SELECT 1 FROM public.secret_card_pulls p
                      WHERE p.secret_card_id = c.id
                        AND NOT p.is_duplicate
                        AND ((_participant_id IS NOT NULL AND p.participant_id = _participant_id)
                          OR (_guest_id       IS NOT NULL AND p.guest_id       = _guest_id)))
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
    VALUES (_participant_id, _card, _day, _event_id, _dupe, true, _tier)
    RETURNING * INTO _row;
  ELSE
    INSERT INTO public.secret_card_pulls
      (guest_id, secret_card_id, pulled_on, event_id, is_duplicate, granted, tier)
    VALUES (_guest_id, _card, _day, _event_id, _dupe, true, _tier)
    RETURNING * INTO _row;
  END IF;

  -- Best wins, never down. A duplicate that rolled better upgrades the copy you
  -- already own, which is the row the vault reads from. Same rule as
  -- pull_secret_card.
  IF _dupe THEN
    UPDATE public.secret_card_pulls o
       SET tier = _row.tier
     WHERE o.secret_card_id = _card
       AND NOT o.is_duplicate
       AND ((_participant_id IS NOT NULL AND o.participant_id = _participant_id)
         OR (_guest_id       IS NOT NULL AND o.guest_id       = _guest_id))
       AND public.secret_tier_rank(_row.tier) < public.secret_tier_rank(o.tier);
  END IF;

  RETURN jsonb_build_object('pullId', _row.id, 'cardId', _row.secret_card_id,
    'day', _row.pulled_on, 'duplicate', _row.is_duplicate, 'tier', _row.tier,
    'granted', true);
END;
$$;

REVOKE ALL ON FUNCTION public.pull_bonus_secret_card(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pull_bonus_secret_card(uuid, uuid, uuid) TO service_role;

-- ============ THE CLAIM ============
CREATE OR REPLACE FUNCTION public.claim_streak_milestone(
  _participant_id uuid,
  _guest_id       uuid,
  _milestone      int,
  _event_id       uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
-- The fifth daily thing in this app, in the same zone as the other four. Fixed
-- here rather than taken as a parameter so a phone with a wrong clock — or a set
-- one — cannot shift where a day ends and mint an extra milestone.
SET timezone = 'America/New_York'
AS $$
DECLARE
  _today      date := current_date;
  _started_on date;
  _ended_on   date;
  _len        int;
  _pull       jsonb;
  _claim_id   uuid;
BEGIN
  IF (_participant_id IS NULL) = (_guest_id IS NULL) THEN
    RAISE EXCEPTION 'Exactly one of participant or guest is required';
  END IF;

  -- The ladder, baked in. This function is SECURITY DEFINER and reachable by
  -- anything holding service_role, so the Zod validator in streaks.functions.ts
  -- is not a control: with the rungs only there, one future caller passing 1
  -- mints a card a day. Mirrors STREAK_MILESTONES in src/lib/streaks.ts, which a
  -- db test pins against this. Append a rung, never renumber one — the value is
  -- stored in streak_milestone_claims.milestone.
  IF _milestone NOT IN (3, 7, 14, 30) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_milestone');
  END IF;

  -- The same row pull_secret_card and accept_trade_offer lock, and a guest gets
  -- the same advisory lock pull_secret_card gives them. One row either way, so
  -- there is no order to get wrong and no new deadlock shape.
  IF _participant_id IS NOT NULL THEN
    PERFORM 1 FROM public.participants WHERE id = _participant_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended(_guest_id::text, 0));
  END IF;

  -- The account gate, enforced here and not only in the server function.
  -- A milestone buys a permanent collection card, and a device-local guest token
  -- is one cleared browser away from losing it — so the reward is gated on
  -- something durable. Indexed both ways by account_identities_participant_idx
  -- and account_identities_guest_idx.
  PERFORM 1 FROM public.account_identities
   WHERE (_participant_id IS NOT NULL AND participant_id = _participant_id)
      OR (_guest_id       IS NOT NULL AND guest_id       = _guest_id);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'account_required');
  END IF;

  IF _event_id IS NULL THEN
    SELECT id INTO _event_id FROM public.events WHERE active ORDER BY year DESC LIMIT 1;
  END IF;

  -- Alive (ends today) or at risk (ends yesterday). At most one run can match:
  -- a run ending today already contains yesterday.
  --
  -- A milestone earned on a streak that then died is gone, because the run no
  -- longer ends in that window. That is the cost of a claim button rather than
  -- an auto-grant, and it is stated here rather than left to be discovered in a
  -- garden: the button is in the summary on the day you earn it.
  SELECT r.started_on, r.ended_on, r.len
    INTO _started_on, _ended_on, _len
    FROM public.streak_runs(_participant_id, _guest_id) r
   WHERE r.ended_on IN (_today, _today - 1);

  IF _len IS NULL OR _len < _milestone THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_earned');
  END IF;

  -- claim_guest_packs can move a run's START backwards, by merging an older
  -- guest history onto an identity that already claimed on the shorter run. The
  -- unique index would not catch that — the key changed — so the payout would
  -- land twice. A claim whose start date falls anywhere inside this run belongs
  -- to this streak, however it was rebuilt.
  --
  -- The legitimate "a rebuilt streak re-earns" case is untouched: a dead streak's
  -- old start is outside the new run's window by construction, because the gap
  -- that killed it is what separates the two runs.
  IF EXISTS (
    SELECT 1 FROM public.streak_milestone_claims c
     WHERE ((_participant_id IS NOT NULL AND c.participant_id = _participant_id)
         OR (_guest_id       IS NOT NULL AND c.guest_id       = _guest_id))
       AND c.milestone = _milestone
       AND c.streak_started_on BETWEEN _started_on AND _ended_on
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'claimed');
  END IF;

  -- Checked before the claim row goes in, so an empty catalogue is a soft answer
  -- rather than a rolled-back transaction and a raw Postgres error string.
  IF NOT EXISTS (SELECT 1 FROM public.secret_cards
                  WHERE active AND art_path IS NOT NULL AND weight > 0) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unavailable');
  END IF;

  -- The claim goes in FIRST. Reversed, a double tap pays twice: a plpgsql RETURN
  -- after the payout commits it, so there would be nothing left to roll back.
  -- This way a payout that raises takes the claim row with it.
  INSERT INTO public.streak_milestone_claims
    (participant_id, guest_id, streak_started_on, milestone, claimed_on, reward_kind, event_id)
  VALUES (_participant_id, _guest_id, _started_on, _milestone, _today, 'secret', _event_id)
  ON CONFLICT DO NOTHING
  RETURNING id INTO _claim_id;

  IF _claim_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'claimed');
  END IF;

  _pull := public.pull_bonus_secret_card(_participant_id, _guest_id, _event_id);
  -- Unreachable: the EXISTS above already proved the pool is non-empty inside
  -- this transaction, under this lock. Raised rather than returned so the claim
  -- row goes with it if that ever stops being true — nobody spends a milestone
  -- on a card that never arrived.
  IF _pull IS NULL THEN RAISE EXCEPTION 'No secret card available'; END IF;

  UPDATE public.streak_milestone_claims
     SET reward_ref = (_pull->>'pullId')::uuid
   WHERE id = _claim_id;

  RETURN jsonb_build_object('ok', true, 'milestone', _milestone, 'streak', _len,
    'startedOn', _started_on,
    'reward', jsonb_build_object('kind', 'secret') || _pull);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_streak_milestone(uuid, uuid, int, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_streak_milestone(uuid, uuid, int, uuid) TO service_role;

-- ============ CARRYING A GUEST'S CLAIMS ============
--
-- The twin of claim_guest_packs, and it has to be called wherever that is.
-- Without it a guest who claims day 3, then claims a player, has their pack_opens
-- re-parented while the claim rows stay behind on the dead guest id — so the same
-- milestone reads unclaimed on the member and pays a second time.
--
-- Collision-drop then re-parent, the same shape claim_guest_packs uses: a
-- milestone the member has already cashed on that run is dropped rather than
-- merged, because one payout per run is the rule the table exists to enforce.
--
-- Never raises. Like claim_guest_packs, this must not be the reason a claim
-- fails; a stranded claim row costs a duplicate reward, a failed claim costs
-- somebody their whole collection.
CREATE OR REPLACE FUNCTION public.claim_guest_streak_milestones(
  _participant_id uuid,
  _guest_id       uuid
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _n int;
BEGIN
  IF _participant_id IS NULL OR _guest_id IS NULL THEN RETURN 0; END IF;

  PERFORM 1 FROM public.participants WHERE id = _participant_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  DELETE FROM public.streak_milestone_claims g
   WHERE g.guest_id = _guest_id
     AND EXISTS (SELECT 1 FROM public.streak_milestone_claims m
                  WHERE m.participant_id = _participant_id
                    AND m.streak_started_on = g.streak_started_on
                    AND m.milestone = g.milestone);

  UPDATE public.streak_milestone_claims
     SET participant_id = _participant_id, guest_id = NULL
   WHERE guest_id = _guest_id;

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_guest_streak_milestones(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_guest_streak_milestones(uuid, uuid) TO service_role;

-- Guest -> guest, for a device folded into an account that is itself still a
-- guest. The twin of merge_guest_packs.
CREATE OR REPLACE FUNCTION public.merge_guest_streak_milestones(
  _into_guest uuid,
  _from_guest uuid
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _n int;
BEGIN
  IF _into_guest IS NULL OR _from_guest IS NULL OR _into_guest = _from_guest THEN
    RETURN 0;
  END IF;

  DELETE FROM public.streak_milestone_claims g
   WHERE g.guest_id = _from_guest
     AND EXISTS (SELECT 1 FROM public.streak_milestone_claims m
                  WHERE m.guest_id = _into_guest
                    AND m.streak_started_on = g.streak_started_on
                    AND m.milestone = g.milestone);

  UPDATE public.streak_milestone_claims
     SET guest_id = _into_guest
   WHERE guest_id = _from_guest;

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_guest_streak_milestones(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_guest_streak_milestones(uuid, uuid) TO service_role;
