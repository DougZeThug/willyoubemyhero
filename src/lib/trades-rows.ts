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
import type { CompletedCollectionFor } from "./collection-trophies";
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
  /** Both sides name a specific COPY, which is what makes a finish tradeable. */
  card_copy_id: string | null;
  secret_pull_id: string | null;
};

/**
 * One copy of a roster card. `card_pulls.pull_count` and `.edition` are derived
 * from these rows by `resync_card_pull`, so this is the grain that actually moves
 * in a trade.
 */
export type CardCopyRow = {
  id: string;
  participant_id: string;
  event_participant_id: string;
  /** Unconstrained text, exactly like card_pulls.edition — ids live in card-edition.ts. */
  edition: string;
  /**
   * Who decided this copy's finish. `'server'` means roll_card_edition() did;
   * `'client'` means a phone or a commissioner named it. Only server rows pay by
   * edition when milled — see 20260826120000.
   */
  edition_asserted_by: "client" | "server";
  /** The league day this copy was pulled on. Null once it has been traded. */
  acquired_on: string | null;
  /**
   * How this copy arrived. Append-only vocabulary, mirroring
   * `card_copies_source_ck` — which 20260818192450 widened with 'adopt' and
   * 'grant', and 20260830120000 with 'market' for a copy somebody bought.
   */
  source: "pull" | "trade" | "backfill" | "adopt" | "grant" | "market";
  /** When this copy was minted. Survives a hand-over — see acquired_at. */
  created_at: string;
  /**
   * When this copy entered its CURRENT holder's collection. Restarted on every
   * change of owner by the trigger in 20260905120000, which is what makes it
   * different from created_at on a traded or bought copy.
   */
  acquired_at: string;
};

export type TradeRow = {
  id: string;
  event_id: string | null;
  offer_id: string | null;
  proposer_id: string;
  recipient_id: string;
  /**
   * Public-safe summaries, built only inside accept_trade_offer. Secret items
   * carry their card's id and name and nothing more — this table is anon-readable
   * and published to realtime. See the column comments in the migration.
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
  | {
      ok: true;
      tradeId: string;
      /**
       * Sets this trade finished, for either party — a two-way swap genuinely
       * can complete both at once, which is why this is a list where the pull
       * and grant paths carry a single value. Each entry names its owner,
       * because the person who pressed accept is only one of the two people it
       * can belong to.
       */
      completedCollections: CompletedCollectionFor[];
    }
  | { ok: false; reason: "resolved" | "voided" };

/**
 * What public.reopen_trade_offer returns.
 *
 * Three soft failures, and each one is a different sentence worth saying:
 * `resolved` is an offer that is no longer declined or cancelled — a second tap,
 * or the other side having moved on; `expired` is an undo that arrived after the
 * window; `stale` is a staked card that has since been burnt, sold or traded, so
 * putting the offer back would only queue up a void. Anything else raises.
 */
export type ReopenTradeOfferResult =
  | { ok: true; counterpartyId: string }
  | { ok: false; reason: "resolved" | "expired" | "stale" };

export function tradesDb(): SupabaseClient {
  return supabaseAdmin as unknown as SupabaseClient;
}
