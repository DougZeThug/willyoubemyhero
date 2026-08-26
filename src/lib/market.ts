// The marketplace's client-safe half: view types and the labels rendered from
// them. No imports from anything *.server.ts, so this is safe in the bundle.
import type { Edition } from "./card-edition";
import type { SecretTier } from "./secret-rarity";
import { MILL_BY_EDITION, MILL_CLIENT_FLAT, SELL_BY_SECRET_TIER } from "./dust";

/**
 * The price bounds, mirrored in `market_listings_price_ck` and re-stated inside
 * `list_card_for_dust` so a bad number comes back as a reason rather than a raise.
 *
 * THE FLOOR IS LOAD-BEARING rather than a product cap. `dust_ledger_delta_nonzero`
 * is also a CHECK, so a price of 0 would reach it and raise inside a transaction
 * that has already moved a card. The ceiling is the product half: the dearest
 * thing the house sells is 150, so 9999 is far past any honest ask and still
 * refuses a fat-fingered 50000 rather than banking it.
 *
 * `tests/db/market.test.ts` pins both ends against the CHECK.
 */
export const MARKET_PRICE_MIN = 1;
export const MARKET_PRICE_MAX = 9999;

/**
 * How many listings one member may have up at once, mirrored in
 * `list_card_for_dust`.
 *
 * Not an economic rule. Thirteen people and a browse with no pagination: one
 * member shelving four hundred cards makes the screen useless for everybody else,
 * which is the only shape of denial-of-service a marketplace this size has.
 */
export const MARKET_MAX_ACTIVE = 20;

/** Mirrors the CHECK on market_listings.status. */
export type MarketListingStatus = "active" | "sold" | "cancelled" | "voided";

/**
 * One card on the shelf, as everybody browsing sees it.
 *
 * NO COPY ID AND NO PULL ID, deliberately. Buying needs the LISTING id and
 * nothing else, so sending the underlying row id would hand every member a stable
 * handle on every other member's individual rows, in bulk, for nothing. Same rule
 * `SecretSpare` already keeps by carrying no `secretCardId`.
 */
export type MarketListingItem =
  | { kind: "roster"; eventParticipantId: string; edition: Edition }
  | {
      kind: "secret";
      /**
       * "Secret card" for a card the viewer does not hold — see {@link concealed}.
       * The real name only ever reaches somebody who has already pulled one.
       */
      name: string;
      artUrl: string | null;
      tier: SecretTier;
      /**
       * True when the viewer holds no copy of this card, in which case the name
       * and art above have both been withheld and the tile renders face-down.
       *
       * A WIDER RULE THAN THE TRADE SCREEN'S, and deliberately. There, `viewerOwns`
       * hides only the art, because you cannot judge an offer sight unseen and you
       * are already inside a two-party negotiation. The public trade feed goes
       * further and names a secret outright — but read why: a name, "for a card
       * that actually changed hands", precisely so an untraded card appears
       * nowhere and the catalogue is not enumerable from that table.
       *
       * A listing is not a completed transaction. Every unowned secret in the
       * league could be on the shelf at once, so a name-bearing browse IS the
       * catalogue enumeration `secret_cards` is server-only to prevent. The tier
       * still shows, which is what prices the card and names nothing.
       */
      concealed: boolean;
    };

export type MarketListing = {
  id: string;
  sellerId: string;
  price: number;
  createdAt: string;
  item: MarketListingItem;
};

/**
 * One of your own listings, live or settled.
 *
 * `status`, `buyerId` and `resolvedAt` are here and nowhere else because a sale is
 * QUIET: it writes no row into `trades` and appears in no public feed, so your own
 * stall is the only place you will ever see that your card sold. That makes the
 * settled half of this list load-bearing rather than decoration.
 *
 * The buyer's id reaches the seller and the seller's reaches the buyer. Quiet
 * means quiet from the league, not anonymous between the two people in it.
 */
export type MyMarketListing = MarketListing & {
  status: MarketListingStatus;
  buyerId: string | null;
  resolvedAt: string | null;
};

export type MyStall = {
  active: MyMarketListing[];
  /** What settled lately, newest first. Capped server-side. */
  recent: MyMarketListing[];
};

export type MarketBrowse = {
  listings: MarketListing[];
  /**
   * The broadcast topic this member listens on, minted by the server because it is
   * HMAC'd with SESSION_SECRET and a client cannot derive its own. Nullable so a
   * fixture can say "open no channel" — the e2e suite must never reach Supabase.
   */
  nudgeTopic: string | null;
};

const STATUS_LABELS: Record<MarketListingStatus, string> = {
  active: "Up",
  sold: "Sold",
  // Distinct from voided the way trade_offers separates them: cancelled is you
  // taking it down, voided is the card having moved first.
  cancelled: "Pulled",
  voided: "Expired",
};

export function marketStatusLabel(status: string): string {
  return (STATUS_LABELS as Record<string, string>)[status] ?? "Unknown";
}

/**
 * What the house would pay for the same card — the number the price field starts
 * at, and the one printed beside it.
 *
 * A HINT, NEVER A RULE. Nothing refuses a listing below it: undercutting the mill
 * is a legitimate thing to do for a card you would rather see in somebody's
 * collection than burn. It is here so nobody shelves a platinum for 3 by accident,
 * which is the one mistake a free-text price field invites.
 *
 * Composed from the existing ladders rather than a third copy of them, so a change
 * to either reaches this automatically.
 */
export function houseFloor(item: MarketListingItem, assertedBy = "server"): number {
  return item.kind === "roster"
    ? assertedBy === "server"
      ? MILL_BY_EDITION[item.edition]
      : MILL_CLIENT_FLAT
    : SELL_BY_SECRET_TIER[item.tier];
}
