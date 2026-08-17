// The Trading Post's client-safe half: view types and the labels rendered from
// them. No imports from anything *.server.ts, so this is safe in the bundle.
import type { Edition } from "./card-edition";
import type { SecretTier } from "./secret-rarity";

/**
 * How a completed trade is described in the public feed.
 *
 * This is the shape of `trades.proposer_gave` / `recipient_gave`, and the
 * redaction is the point: a roster item names its card because that card is
 * public, and a secret item names nothing at all because the `trades` table is
 * anon-readable and published to realtime. Widening this type means widening a
 * leak — see the column comments in 20260817120000_card_trading.sql.
 */
export type TradeSummaryItem = { kind: "roster"; eventParticipantId: string } | { kind: "secret" };

/** Mirrors the CHECK on trade_offers.status. */
export type TradeOfferStatus = "pending" | "accepted" | "declined" | "cancelled" | "voided";

const OFFER_STATUSES: readonly TradeOfferStatus[] = [
  "pending",
  "accepted",
  "declined",
  "cancelled",
  "voided",
];

export function isTradeOfferStatus(value: string): value is TradeOfferStatus {
  return (OFFER_STATUSES as readonly string[]).includes(value);
}

/**
 * One card on the table, as the two parties to an offer see it.
 *
 * A secret carries its name and art here where the public feed will not: you
 * cannot judge an offer of "a secret card" sight unseen, and both people are
 * already inside the trade. That is the whole scoped exception this feature
 * makes to the silence rule in secret-cards.functions.ts, and it is scoped by
 * being reachable only through an offer you are party to.
 */
export type TradeItemView =
  | { kind: "roster"; copyId: string; eventParticipantId: string; edition: Edition }
  | { kind: "secret"; pullId: string; name: string; artUrl: string | null; tier: SecretTier };

export type TradeOfferView = {
  id: string;
  status: TradeOfferStatus;
  proposerId: string;
  recipientId: string;
  createdAt: string;
  resolvedAt: string | null;
  proposerGives: TradeItemView[];
  recipientGives: TradeItemView[];
};

/**
 * One tradeable COPY of a roster card.
 *
 * A copy rather than a count, because which one you hand over is now a choice —
 * "my gold Alice" and "my standard Alice" are different things to offer. Every
 * copy of a card you hold two or more of is listed; the rule that you must keep
 * one is enforced across the whole offer, in `trade_leaves_a_copy`.
 */
export type RosterSpare = {
  copyId: string;
  eventParticipantId: string;
  edition: Edition;
};

/**
 * A spare secret copy. Deliberately no `secretCardId`: staking one needs the
 * ledger row's id and nothing else, and the card is already described by the
 * name and art beside it.
 */
export type SecretSpare = {
  pullId: string;
  name: string;
  artUrl: string | null;
  tier: SecretTier;
};

export type TradeSpares = {
  participantId: string;
  roster: RosterSpare[];
  secrets: SecretSpare[];
};

export type TradeFeedEntry = {
  id: string;
  proposerId: string;
  recipientId: string;
  proposerGave: TradeSummaryItem[];
  recipientGave: TradeSummaryItem[];
  executedAt: string;
};

const STATUS_LABELS: Record<TradeOfferStatus, string> = {
  pending: "Pending",
  accepted: "Done",
  declined: "Declined",
  cancelled: "Pulled",
  // Distinct from declined on purpose: nobody said no, the cards moved first.
  voided: "Expired",
};

export function offerStatusLabel(status: string): string {
  return isTradeOfferStatus(status) ? STATUS_LABELS[status] : "Unknown";
}

/**
 * "2 cards + a secret" — what one side handed over, from the redacted summary.
 *
 * Reads off `kind` alone, which is all the public feed carries for a secret.
 */
export function tradeSummaryLabel(items: readonly TradeSummaryItem[]): string {
  const roster = items.filter((i) => i.kind === "roster").length;
  const secrets = items.length - roster;
  const parts: string[] = [];
  if (roster > 0) parts.push(`${roster} card${roster === 1 ? "" : "s"}`);
  if (secrets > 0) parts.push(secrets === 1 ? "a secret" : `${secrets} secrets`);
  return parts.length ? parts.join(" + ") : "nothing";
}

/** Same for an offer's side, which carries hydrated items rather than summaries. */
export function tradeItemsLabel(items: readonly TradeItemView[]): string {
  return tradeSummaryLabel(
    items.map((i) =>
      i.kind === "roster"
        ? ({ kind: "roster", eventParticipantId: i.eventParticipantId } as const)
        : ({ kind: "secret" } as const),
    ) satisfies TradeSummaryItem[],
  );
}

/**
 * The league's timezone, which decides where a day ends.
 *
 * Duplicated from SQL rather than derived: every daily thing in this app — the
 * pack drop, the secret drop, and `trade_item_is_spare`'s "today's pull is not a
 * spare yet" rule — bakes `America/New_York` into the function body, precisely so
 * a caller cannot shift the boundary. `leagueDay()` exists so the spares listing
 * agrees with the RPC about which copies are stakeable instead of offering cards
 * the RPC will then refuse. A db test pins the two together, the way
 * card-edition.ts and secret-rarity.ts are pinned to their SQL ladders.
 */
export const LEAGUE_TIME_ZONE = "America/New_York";

/** Today in the league's zone, as `YYYY-MM-DD` — the same text a `date` renders as. */
export function leagueDay(at: Date = new Date()): string {
  // en-CA formats as ISO-8601, which is the one locale that needs no reassembly.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LEAGUE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}
