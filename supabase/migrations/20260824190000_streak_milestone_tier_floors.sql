-- Milestone rewards that scale with the run that earned them.
--
-- 20260824130000 paid every rung an identically rolled secret, and a rebuilt run
-- legitimately re-earns the whole ladder. Together those made the cheapest rung
-- the best play: three days on and one day off pays a secret every four days,
-- while walking a clean thirty pays four in thirty. Same card either way, so
-- breaking your own streak on purpose strictly beat keeping it.
--
-- The fix is quality, not quantity. Every rung still pays exactly one secret and
-- a rebuilt run still re-earns them all — but the deeper the rung, the higher the
-- floor its roll cannot fall below. Farming day 3 now farms commons.
--
-- The floors, against the base rate in roll_secret_tier() (70/18/8/3.5/0.5):
--
--   day   3  ->  no floor      the plain roll
--   day   7  ->  rare          worst case moves off common
--   day  14  ->  epic
--   day  30  ->  legendary     a 3.5% pull, guaranteed
--   day 100  ->  mythic        the 0.5% one. A capstone, not a treadmill.
--
-- A floor only ever upgrades, so day 30 can still roll mythic on its own.
--
-- Day 100 is APPENDED to the ladder, never renumbered into it: the rung is
-- stored in streak_milestone_claims.milestone, so moving 30 to 31 would orphan
-- every claim already paid at 30 and hand those people the reward twice. Same
-- contract as the award ids in awards.ts.

-- ============ THE FLOORED ROLL ============
--
-- Its own function rather than three lines inlined into the pull, because this is
-- the half worth testing on its own: a "never worse than epic" loop over a few
-- hundred rolls needs no participant, no account and no pack_opens behind it.
CREATE OR REPLACE FUNCTION public.roll_secret_tier_at_least(_floor text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE _tier text := public.roll_secret_tier();
BEGIN
  -- secret_tier_rank COALESCEs anything it does not recognise to 99, so a NULL
  -- floor — day 3, which has none — or a misspelled one can never win this
  -- comparison and the plain roll stands. That is deliberately the failure mode:
  -- claim_streak_milestone files its claim row BEFORE calling the payout, so a
  -- floor it cannot read must degrade to the base rate rather than raise and take
  -- somebody's claim down with it.
  IF public.secret_tier_rank(_floor) < public.secret_tier_rank(_tier) THEN
    RETURN _floor;
  END IF;
  RETURN _tier;
END;
$$;

REVOKE ALL ON FUNCTION public.roll_secret_tier_at_least(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roll_secret_tier_at_least(text) TO service_role;

-- ============ THE BONUS PULL, WITH A FLOOR ============
--
-- Dropped rather than replaced. A DEFAULT on a new parameter creates an OVERLOAD,
-- not a replacement, and two functions of this name where one carries a default
-- make every three-argument call ambiguous — including the one in
-- tests/db/streaks.test.ts. The old signature has to go before the new one lands.
--
-- The drop takes its grants with it, so both are re-issued below.
DROP FUNCTION IF EXISTS public.pull_bonus_secret_card(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.pull_bonus_secret_card(
  _participant_id uuid,
  _guest_id       uuid,
  _event_id       uuid,
  -- NULL is day 3's floor, and the answer for any caller that has none.
  _floor_tier     text DEFAULT NULL
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

  -- The one line that differs from pull_secret_card. WHICH card you get is still
  -- the plain weighted draw above — the milestone buys the level, not the art,
  -- because biasing the draw as well would quietly undo secret_cards.weight.
  _tier := public.roll_secret_tier_at_least(_floor_tier);

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
  -- pull_secret_card — and it needs no floor of its own, because it compares
  -- ranks and so carries a floored tier upward for free.
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

REVOKE ALL ON FUNCTION public.pull_bonus_secret_card(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pull_bonus_secret_card(uuid, uuid, uuid, text) TO service_role;

-- ============ THE CLAIM, WITH THE LADDER IT PAYS ON ============
--
-- Replaced in place — the signature is unchanged, so no drop and no re-grant.
-- Everything about the ORDER of this function is load-bearing and carried over
-- verbatim from 20260824130000; the only edits are the fifth rung and the floor
-- it and its three seniors now pay at.
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
  _floor      text;
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
  IF _milestone NOT IN (3, 7, 14, 30, 100) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_milestone');
  END IF;

  -- And the floor each rung pays at, authoritative here for exactly the reason
  -- the rungs are: a map that lived only in the client bundle would be a map
  -- anybody could edit. Mirrors STREAK_MILESTONES[].tierFloor, pinned by the same
  -- db test. Day 3 has none and falls out as NULL, which
  -- roll_secret_tier_at_least reads as "no floor".
  _floor := CASE _milestone
              WHEN 7   THEN 'rare'
              WHEN 14  THEN 'epic'
              WHEN 30  THEN 'legendary'
              WHEN 100 THEN 'mythic'
            END;

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

  _pull := public.pull_bonus_secret_card(_participant_id, _guest_id, _event_id, _floor);
  -- Unreachable: the EXISTS above already proved the pool is non-empty inside
  -- this transaction, under this lock. Raised rather than returned so the claim
  -- row goes with it if that ever stops being true — nobody spends a milestone
  -- on a card that never arrived.
  IF _pull IS NULL THEN RAISE EXCEPTION 'No secret card available'; END IF;

  UPDATE public.streak_milestone_claims
     SET reward_ref = (_pull->>'pullId')::uuid
   WHERE id = _claim_id;

  -- `floor` sits beside `milestone` and `startedOn`, NOT inside `reward`. It is a
  -- fact about the rung, not about the card — and `reward` has to stay the shape
  -- pull_secret_card hands back, which is what makes StreakSecretReward in
  -- streaks-db.server.ts an honest type. Putting it on the wire at all is for the
  -- db test that pins this CASE against STREAK_MILESTONES[].tierFloor.
  RETURN jsonb_build_object('ok', true, 'milestone', _milestone, 'streak', _len,
    'startedOn', _started_on, 'floor', _floor,
    'reward', jsonb_build_object('kind', 'secret') || _pull);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_streak_milestone(uuid, uuid, int, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_streak_milestone(uuid, uuid, int, uuid) TO service_role;
