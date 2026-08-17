// A supabase client that will talk to the trading tables `types.ts` has never
// heard of.
//
// Exactly the escape hatch secret-cards-db.server.ts opens, and for exactly the
// same reason: src/integrations/supabase/types.ts is `supabase gen types` output,
// must not be hand-edited, and is .prettierignore'd — so `trade_offers`,
// `trade_offer_items` and `trades`, along with `create_trade_offer` and
// `accept_trade_offer`, are compile errors against the generated `Database` type,
// which is an alias rather than an interface and so cannot be rescued by
// declaration merging.
//
// Widened to the ungenericised client, recovering shape per query with
// `.returns<T>()` / `.maybeSingle<T>()`, which is already the house style.
//
// DELETE THIS FILE once types.ts has been regenerated against a project with
// 20260817120000_card_trading.sql applied: every call site then switches to plain
// `supabaseAdmin` unchanged.
import type { SupabaseClient } from "@supabase/supabase-js";
// A top-level client.server import is safe here and nowhere else: this is a
// *.server.ts module, so it never reaches the client bundle.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { TradeOfferStatus, TradeSummaryItem } from "./trades";

export type TradeOfferRow = {
  id: string;
  event_id: string | null;
  proposer_id: string;
  recipient_id: string;
  /** Unconstrained here; the CHECK lives in the migration and TradeOfferStatus mirrors it. */
  status: TradeOfferStatus;
  created_at: string;
  resolved_at: string | null;
};

export type TradeOfferItemRow = {
  id: string;
  offer_id: string;
  /** Who is GIVING this one up, resolved against the offer's two participants. */
  giver_side: "proposer" | "recipient";
  kind: "roster" | "secret";
  event_participant_id: string | null;
  /** A specific COPY: secret ownership is per-row, so a trade names the ledger row. */
  secret_pull_id: string | null;
};

export type TradeRow = {
  id: string;
  event_id: string | null;
  offer_id: string | null;
  proposer_id: string;
  recipient_id: string;
  /**
   * Public-safe summaries, built only inside accept_trade_offer. Secret items
   * carry their kind and NOTHING else — this table is anon-readable and
   * published to realtime. See the column comments in the migration.
   */
  proposer_gave: TradeSummaryItem[];
  recipient_gave: TradeSummaryItem[];
  executed_at: string;
};

/** What public.create_trade_offer returns. Every failure path raises instead. */
export type CreateTradeOfferResult = { ok: true; offerId: string };

/**
 * What public.accept_trade_offer returns.
 *
 * The two soft failures are the ones a person can be told about: `resolved` is a
 * double-tap on an offer somebody already answered, `voided` is a staked card
 * that had moved on by the time accept ran. Anything else raises.
 */
export type AcceptTradeOfferResult =
  | { ok: true; tradeId: string }
  | { ok: false; reason: "resolved" | "voided" };

export function tradesDb(): SupabaseClient {
  return supabaseAdmin as unknown as SupabaseClient;
}
