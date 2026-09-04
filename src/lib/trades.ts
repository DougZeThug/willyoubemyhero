// The Trading Post's client-safe half: view types and the labels rendered from
// them. No imports from anything *.server.ts, so this is safe in the bundle.
import type { Edition } from "./card-edition";
import type { SecretTier } from "./secret-rarity";

/**
 * How a completed trade is described in the public feed.
 *
 * This is the shape of `trades.proposer_gave` / `recipient_gave`. A roster item
 * names its card because that card is public. A secret item now names its card
 * too — the league asked the feed to say which secret moved, and that was a
 * deliberate widening of the old kind-only redaction: a NAME, for a card that
 * actually changed hands, and nothing else. Art, flavour, foil and tier stay
 * server-only, and an untraded card still appears nowhere, so the catalogue is
 * not enumerable from this table. Do not widen it further — see the column
 * comments in 20260827130000_name_traded_secrets.sql.
 *
 * Both fields are optional because rows written before that migration, and any
 * whose card row has since gone, carry neither.
 */
export type TradeSummaryItem =
  | { kind: "roster"; eventParticipantId: string }
  | { kind: "secret"; secretCardId?: string; name?: string };

/**
 * The broadcast event name a trade nudge is sent under.
 *
 * Here rather than in nudge.server.ts because BOTH sides need it and the client
 * cannot import a *.server.ts. A mismatch between the string the server sends and
 * the string the browser binds is a silent, total, error-free failure in both
 * directions — the kind of bug that costs an afternoon — so there is exactly one
 * of it. The payload is always empty; see the header of nudge.server.ts for why
 * that is a guarantee rather than a detail.
 */
export const TRADE_NUDGE_EVENT = "trade";

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
  | {
      kind: "roster";
      copyId: string;
      eventParticipantId: string;
      edition: Edition;
      /** See SecretSpare.viewerOwns — same rule, same reason. */
      viewerOwns?: boolean;
    }
  | {
      kind: "secret";
      pullId: string;
      name: string;
      artUrl: string | null;
      tier: SecretTier;
      /** True when its owner holds no other copy of that card. */
      lastCopy: boolean;
      /** Whether the person reading this already holds a copy of the card. */
      viewerOwns?: boolean;
    };

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
  /**
   * Whether the person READING this list already holds a copy of that card.
   *
   * Decided on the server because the client cannot work it out for secrets, and
   * because it drives a privacy rule rather than a decoration: unowned art on a
   * counterparty's side of the table renders face-down, so browsing somebody's
   * spares never spoils art you have not pulled.
   */
  viewerOwns: boolean;
  /**
   * Who decided this copy's finish — `card_copies.edition_asserted_by`.
   *
   * Here because dust pays by edition and only for a finish Postgres derived, so
   * a burn affordance cannot quote an honest number without it. Not a leak on top
   * of `edition`, which is already in this response: it says how the finish was
   * arrived at, not anything further about the card or its owner.
   */
  assertedBy: "client" | "server";
};

/**
 * A tradeable secret copy. Deliberately no `secretCardId`: staking one needs the
 * ledger row's id and nothing else, and the card is already described by the
 * name and art beside it.
 *
 * Any copy is tradeable, duplicate or not — a secret you own one of is still
 * yours to give. `lastCopy` is what makes that visible rather than surprising:
 * true when its owner holds no other copy, so the tile can say so before somebody
 * hands away the only mythic they have.
 */
export type SecretSpare = {
  pullId: string;
  name: string;
  artUrl: string | null;
  tier: SecretTier;
  lastCopy: boolean;
  /** See RosterSpare.viewerOwns. */
  viewerOwns: boolean;
};

/**
 * Why a card you own is not on the table.
 *
 * The picker used to simply omit these, which reads as "the app lost my card" —
 * the single most common complaint about trading. Shown greyed with the reason
 * instead, and only ever for your OWN collection: listing what a counterparty
 * cannot trade would widen what an offer screen tells you about their vault.
 */
export type BlockedReason = "only-copy" | "todays-pull";

export const BLOCKED_LABEL: Record<BlockedReason, string> = {
  "only-copy": "only copy",
  "todays-pull": "today's pull",
};

export type BlockedSpare = { item: TradeItemView; reason: BlockedReason };

export type TradeSpares = {
  participantId: string;
  roster: RosterSpare[];
  secrets: SecretSpare[];
  /** Populated only when you are looking at yourself. */
  blocked: BlockedSpare[];
  /**
   * Every roster copy you hold, spares and only-copies alike. Yourself only.
   *
   * `roster` above is the tradeable subset, and milling needs that same subset —
   * but re-rolling a finish deliberately has no spare rule (`reroll_copy_edition`
   * takes your only copy quite happily), and the card most worth settling is
   * precisely the one you hold once. This is the list the dust shop re-rolls
   * from; `blocked` cannot serve it because a TradeItemView carries no
   * provenance, and widening that would change what the trade screen shows about
   * the other side.
   */
  ownedRoster: RosterSpare[];
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
 * How long a declined or pulled-back offer can still be put back.
 *
 * Twelve times the five seconds the Undo toast is on screen, because the toast
 * is the floor and not the ceiling: somebody who swipes it away and then thinks
 * better of it deserves the same second chance as somebody who tapped in time,
 * and a phone that lost signal on the way to the handler should not spend the
 * whole window in flight. Long enough to be forgiving; short enough that the
 * other side has not had time to build a reply around the no.
 *
 * Read by `reopenTradeOffer`, and passed to the RPC rather than hard-coded
 * there so the two cannot drift.
 */
export const TRADE_UNDO_WINDOW_SECONDS = 60;

/**
 * "2 cards + Tucker" — what one side handed over, from the public summary.
 *
 * Secrets are named now: accept_trade_offer records the card's name, because the
 * league wanted the feed to say which secret moved. `name` stays OPTIONAL rather
 * than required — trades settled before that widening carry `{kind:"secret"}` and
 * nothing else, and a summary whose card row has since gone still arrives nameless
 * — so the count wording ("a secret" / "2 secrets") is the fallback rather than
 * dead code. Roster items are still counted, never named: naming them would mean
 * resolving an event_participant_id, which this pure function cannot do.
 */
export function tradeSummaryParts(items: readonly TradeSummaryItem[]): string[] {
  const roster = items.filter((i) => i.kind === "roster").length;
  const named = items.flatMap((i) => (i.kind === "secret" && i.name ? [i.name] : []));
  const nameless = items.length - roster - named.length;
  const parts: string[] = [];
  if (roster > 0) parts.push(`${roster} card${roster === 1 ? "" : "s"}`);
  parts.push(...named);
  if (nameless > 0) parts.push(nameless === 1 ? "a secret" : `${nameless} secrets`);
  return parts;
}

/**
 * The same summary as one string.
 *
 * The parts are exported separately because the feed highlights each one,
 * and it used to get them by splitting this result back apart on " + " — so
 * a secret named "Salt + Pepper" rendered as two separately lit pieces.
 */
export function tradeSummaryLabel(items: readonly TradeSummaryItem[]): string {
  const parts = tradeSummaryParts(items);
  return parts.length ? parts.join(" + ") : "nothing";
}

/** Same for an offer's side, which carries hydrated items rather than summaries. */
export function tradeItemsLabel(items: readonly TradeItemView[]): string {
  return tradeSummaryLabel(
    items.map((i) =>
      i.kind === "roster"
        ? ({ kind: "roster", eventParticipantId: i.eventParticipantId } as const)
        : ({ kind: "secret", name: i.name } as const),
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
