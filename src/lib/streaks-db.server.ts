// A supabase client that will talk to the streak tables `types.ts` has never
// heard of.
//
// The same escape hatch secret-cards-db.server.ts and trades-db.server.ts open,
// and for the same reason: src/integrations/supabase/types.ts is
// `supabase gen types` output, must not be hand-edited, and is .prettierignore'd
// — so `streak_milestone_claims`, along with `claim_streak_milestone` and
// `pull_bonus_secret_card`, are compile errors against the generated `Database`
// type, which is an alias rather than an interface and so cannot be rescued by
// declaration merging.
//
// Its own file rather than more rows bolted onto secret-cards-db.server.ts: that
// file's header is a standing instruction to delete it once five named migrations
// have been generated against, and folding an unrelated feature into it makes
// that harder to ever do.
//
// That regeneration has since happened, so `streaksDb()` is now a mechanical
// four-call-site removal rather than a blocked one — and 20260824190000 does not
// re-block it: it changes `pull_bonus_secret_card`, which no TypeScript calls, and
// leaves `claim_streak_milestone`'s Args and `Returns: Json` untouched.
//
// The TYPES below outlive that removal either way. `Returns: Json` can never give
// you a discriminated union, so ClaimStreakMilestoneResult has to be written by
// hand however the client is obtained.
import type { SupabaseClient } from "@supabase/supabase-js";
// A top-level client.server import is safe here and nowhere else: this is a
// *.server.ts module, so it never reaches the client bundle.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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

export function streaksDb(): SupabaseClient {
  return supabaseAdmin as unknown as SupabaseClient;
}
