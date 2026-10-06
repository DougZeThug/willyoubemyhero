-- A milestone's reward tier becomes a receipt instead of a pointer.
--
-- streak_milestone_claims.reward_ref names the secret_card_pulls row a rung paid
-- out, and getStreakHistory read that row's `tier` to say what came out of the
-- wrapper. But `tier` on a pull is a LIVE value, not a historical one: both
-- pull_secret_card and pull_bonus_secret_card upgrade the owning copy in place
-- when a later duplicate rolls better — "best wins, never down", which is what
-- the vault is meant to show. reward_ref points at that owning row on a first
-- acquisition, so every later duplicate of the same card silently rewrote what
-- an older rung was shown to have paid. Somebody who saw "Common" in the claim
-- toast in September could open /you in October and be told the rung paid a
-- mythic. Nothing was minted or spent wrongly; the ladder simply lied about its
-- own past, and contradicted the one screen that had told the truth.
--
-- So the tier is written down where it cannot move. A duplicate reward was
-- already safe — reward_ref points at the duplicate row there, and the UPDATE
-- only ever touches NOT is_duplicate rows — but it is recorded the same way
-- rather than left to that coincidence.
--
-- The column travels with a guest's history for free: claim_guest_streak_milestones
-- moves whole claim rows, columns and all.

ALTER TABLE public.streak_milestone_claims
  ADD COLUMN IF NOT EXISTS reward_tier text;

COMMENT ON COLUMN public.streak_milestone_claims.reward_tier IS
  'The level this rung actually paid, frozen at claim time. secret_card_pulls.tier is upgraded in place by later duplicates and is not a record of what was handed over.';

-- Backfilled from the pull as it stands today, which is the best that can be
-- known about a claim made before this column existed — and is what the history
-- already renders for those rows, so nothing on screen moves. What it buys is
-- that they stop drifting: an old rung can no longer be rewritten by a duplicate
-- pulled next year. Left NULL where reward_ref names nothing, and read back with
-- a fallback for exactly that case.
UPDATE public.streak_milestone_claims c
   SET reward_tier = p.tier
  FROM public.secret_card_pulls p
 WHERE c.reward_ref = p.id
   AND c.reward_tier IS NULL;

-- ============ THE CLAIM, WRITING THE TIER DOWN ============
--
-- Carried over verbatim from 20260907235838; the only edit is the UPDATE that
-- stamps the claim row. Signature unchanged, so no drop and no re-grant.
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

  -- The tier goes in BESIDE the pointer, and that is the whole of this change.
  -- reward_ref names a secret_card_pulls row, and that row's `tier` is not a
  -- record — pull_secret_card and pull_bonus_secret_card both raise it in place
  -- when a later duplicate rolls better, which is the rule the vault wants and
  -- exactly the wrong one for a receipt. On a first acquisition reward_ref points
  -- at the owning pull, so a mythic pulled in October rewrote what September's
  -- rung was shown to have paid, and the history contradicted the toast the
  -- claim itself had put on screen.
  UPDATE public.streak_milestone_claims
     SET reward_ref  = (_pull->>'pullId')::uuid,
         reward_tier = _pull->>'tier'
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
