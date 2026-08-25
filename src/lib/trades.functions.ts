import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireMember } from "./require-auth.server";
import { signPath } from "./media.functions";
import { VARIANT_WIDTHS } from "./media";
import { toSecretTier } from "./secret-rarity";
import { toEdition } from "./card-edition";
import { leagueDay } from "./trades";
import type {
  BlockedSpare,
  SecretSpare,
  TradeFeedEntry,
  TradeItemView,
  TradeOfferView,
  TradeSpares,
} from "./trades";
import type { SecretCardRow, SecretPullRow } from "./secret-cards-db.server";
import type {
  AcceptTradeOfferResult,
  CardCopyRow,
  CreateTradeOfferResult,
  TradeOfferItemRow,
  TradeOfferRow,
  TradeRow,
} from "./trades-db.server";
import { uuid as zuuid } from "./zod-uuid";

/**
 * The Trading Post: moving a spare card from one member to another.
 *
 * THE PARTICIPANT ID ALWAYS COMES FROM THE VERIFIED TOKEN. Every guarded handler
 * below starts with `await requireMember()` and uses what it returns as the
 * actor. The counterparty id is the one id these handlers legitimately take from
 * a payload, and it is only ever used as the OTHER side — `create_trade_offer`
 * re-derives who owns what from it, so naming somebody else buys you nothing but
 * their spares list.
 *
 * WHAT THIS DELIBERATELY EXPOSES, and it is the one scoped exception the trading
 * feature makes to the privacy rules around collections: `getTradeSpares` will
 * tell a member what somebody else has spare. You cannot compose an offer
 * blind. It is narrowed to spares (never the whole collection), it is
 * member-guarded (never anon), and it is `no-store`. Since per-copy trading it
 * also carries the FINISH on each copy, which it deliberately did not before —
 * see the note on the query itself for why that is now unavoidable, and why it
 * still never reaches the public record.
 *
 * It does NOT breach the invariant at the top of secret-cards.functions.ts —
 * no handler here accepts a secret CARD id. `createTradeOffer` takes ledger-row
 * ids, which are only useful to somebody who already owns the row: every one of
 * them is checked against the giver by `trade_item_is_spare` inside the RPC.
 */

/** Typed client, for tables the generated types already know about. */
async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Untyped client, for the tables types.ts has not been regenerated for. */
async function db() {
  const { tradesDb } = await import("./trades-db.server");
  return tradesDb();
}

/**
 * Tell the other side something moved. Dynamic import for the same reason as the
 * two above: nudge.server.ts reaches for node:crypto, and a top-level import here
 * would drag it into the client bundle.
 *
 * Awaited, but it cannot fail — sendTradeNudge swallows everything and gives up
 * after two seconds. A trade must never fail because Realtime did.
 */
async function nudge(participantId: string) {
  try {
    const { sendTradeNudge } = await import("./nudge.server");
    await sendTradeNudge(participantId);
  } catch {
    // Belt and braces on top of sendTradeNudge already swallowing its own
    // failures. This is the layer that holds if that ever stops being true, and
    // it is what makes "a broken nudge does not break a trade" a fact rather
    // than a promise about another module.
  }
}

/**
 * These responses vary by the caller's token, and a shared cache hit would hand
 * one member another's inbox. Same reasoning as secret-cards.functions.ts.
 */
function noStore() {
  setResponseHeader("Cache-Control", "private, no-store");
}

/**
 * The active combine, resolved server-side rather than taken from the caller —
 * the `recordCardPulls` pattern. A payload event id here would be both spoofable
 * and, on a screen that renders before the event query answers, racy.
 */
async function activeEventId(): Promise<string | null> {
  const sb = await admin();
  const { data } = await sb
    .from("events")
    .select("id")
    .eq("active", true)
    .order("year", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

const itemSchema = z.discriminatedUnion("kind", [
  // A COPY, not a card. Which of your three Alices you are handing over is the
  // whole point of card_copies — naming the card leaves it undecidable, and every
  // traded card arriving `standard` was the symptom.
  z.object({ kind: z.literal("roster"), cardCopyId: zuuid() }),
  z.object({ kind: z.literal("secret"), secretPullId: zuuid() }),
]);

// Four a side, matching the RPC. Enforced in both places on purpose: this one
// gives a person a sentence, and the RPC's is what actually holds.
const sideSchema = z.array(itemSchema).min(1).max(4);

/**
 * Hydrate the secret half of a set of ledger rows into something renderable.
 *
 * The card ids are derived from rows the caller is already entitled to see —
 * their own spares, a counterparty's spares, or an offer they are party to — and
 * never read from a request. That is what keeps the "no member-facing handler
 * accepts a secret card id" invariant intact through this file.
 */
async function hydrateSecrets(
  rows: Pick<SecretPullRow, "id" | "secret_card_id" | "tier">[],
  /** Pull ids whose owner holds no other copy of that card. */
  lastCopyIds: ReadonlySet<string> = new Set(),
): Promise<Map<string, SecretSpare>> {
  const out = new Map<string, SecretSpare>();
  if (rows.length === 0) return out;

  const sb = await db();
  const cardIds = [...new Set(rows.map((r) => r.secret_card_id))];
  const { data: cards } = await sb
    .from("secret_cards")
    .select("id, name, art_path")
    .in("id", cardIds)
    .returns<Pick<SecretCardRow, "id" | "name" | "art_path">[]>();
  const byId = new Map((cards ?? []).map((c) => [c.id, c]));

  await Promise.all(
    rows.map(async (row) => {
      const card = byId.get(row.secret_card_id);
      out.set(row.id, {
        pullId: row.id,
        // A retired card still trades; it just has no row left to name it.
        name: card?.name ?? "Secret card",
        // thumb rather than large: these are tiles in a picker, not the reveal.
        artUrl: await signPath(card?.art_path ?? null, VARIANT_WIDTHS.thumb),
        tier: toSecretTier(row.tier),
        lastCopy: lastCopyIds.has(row.id),
      });
    }),
  );
  return out;
}

/**
 * What one member has spare, for composing an offer against.
 *
 * Works for yourself and for a counterparty — see the exception documented at the
 * top of this file. "Two or more copies of the card" and `is_duplicate` are the
 * same two rules `trade_item_is_spare` applies inside the RPC, and today's
 * un-granted secret pull is filtered out here for the same reason it is refused
 * there: it is that member's spent daily slot, and trading it away would hand them
 * a second pull.
 */
export const getTradeSpares = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ participantId: zuuid() }).parse(d))
  .handler(async ({ data }): Promise<TradeSpares> => {
    const asker = await requireMember();
    noStore();
    // Blocked cards are your own business only: a counterparty's untradeable
    // copies are collection detail an offer screen has no reason to publish.
    const mine = asker === data.participantId;

    const empty: TradeSpares = {
      participantId: data.participantId,
      roster: [],
      secrets: [],
      blocked: [],
    };
    const eventId = await activeEventId();
    if (!eventId) return empty;

    const sb = await admin();
    // Constrain to this event's own cards first, exactly as getCardPullCounts and
    // getMyCardStats do, so this can never be used to enumerate another event.
    const { data: eps, error: epsError } = await sb
      .from("event_participants")
      .select("id")
      .eq("event_id", eventId);
    if (epsError) throw epsError;
    const ids = (eps ?? []).map((r) => r.id);

    const trades = await db();
    const [{ data: allCopies, error }, { data: dupes, error: dupeError }] = await Promise.all([
      ids.length
        ? trades
            .from("card_copies")
            // THE EDITION IS IN THIS RESPONSE, and that is a deliberate widening
            // rather than an oversight: you cannot choose which copy to hand over,
            // or judge which one you are being offered, without seeing the finish
            // on it. The exposure is inherent to per-copy trading.
            //
            // It used to carry a caveat that the value was only a client's claim.
            // It is not, any more — 20260826120000 moved the derivation into
            // `record_card_pulls`, so a `'pull'` copy's finish is Postgres's own.
            // `edition_asserted_by` rides along because dust pays by edition and
            // only for a server-decided one, so the burn affordance has to be able
            // to quote the honest number; `adopt` and commissioner `grant` copies
            // stay `'client'` and pay the flat floor.
            //
            // It stays out of the PUBLIC record either way: see the summary
            // builder in accept_trade_offer.
            .select("id, event_participant_id, edition, edition_asserted_by")
            .eq("participant_id", data.participantId)
            .in("event_participant_id", ids)
            .returns<
              Pick<CardCopyRow, "id" | "event_participant_id" | "edition" | "edition_asserted_by">[]
            >()
        : { data: [], error: null },
      // EVERY copy, duplicate or not. A secret you own one of is still yours to
      // give — unlike a roster card there is no public count riding on you keeping
      // one. Which means this query is also where `lastCopy` is worked out, so the
      // tile can say so before somebody hands away their only mythic.
      trades
        .from("secret_card_pulls")
        .select("id, secret_card_id, tier, granted, pulled_on")
        .eq("participant_id", data.participantId)
        .returns<
          Pick<SecretPullRow, "id" | "secret_card_id" | "tier" | "granted" | "pulled_on">[]
        >(),
    ]);
    if (error) throw error;
    if (dupeError) throw dupeError;

    const today = leagueDay();
    const held = dupes ?? [];
    const stakeable = held.filter((r) => r.granted || r.pulled_on !== today);

    // Counted over EVERY row they hold, not just the stakeable ones: somebody with
    // today's pull plus one older copy can trade the older one and is not down to
    // their last, so calling it a last copy would be a lie.
    const perCard = new Map<string, number>();
    for (const r of held) perCard.set(r.secret_card_id, (perCard.get(r.secret_card_id) ?? 0) + 1);
    const lastCopyIds = new Set(
      held.filter((r) => perCard.get(r.secret_card_id) === 1).map((r) => r.id),
    );

    // Hydrated over every row rather than only the stakeable ones, so the blocked
    // list below can render a face too — a greyed tile with no art explains nothing.
    const secrets = await hydrateSecrets(mine ? held : stakeable, lastCopyIds);

    // Every copy of a card they hold two or more of. All of them, not "the ones
    // beyond the first": the giver picks which copy to keep, so listing only the
    // worst would quietly take that choice away. The rule that they keep ONE is
    // enforced across the whole offer by trade_leaves_a_copy, not by this list.
    const byCard = new Map<
      string,
      Pick<CardCopyRow, "id" | "event_participant_id" | "edition" | "edition_asserted_by">[]
    >();
    for (const row of allCopies ?? []) {
      const list = byCard.get(row.event_participant_id) ?? [];
      list.push(row);
      byCard.set(row.event_participant_id, list);
    }

    // Everything you hold that the rules keep off the table, with the reason —
    // shown greyed rather than silently dropped, because a missing card reads as
    // a bug and "only copy" reads as a rule.
    const blocked: BlockedSpare[] = mine
      ? [
          ...[...byCard.values()]
            .filter((list) => list.length === 1)
            .flat()
            .map<BlockedSpare>((r) => ({
              item: {
                kind: "roster",
                copyId: r.id,
                eventParticipantId: r.event_participant_id,
                edition: toEdition(r.edition),
              },
              reason: "only-copy",
            })),
          ...held
            .filter((r) => !r.granted && r.pulled_on === today)
            .map((r) => secrets.get(r.id))
            .filter((s): s is SecretSpare => !!s)
            .map<BlockedSpare>((s) => ({
              item: { kind: "secret", ...s },
              reason: "todays-pull",
            })),
        ]
      : [];

    return {
      participantId: data.participantId,
      roster: [...byCard.values()]
        .filter((list) => list.length >= 2)
        .flat()
        .map((r) => ({
          copyId: r.id,
          eventParticipantId: r.event_participant_id,
          edition: toEdition(r.edition),
          // Anything that is not literally 'server' is treated as untrusted, the
          // same direction the SQL errs in: a provenance nobody has taught this
          // about should under-promise rather than over-promise a payout.
          assertedBy:
            r.edition_asserted_by === "server" ? ("server" as const) : ("client" as const),
        })),
      secrets: stakeable.map((r) => secrets.get(r.id)!).filter(Boolean),
      blocked,
    };
  });

/** Turn offer rows plus their items into views, hydrating every secret in one pass. */
async function toOfferViews(
  offers: TradeOfferRow[],
  items: TradeOfferItemRow[],
): Promise<TradeOfferView[]> {
  const secretRows = items
    .filter((i) => i.kind === "secret" && i.secret_pull_id)
    .map((i) => i.secret_pull_id!);
  const copyRows = items
    .filter((i) => i.kind === "roster" && i.card_copy_id)
    .map((i) => i.card_copy_id!);

  let hydrated = new Map<string, SecretSpare>();
  let byCopy = new Map<string, Pick<CardCopyRow, "id" | "event_participant_id" | "edition">>();
  const sb = await db();

  if (secretRows.length) {
    const { data: pulls } = await sb
      .from("secret_card_pulls")
      .select("id, participant_id, secret_card_id, tier")
      .in("id", secretRows)
      .returns<Pick<SecretPullRow, "id" | "participant_id" | "secret_card_id" | "tier">[]>();
    const staked = pulls ?? [];

    // How many copies each staked row's OWNER holds of that card, so an offer can
    // say "this is their last one" the same way the picker does. Scoped to the
    // cards already on the table — it tells the two parties nothing they cannot
    // already see in each other's spares list.
    let owned: Pick<SecretPullRow, "participant_id" | "secret_card_id">[] = [];
    if (staked.length) {
      const { data } = await sb
        .from("secret_card_pulls")
        .select("participant_id, secret_card_id")
        .in("secret_card_id", [...new Set(staked.map((r) => r.secret_card_id))])
        .returns<Pick<SecretPullRow, "participant_id" | "secret_card_id">[]>();
      owned = data ?? [];
    }
    const perOwnerCard = new Map<string, number>();
    for (const r of owned) {
      const key = `${r.participant_id}:${r.secret_card_id}`;
      perOwnerCard.set(key, (perOwnerCard.get(key) ?? 0) + 1);
    }
    const lastCopyIds = new Set(
      staked
        .filter((r) => perOwnerCard.get(`${r.participant_id}:${r.secret_card_id}`) === 1)
        .map((r) => r.id),
    );

    hydrated = await hydrateSecrets(staked, lastCopyIds);
  }
  if (copyRows.length) {
    // Which card the copy is of, and the finish on it. Read off the copy rather
    // than stored on the item, so it cannot drift from the row that will actually
    // move — the same reason accept_trade_offer resolves it this way.
    const { data: rows } = await sb
      .from("card_copies")
      .select("id, event_participant_id, edition")
      .in("id", copyRows)
      .returns<Pick<CardCopyRow, "id" | "event_participant_id" | "edition">[]>();
    byCopy = new Map((rows ?? []).map((r) => [r.id, r]));
  }

  function view(item: TradeOfferItemRow): TradeItemView | null {
    if (item.kind === "roster") {
      const copy = item.card_copy_id ? byCopy.get(item.card_copy_id) : undefined;
      return copy
        ? {
            kind: "roster",
            copyId: copy.id,
            eventParticipantId: copy.event_participant_id,
            edition: toEdition(copy.edition),
          }
        : null;
    }
    const secret = item.secret_pull_id ? hydrated.get(item.secret_pull_id) : undefined;
    // A card whose ledger row has since gone is dropped rather than rendered as a
    // blank: the offer is still readable, it just has one fewer thing on it.
    return secret ? { kind: "secret", ...secret } : null;
  }

  return offers.map((offer) => {
    const mine = items.filter((i) => i.offer_id === offer.id);
    return {
      id: offer.id,
      status: offer.status,
      proposerId: offer.proposer_id,
      recipientId: offer.recipient_id,
      createdAt: offer.created_at,
      resolvedAt: offer.resolved_at,
      proposerGives: mine
        .filter((i) => i.giver_side === "proposer")
        .map(view)
        .filter((v): v is TradeItemView => v !== null),
      recipientGives: mine
        .filter((i) => i.giver_side === "recipient")
        .map(view)
        .filter((v): v is TradeItemView => v !== null),
    };
  });
}

/** How many resolved offers the history strip carries. Long enough to explain a change. */
const RECENT_LIMIT = 10;

/**
 * Everything the Trading Post screen needs about you: offers waiting on you,
 * offers you are waiting on, and what has been settled lately.
 *
 * The `recent` list is how a decline is ever seen. There is still no push TABLE for
 * one, and there will not be — a ticker would have to be anon-readable to be
 * published, so even a contentless one would broadcast "trade activity happened" to
 * the whole league. What there is now is a broadcast topic, which is not a table and
 * publishes nothing: see nudge.server.ts, and `nudgeTopic` below. Window focus
 * refetching stays the backstop, and party phones lock and unlock constantly.
 */
export const getMyTradeOffers = createServerFn({ method: "GET" }).handler(
  async (): Promise<{
    inbox: TradeOfferView[];
    outbox: TradeOfferView[];
    recent: TradeOfferView[];
    nudgeTopic: string | null;
  }> => {
    const me = await requireMember();
    noStore();
    const sb = await db();

    // Handed out here rather than from a server function of its own. A member
    // cannot derive their own topic — it is HMAC'd with SESSION_SECRET — and this
    // response is already member-guarded, already no-store, and already the exact
    // query the badge reads, so the topic rides along for free.
    const { tradeNudgeTopic } = await import("./nudge.server");
    const nudgeTopic = tradeNudgeTopic(me);

    // Two equality queries rather than one `.or(...)`: that filter is built by
    // interpolating a value into PostgREST's expression DSL, which nothing else
    // in this app does, and trade_offers_not_self_ck guarantees no row can come
    // back from both. Thirteen people; the second round trip costs nothing.
    const cols = "id, event_id, proposer_id, recipient_id, status, created_at, resolved_at";
    const [{ data: sent, error }, { data: received, error: receivedError }] = await Promise.all([
      sb.from("trade_offers").select(cols).eq("proposer_id", me).returns<TradeOfferRow[]>(),
      sb.from("trade_offers").select(cols).eq("recipient_id", me).returns<TradeOfferRow[]>(),
    ]);
    if (error) throw error;
    if (receivedError) throw receivedError;

    const rows = [...(sent ?? []), ...(received ?? [])].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    );
    const pending = rows.filter((o) => o.status === "pending");
    // Capped rather than paged: this is a strip under two live lists, and the
    // whole league is thirteen people.
    const resolved = rows.filter((o) => o.status !== "pending").slice(0, RECENT_LIMIT);
    const wanted = [...pending, ...resolved];
    if (wanted.length === 0) return { inbox: [], outbox: [], recent: [], nudgeTopic };

    const { data: items, error: itemError } = await sb
      .from("trade_offer_items")
      .select("id, offer_id, giver_side, kind, card_copy_id, secret_pull_id")
      .in(
        "offer_id",
        wanted.map((o) => o.id),
      )
      .returns<TradeOfferItemRow[]>();
    if (itemError) throw itemError;

    const views = await toOfferViews(wanted, items ?? []);
    const byId = new Map(views.map((v) => [v.id, v]));
    return {
      inbox: pending.filter((o) => o.recipient_id === me).map((o) => byId.get(o.id)!),
      outbox: pending.filter((o) => o.proposer_id === me).map((o) => byId.get(o.id)!),
      recent: resolved.map((o) => byId.get(o.id)!),
      nudgeTopic,
    };
  },
);

/**
 * Put an offer on the table.
 *
 * The proposer is the token holder, whatever the payload says. Everything else —
 * that the recipient is a real claimed member, that both sides are one to four
 * well-formed items, and that every staked card is a spare its own side actually
 * holds — is checked inside `create_trade_offer`, because the offer and its items
 * span two tables and supabase-js has no transactions.
 */
export const createTradeOffer = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        recipientId: zuuid(),
        /** What you are handing over. */
        give: sideSchema,
        /** What you are asking for. */
        want: sideSchema,
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const me = await requireMember();
    const sb = await db();

    const { data: result, error } = await sb.rpc("create_trade_offer", {
      _proposer_id: me,
      _recipient_id: data.recipientId,
      _event_id: await activeEventId(),
      _give: data.give,
      _want: data.want,
    });
    if (error) throw new Error(error.message);

    // Past the RPC, so the recipient is a real reachable member rather than
    // whatever the payload named.
    await nudge(data.recipientId);
    return result as CreateTradeOfferResult;
  });

/**
 * Take an offer. The whole swap happens inside `accept_trade_offer`, under a
 * deterministic participant lock order and a re-validation of every staked card.
 *
 * `{ ok: false, reason }` is passed through rather than thrown: `resolved` means
 * somebody already answered this one and `voided` means a card had moved on, and
 * both are toasts rather than errors.
 */
export const acceptTradeOffer = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ offerId: zuuid() }).parse(d))
  .handler(async ({ data }) => {
    const me = await requireMember();
    const sb = await db();

    // `_recipient_id` is the token holder. The RPC raises if it is not the offer's
    // recipient, which is what stops anyone accepting an offer aimed at somebody
    // else — the offer id alone proves nothing.
    const { data: result, error } = await sb.rpc("accept_trade_offer", {
      _offer_id: data.offerId,
      _recipient_id: me,
    });
    if (error) throw new Error(error.message);

    const accepted = result as AcceptTradeOfferResult;
    if (accepted.ok) {
      // The proposer is the one id this handler never had: it takes an offer id
      // and a token, and the RPC re-derives the rest. Read it back rather than
      // trusting a payload, and only once the swap actually happened.
      //
      // Partly redundant and worth keeping anyway: accept also inserts into
      // `trades`, which IS published, so a proposer sitting on /players/trade
      // already hears about it through useTradeFeed. This is what reaches the
      // proposer who is somewhere else in the app.
      const { data: offer } = await sb
        .from("trade_offers")
        .select("proposer_id")
        .eq("id", data.offerId)
        .eq("recipient_id", me)
        .maybeSingle<Pick<TradeOfferRow, "proposer_id">>();
      if (offer) await nudge(offer.proposer_id);
    }
    return accepted;
  });

/**
 * Say no. Not an RPC: one UPDATE, guarded on both the actor and the status, is
 * atomic by itself — `WHERE recipient_id = me AND status = 'pending'` cannot
 * decline somebody else's offer or re-resolve a settled one however it races.
 *
 * `.select("id").maybeSingle()` is what tells a no-op apart from a success, since
 * an UPDATE that matches nothing is not an error.
 */
export const declineTradeOffer = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ offerId: zuuid() }).parse(d))
  .handler(async ({ data }) => {
    const me = await requireMember();
    const sb = await db();

    const { data: row, error } = await sb
      .from("trade_offers")
      .update({ status: "declined", resolved_at: new Date().toISOString() })
      .eq("id", data.offerId)
      .eq("recipient_id", me)
      .eq("status", "pending")
      // `proposer_id` comes back so the nudge has somebody to poke. The same
      // UPDATE that decides whether this was a no-op also names the counterparty,
      // which is one round trip rather than two and cannot disagree with itself.
      .select("id, proposer_id")
      .maybeSingle<Pick<TradeOfferRow, "id" | "proposer_id">>();
    if (error) throw error;
    if (!row) return { ok: false as const, reason: "resolved" as const };
    await nudge(row.proposer_id);
    return { ok: true as const };
  });

/** Take your own offer back. Same shape as decline, from the other side. */
export const cancelTradeOffer = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ offerId: zuuid() }).parse(d))
  .handler(async ({ data }) => {
    const me = await requireMember();
    const sb = await db();

    const { data: row, error } = await sb
      .from("trade_offers")
      .update({ status: "cancelled", resolved_at: new Date().toISOString() })
      .eq("id", data.offerId)
      .eq("proposer_id", me)
      .eq("status", "pending")
      .select("id, recipient_id")
      .maybeSingle<Pick<TradeOfferRow, "id" | "recipient_id">>();
    if (error) throw error;
    if (!row) return { ok: false as const, reason: "resolved" as const };
    await nudge(row.recipient_id);
    return { ok: true as const };
  });

/** How many completed trades the feed carries. */
const FEED_LIMIT = 25;

/**
 * The public feed of completed trades.
 *
 * Unguarded, like getEventSocial and getCardPullCounts: `trades` is anon-readable
 * by design and its summaries are public-safe by construction — the redaction
 * happens inside accept_trade_offer, so there is nothing to filter out here and
 * no way for a future edit to this handler to forget to.
 */
export const getTradeFeed = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ eventId: zuuid() }).parse(d))
  .handler(async ({ data }): Promise<TradeFeedEntry[]> => {
    const sb = await db();
    const { data: rows, error } = await sb
      .from("trades")
      .select("id, proposer_id, recipient_id, proposer_gave, recipient_gave, executed_at")
      .eq("event_id", data.eventId)
      .order("executed_at", { ascending: false })
      .limit(FEED_LIMIT)
      .returns<
        Pick<
          TradeRow,
          "id" | "proposer_id" | "recipient_id" | "proposer_gave" | "recipient_gave" | "executed_at"
        >[]
      >();
    if (error) throw error;

    return (rows ?? []).map((r) => ({
      id: r.id,
      proposerId: r.proposer_id,
      recipientId: r.recipient_id,
      proposerGave: r.proposer_gave ?? [],
      recipientGave: r.recipient_gave ?? [],
      executedAt: r.executed_at,
    }));
  });
