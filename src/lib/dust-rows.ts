// A supabase client that will talk to the dust tables `types.ts` has never heard
// of.
//
// The same escape hatch streaks-db.server.ts and trophies-db.server.ts open, and
// for the same reason: src/integrations/supabase/types.ts is `supabase gen types`
// output, must not be hand-edited, and is .prettierignore'd — so `dust_ledger`,
// along with `dust_balance`, `mill_card_copy`, `sell_secret_card`,
// `buy_bonus_secret_pull` and `reroll_copy_edition`, are compile errors against
// the generated `Database` type, which is an alias rather than an interface and
// so cannot be rescued by declaration merging.
//
// The TYPES below outlive the shim. `Returns: Json` can never give you a
// discriminated union, so these have to be written by hand however the client is
// eventually obtained.
import type { SupabaseClient } from "@supabase/supabase-js";
// A top-level client.server import is safe here and nowhere else: this is a
// *.server.ts module, so it never reaches the client bundle.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { CompletedCollection } from "./collection-trophies";

export type DustLedgerRow = {
  id: number;
  participant_id: string;
  delta: number;
  reason: string;
  ref: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
};

/**
 * Why every one of these fails softly.
 *
 * None of them is something a person can act on by retrying differently, and all
 * of them are something to say on the button — "that is your last one", "somebody
 * has already been offered it", "not enough dust yet". Anything genuinely wrong
 * raises instead, which rolls the debit back with it.
 */
export type DustFailure =
  // The commissioner's switch is off. Not an error and not the player's doing —
  // the whole economy is simply not live yet.
  | "disabled"
  | "not_found"
  | "not_yours"
  | "last_copy"
  | "too_fresh"
  | "staked"
  | "insufficient"
  | "unavailable";

export type MillCardCopyResult =
  | {
      ok: true;
      awarded: number;
      edition: string;
      eventParticipantId: string;
      balance: number;
    }
  | { ok: false; reason: DustFailure; balance?: number; price?: number };

/**
 * Selling a secret copy, priced by its tier.
 *
 * No `last_copy` among the refusals, and that is the feature: any copy sells,
 * including your only one — the rule `trade_item_is_spare`'s secret branch
 * already keeps. `too_fresh` covers today's un-granted pull, which is a security
 * rule rather than a product one; see `sell_secret_card`.
 */
export type SellSecretResult =
  | {
      ok: true;
      awarded: number;
      tier: string;
      secretCardId: string;
      balance: number;
    }
  | { ok: false; reason: DustFailure; balance?: number; price?: number };

/** The pull half is the same shape pull_bonus_secret_card hands back. */
export type BoughtPull = {
  pullId: string;
  cardId: string;
  day: string;
  duplicate: boolean;
  tier: string;
  granted: true;
  completedCollection: CompletedCollection | null;
};

export type BuyBonusPullResult =
  | { ok: true; price: number; balance: number; pull: BoughtPull }
  | { ok: false; reason: DustFailure; balance?: number; price?: number };

export type RerollEditionResult =
  | {
      ok: true;
      price: number;
      from: string;
      to: string;
      eventParticipantId: string;
      balance: number;
    }
  | { ok: false; reason: DustFailure; balance?: number; price?: number };

export function dustDb(): SupabaseClient {
  return supabaseAdmin as unknown as SupabaseClient;
}
