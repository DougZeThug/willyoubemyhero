// A supabase client that will talk to the marketplace table `types.ts` has never
// heard of, plus the result types no generated signature can give us.
//
// The same escape hatch dust-db.server.ts, trades-db.server.ts and
// streaks-db.server.ts open, and for the same reason: src/integrations/supabase/
// types.ts is `supabase gen types` output, must not be hand-edited, and is
// .prettierignore'd — so `market_listings`, along with `list_card_for_dust`,
// `cancel_market_listing` and `buy_market_listing`, are compile errors against the
// generated `Database` type, which is an alias rather than an interface and so
// cannot be rescued by declaration merging.
//
// The TYPES below outlive the shim. `Returns: Json` can never give you a
// discriminated union, so these have to be written by hand however the client is
// eventually obtained.
import type { SupabaseClient } from "@supabase/supabase-js";
// A top-level client.server import is safe here and nowhere else: this is a
// *.server.ts module, so it never reaches the client bundle.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { CompletedCollection } from "./collection-trophies";
import type { DustFailure } from "./dust-db.server";
import type { MarketListingStatus } from "./market";

export type MarketListingRow = {
  id: string;
  event_id: string | null;
  seller_id: string;
  kind: "roster" | "secret";
  card_copy_id: string | null;
  secret_pull_id: string | null;
  price: number;
  status: MarketListingStatus;
  buyer_id: string | null;
  created_at: string;
  resolved_at: string | null;
};

/**
 * Why every one of these fails softly.
 *
 * The rule dust-db.server.ts states: none of them is something a person can fix by
 * retrying differently, and all of them are something to say on the button. Five
 * new members on top of {@link DustFailure}, and two of the existing words reused
 * rather than re-coined — `resolved` and `voided` already mean exactly this in
 * `AcceptTradeOfferResult`, and one vocabulary is better than two.
 */
export type MarketFailure =
  | DustFailure
  // Somebody bought it, or the seller took it down, while the shelf sat on screen.
  | "resolved"
  // The card had already moved when the buy re-validated, so the listing is gone.
  | "voided"
  // A mill, re-roll or house sale of a card that is up for sale. Take it down first.
  | "listed"
  // This exact copy is already on the shelf. Carries the listing so the sheet can
  // say what it is up at — a price is immutable for the life of a listing.
  | "already_listed"
  | "own_listing"
  | "bad_price"
  | "too_many";

export type ListCardResult =
  | { ok: true; listingId: string; price: number; kind: "roster" | "secret" }
  | { ok: false; reason: MarketFailure; listingId?: string };

export type CancelListingResult = { ok: true } | { ok: false; reason: MarketFailure };

/**
 * What a completed purchase hands back.
 *
 * `balance` rather than a total of anything else — the rule the whole dust feature
 * keeps. The card half is whichever kind was bought; the other side's fields are
 * simply absent.
 */
export type BuyListingResult =
  | {
      ok: true;
      price: number;
      kind: "roster" | "secret";
      sellerId: string;
      eventParticipantId: string | null;
      edition: string | null;
      secretCardId: string | null;
      tier: string | null;
      duplicate: boolean;
      completedCollection: CompletedCollection | null;
      balance: number;
    }
  | { ok: false; reason: MarketFailure; balance?: number; price?: number };

export function marketDb(): SupabaseClient {
  return supabaseAdmin as unknown as SupabaseClient;
}
