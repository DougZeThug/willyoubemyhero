// The shapes the streak RPCs hand back.
//
// The client shim this file used to open is gone: types.ts now covers
// `streak_milestone_claims` and `claim_streak_milestone`, so the call sites are
// on the typed supabaseAdmin. The types outlive it — `Returns: Json` can never
// give you a discriminated union, so ClaimStreakMilestoneResult is hand-written
// however the client is obtained.
export type StreakClaimRow = {
  id: string;
  participant_id: string | null;
  guest_id: string | null;
  streak_started_on: string;
  milestone: number;
  claimed_on: string;
  reward_kind: string;
  reward_ref: string | null;
  event_id: string | null;
  created_at: string;
};

/** The secret half of a payout — the same shape pull_secret_card hands back. */
export type StreakSecretReward = {
  kind: "secret";
  pullId: string;
  cardId: string;
  day: string;
  duplicate: boolean;
  tier: string;
  granted: true;
};

/**
 * What public.claim_streak_milestone returns.
 *
 * Every failure here is a soft one somebody can be told about — an empty
 * catalogue, a streak that is not there yet, a second tap on a button that
 * already paid. Anything genuinely wrong raises instead, which rolls the claim
 * row back with it.
 */
export type ClaimStreakMilestoneResult =
  | {
      ok: true;
      milestone: number;
      streak: number;
      startedOn: string;
      /**
       * The floor this rung guaranteed, straight off the SQL CASE. `string` and
       * not SecretTier: it crosses the wire as a bare Postgres text, and the
       * screens read the ladder in streaks.ts rather than this. It is here so a
       * db test can pin the two maps against each other.
       */
      floor: string | null;
      reward: StreakSecretReward;
    }
  | {
      ok: false;
      reason:
        | "not_found"
        | "account_required"
        | "unknown_milestone"
        | "not_earned"
        | "claimed"
        | "unavailable";
    };
