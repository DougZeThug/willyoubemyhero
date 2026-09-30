-- The capstone moves to day 60, and taking it starts the run again.
--
-- 100 days was a rung nobody was ever going to stand on: in a league that plays
-- one weekend a year, a treadmill three months long is not a goal, it is a
-- reason to stop. 60 is still a long walk and still pays the 0.5% card.
--
-- Dropping 100 is safe here and is NOT a licence to renumber rungs in general:
-- the value is stored in streak_milestone_claims.milestone, and 100 has never
-- been claimed by anybody (3, 7, 14 and 30 have). Removing an unclaimed rung
-- orphans nothing. Moving 30 would still hand every past claimant a second card.
--
-- And the capstone now RESETS the run. Without that, the ladder ends: past day
-- 60 there is nothing left to earn and the streak is a number that only goes up.
-- Claiming the mythic cuts the walk off at the claim day, so that day becomes
-- day 1 of a fresh run and the whole ladder is climbable again.
--
-- The cut-off is derived, never stored: the claim row already records the day,
-- so nothing has to be kept in step, and it travels with a guest's history for
-- free because claim_guest_streak_milestones already moves those rows.

-- ============ THE WALK, WITH THE CAPSTONE CUT-OFF ============
--
-- Signature unchanged, so no drop and no re-grant. The body is 20260824130000's
-- walk with one extra CTE in front of it.
CREATE OR REPLACE FUNCTION public.streak_runs(_participant_id uuid, _guest_id uuid)
RETURNS TABLE (started_on date, ended_on date, len int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- The last day-60 reward this identity took, if any. Days BEFORE it are no
  -- longer part of any live run; the claim day itself still counts, so somebody
  -- who claims and then keeps opening is on day 2 tomorrow rather than being
  -- told their streak is dead the morning after their best one.
  WITH cut AS (
    SELECT max(claimed_on) AS day
      FROM public.streak_milestone_claims
     WHERE milestone = 60
       AND ((_participant_id IS NOT NULL AND participant_id = _participant_id)
         OR (_guest_id       IS NOT NULL AND guest_id       = _guest_id))
  ),
  -- DISTINCT because pack_opens_one_per_day is PARTIAL: "one row per day" only
  -- holds where participant_id IS NOT NULL. True of this filter either way, but
  -- the walk should not depend on reading the index that closely.
  days AS (
    SELECT DISTINCT opened_on
      FROM public.pack_opens, cut
     WHERE ((_participant_id IS NOT NULL AND participant_id = _participant_id)
         OR (_guest_id       IS NOT NULL AND guest_id       = _guest_id))
       AND (cut.day IS NULL OR opened_on >= cut.day)
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

-- ============ THE CLAIM, WITH THE NEW CAPSTONE ============
--
-- Replaced in place, carried over verbatim from 20260824190000; the only edits
-- are the rung list and the floor CASE.
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
  -- db test pins against this. A rung that has ever been claimed is frozen —
  -- see the note at the top of this file for why 100 could go.
  IF _milestone NOT IN (3, 7, 14, 30, 60) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_milestone');
  END IF;

  -- And the floor each rung pays at, authoritative here for exactly the reason
  -- the rungs are: a map that lived only in the client bundle would be a map
  -- anybody could edit. Mirrors STREAK_MILESTONES[].tierFloor, pinned by the same
  -- db test. Day 3 has none and falls out as NULL, which
  -- roll_secret_tier_at_least reads as "no floor".
  _floor := CASE _milestone
              WHEN 7  THEN 'rare'
              WHEN 14 THEN 'epic'
              WHEN 30 THEN 'legendary'
              WHEN 60 THEN 'mythic'
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
  -- that killed it is what separates the two runs. A run restarted by the day-60
  -- cut-off is the same shape — the cut is what separates those two.
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