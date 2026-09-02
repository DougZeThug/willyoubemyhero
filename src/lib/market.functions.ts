import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireMember } from "./require-auth.server";
import { signPath } from "./media.functions";
import { VARIANT_WIDTHS } from "./media";
import { toSecretTier } from "./secret-rarity";
import { toEdition } from "./card-edition";
import { MARKET_PRICE_MAX, MARKET_PRICE_MIN } from "./market";
import type { MarketBrowse, MarketListing, MarketListingItem, MyMarketListing, MyStall } from "./market"; // prettier-ignore
import type { BuyListingResult, CancelListingResult, ListCardResult, MarketListingRow } from "./market-db.server"; // prettier-ignore
import type { CardCopyRow } from "./trades-db.server";
import type { SecretCardRow, SecretPullRow } from "./secret-cards-db.server";
import { uuid as zuuid } from "./zod-uuid";

/**
 * The marketplace: a spare priced by the person selling it.
 *
 * MEMBERS ONLY, every handler, for the reason the header of
 * 20260826130000_dust_ledger.sql gives about dust generally — a guest has no
 * ledger to pay from and no card_copies rows to sell.
 *
 * THE PARTICIPANT ID ALWAYS COMES FROM THE VERIFIED TOKEN. There is no
 * participant parameter on any handler below; `requireMember()` returns the one
 * the token was signed for, and every RPC takes that id as its first argument.
 * Unlike trades.functions.ts there is not even a counterparty id to accept — a
 * buyer names a LISTING, and the RPC reads the seller off it.
 *
 * WHAT DELIBERATELY DOES NOT CROSS THE WIRE, and it is a narrower list than the
 * trade screen's:
 *
 *   * No card_copies id and no secret_card_pulls id. Buying needs the listing id
 *     and nothing else, so shipping the underlying row id would hand every member
 *     a stable handle on every other member's rows, in bulk, for nothing.
 *   * No secret card id, ever — the invariant secret-cards.functions.ts states.
 *   * No NAME and no ART for a secret the viewer does not already hold. See
 *     `MarketListingItem.concealed`: a listing is not a completed trade, so a
 *     name-bearing browse of every unowned secret would be the catalogue
 *     enumeration `secret_cards` is server-only to prevent.
 *   * No total, no denominator, no set size. The rule the rest of the app keeps.
 *
 * A SALE IS QUIET. Nothing here writes to `trades` and nothing reaches the public
 * feed. The seller is told through the payload-free broadcast in nudge.server.ts
 * and through their own stall, which is the only place a sale is ever visible.
 */

/** Untyped client, for the marketplace tables types.ts has not been regenerated for. */
async function db() {
  const { marketDb } = await import("./market-db.server");
  return marketDb();
}

/**
 * Tell the seller their card sold. Dynamic import for the reason
 * trades.functions.ts gives: nudge.server.ts reaches for node:crypto, and a
 * top-level import would drag it into the client bundle.
 *
 * The SAME topic the Trading Post pokes, rather than a second one. It is one HMAC
 * per participant and the event carries nothing — which is the entire privacy
 * guarantee, so a second listener on it costs one extra refetch of a
 * member-guarded handler and widens the surface by exactly nothing.
 *
 * Awaited, but it cannot fail: sendTradeNudge swallows everything and gives up
 * after two seconds. A sale must never fail because Realtime did.
 */
async function nudge(participantId: string) {
  try {
    const { sendTradeNudge } = await import("./nudge.server");
    await sendTradeNudge(participantId);
  } catch {
    // Belt and braces on top of sendTradeNudge already swallowing its own
    // failures — the layer that holds if that ever stops being true.
  }
}

/** These vary by the caller's token, so a shared cache hit would hand one member another's shelf. */
function noStore() {
  setResponseHeader("Cache-Control", "private, no-store");
}

/**
 * The active combine, resolved server-side rather than taken from the caller —
 * the `recordCardPulls` pattern. A payload event id would be both spoofable and,
 * on a screen that renders before the event query answers, racy.
 */
async function activeEventId(): Promise<string | null> {
  const sb = await db();
  const { data } = await sb
    .from("events")
    .select("id")
    .eq("active", true)
    .order("year", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  return data?.id ?? null;
}

/**
 * How many settled listings the stall carries. The same number, for the same
 * reason, as `RECENT_LIMIT` in trades.functions.ts: capped rather than paged,
 * because this is a strip under a live list and the whole league is thirteen
 * people.
 */
const RECENT_LIMIT = 10;

const LISTING_COLS =
  "id, event_id, seller_id, kind, card_copy_id, secret_pull_id, price, status, buyer_id, created_at, resolved_at";

/**
 * Turn listing rows into something renderable, withholding what the viewer is not
 * entitled to see.
 *
 * `viewerSecretIds` is the set of secret card ids the person holding the phone
 * already owns — built from their OWN rows, so this adds no exposure of anybody
 * else's collection. A card in that set shows its name and art; one outside it
 * shows neither, and `concealed` says so on the tile.
 */
async function hydrate(
  rows: MarketListingRow[],
  viewerSecretIds: ReadonlySet<string>,
): Promise<Map<string, MarketListingItem>> {
  const out = new Map<string, MarketListingItem>();
  if (rows.length === 0) return out;
  const sb = await db();

  const copyIds = rows.flatMap((r) => (r.card_copy_id ? [r.card_copy_id] : []));
  const pullIds = rows.flatMap((r) => (r.secret_pull_id ? [r.secret_pull_id] : []));

  const [{ data: copies }, { data: pulls }] = await Promise.all([
    copyIds.length
      ? sb
          .from("card_copies")
          .select("id, event_participant_id, edition, edition_asserted_by")
          .in("id", copyIds)
          .returns<
            Pick<CardCopyRow, "id" | "event_participant_id" | "edition" | "edition_asserted_by">[]
          >()
      : Promise.resolve({ data: [] as Pick<CardCopyRow, "id" | "event_participant_id" | "edition" | "edition_asserted_by">[] }), // prettier-ignore
    pullIds.length
      ? sb
          .from("secret_card_pulls")
          .select("id, secret_card_id, tier")
          .in("id", pullIds)
          .returns<Pick<SecretPullRow, "id" | "secret_card_id" | "tier">[]>()
      : Promise.resolve({ data: [] as Pick<SecretPullRow, "id" | "secret_card_id" | "tier">[] }),
  ]);

  const copyById = new Map((copies ?? []).map((c) => [c.id, c]));
  const pullById = new Map((pulls ?? []).map((p) => [p.id, p]));

  // Only for cards the viewer actually holds. Fetching the rest would be harmless
  // server-side, but not fetching them is the clearer statement of the rule and
  // saves signing art nobody may see.
  const visibleCardIds = [
    ...new Set(
      (pulls ?? []).flatMap((p) =>
        viewerSecretIds.has(p.secret_card_id) ? [p.secret_card_id] : [],
      ),
    ),
  ];
  const { data: cards } = visibleCardIds.length
    ? await sb
        .from("secret_cards")
        .select("id, name, art_path")
        .in("id", visibleCardIds)
        .returns<Pick<SecretCardRow, "id" | "name" | "art_path">[]>()
    : { data: [] as Pick<SecretCardRow, "id" | "name" | "art_path">[] };
  const cardById = new Map((cards ?? []).map((c) => [c.id, c]));

  await Promise.all(
    rows.map(async (row) => {
      if (row.kind === "roster") {
        const copy = row.card_copy_id ? copyById.get(row.card_copy_id) : undefined;
        // A listing whose copy has vanished is dropped rather than rendered as a
        // blank tile — the same thing getTradeFeed does with a deleted card.
        if (!copy) return;
        out.set(row.id, {
          kind: "roster",
          eventParticipantId: copy.event_participant_id,
          edition: toEdition(copy.edition),
          // Anything but Postgres's own word is the phone's, and pays the floor.
          assertedBy: copy.edition_asserted_by === "server" ? "server" : "client",
        });
        return;
      }
      const pull = row.secret_pull_id ? pullById.get(row.secret_pull_id) : undefined;
      if (!pull) return;
      const owns = viewerSecretIds.has(pull.secret_card_id);
      const card = owns ? cardById.get(pull.secret_card_id) : undefined;
      out.set(row.id, {
        kind: "secret",
        // A retired card still sells; it just has no row left to name it.
        name: owns ? (card?.name ?? "Secret card") : "Secret card",
        // thumb rather than large: these are tiles on a shelf, not the reveal.
        artUrl: owns ? await signPath(card?.art_path ?? null, VARIANT_WIDTHS.thumb) : null,
        tier: toSecretTier(pull.tier),
        concealed: !owns,
      });
    }),
  );
  return out;
}

/** Secret card ids the caller already holds a copy of. Their own rows only. */
async function viewerSecrets(me: string): Promise<ReadonlySet<string>> {
  const sb = await db();
  const { data } = await sb
    .from("secret_card_pulls")
    .select("secret_card_id")
    .eq("participant_id", me)
    .returns<Pick<SecretPullRow, "secret_card_id">[]>();
  return new Set((data ?? []).map((r) => r.secret_card_id));
}

function toListing(row: MarketListingRow, item: MarketListingItem): MarketListing {
  return {
    id: row.id,
    sellerId: row.seller_id,
    price: row.price,
    createdAt: row.created_at,
    item,
  };
}

/**
 * The shelf: everybody else's active listings, newest first.
 *
 * YOUR OWN ARE NOT HERE. They are in `getMyStall`, which carries the price, the
 * status and the cancel affordance — and you cannot buy your own listing anyway,
 * so a tile with a dead button on it would be noise on the one screen that has to
 * stay scannable standing in a garden.
 */
export const getMarketListings = createServerFn({ method: "GET" }).handler(
  async (): Promise<MarketBrowse> => {
    const me = await requireMember();
    noStore();
    const sb = await db();

    const { tradeNudgeTopic } = await import("./nudge.server");
    const nudgeTopic = tradeNudgeTopic(me);

    const eventId = await activeEventId();
    if (!eventId) return { listings: [], nudgeTopic };

    const { data, error } = await sb
      .from("market_listings")
      .select(LISTING_COLS)
      .eq("status", "active")
      .eq("event_id", eventId)
      .neq("seller_id", me)
      .order("created_at", { ascending: false })
      .returns<MarketListingRow[]>();
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    const items = await hydrate(rows, await viewerSecrets(me));
    return {
      listings: rows.flatMap((r) => {
        const item = items.get(r.id);
        return item ? [toListing(r, item)] : [];
      }),
      nudgeTopic,
    };
  },
);

/**
 * Your own stall — what is up, and what settled.
 *
 * `recent` is load-bearing rather than decoration. A sale writes no row into
 * `trades` and reaches no feed, so this list is the ONLY place you will ever see
 * that somebody bought your card, or that a listing expired because you traded the
 * copy away. Capped at ten, the cap `getMyTradeOffers` uses for the same list.
 *
 * TWO QUERIES, AND THE CAP IS IN THE SECOND ONE RATHER THAN AFTER THE HYDRATION.
 * A settled listing is never deleted, and cancel-then-relist is two taps, so the
 * history of one member grows without bound — while `active` is bounded by
 * MARKET_MAX_ACTIVE. Reading the lot and slicing to ten afterwards would leave
 * `hydrate` below expanding every listing anybody had ever made into an `.in(...)`
 * of copy and pull ids, on every visit to this screen, forever: slower every
 * week, and eventually a PostgREST URL long enough to fail — which would take the
 * ACTIVE half of the stall down with it, on the one screen a seller uses to take
 * a card back. getMyTradeOffers caps before it expands its items for the same
 * reason; this had drifted from it.
 *
 * Ordered by `resolved_at` in SQL rather than by `created_at` and re-sorted here,
 * because "what settled lately" is a question about when it settled.
 */
export const getMyStall = createServerFn({ method: "GET" }).handler(async (): Promise<MyStall> => {
  const me = await requireMember();
  noStore();
  const sb = await db();

  const [{ data: live, error }, { data: settled, error: settledError }] = await Promise.all([
    sb
      .from("market_listings")
      .select(LISTING_COLS)
      .eq("seller_id", me)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .returns<MarketListingRow[]>(),
    sb
      .from("market_listings")
      .select(LISTING_COLS)
      .eq("seller_id", me)
      .neq("status", "active")
      .order("resolved_at", { ascending: false })
      .limit(RECENT_LIMIT)
      .returns<MarketListingRow[]>(),
  ]);
  if (error) throw new Error(error.message);
  if (settledError) throw new Error(settledError.message);

  // At most MARKET_MAX_ACTIVE + RECENT_LIMIT rows reach the hydration below,
  // whatever the member's history looks like.
  const rows = [...(live ?? []), ...(settled ?? [])];
  // Everything on this list is the caller's own, so nothing is concealed from
  // them — but a secret they LISTED and no longer own (it sold) is no longer in
  // their holdings, and the tile would go face-down on the one screen that has to
  // tell them what left. Their own listings name their own cards.
  const owned = new Set(
    rows.flatMap((r) => (r.kind === "secret" && r.secret_pull_id ? [r.secret_pull_id] : [])),
  );
  const mine = await viewerSecrets(me);
  const items = await hydrate(rows, await withListedSecrets(mine, owned));

  const hydrated = rows.flatMap((r): MyMarketListing[] => {
    const item = items.get(r.id);
    if (!item) return [];
    return [
      {
        ...toListing(r, item),
        status: r.status,
        buyerId: r.buyer_id,
        resolvedAt: r.resolved_at,
      },
    ];
  });

  // Split by status rather than by which query a row came from, so a listing that
  // settled between the two reads above lands in `recent` rather than showing as
  // live with a dead Take down button on it.
  return {
    active: hydrated.filter((l) => l.status === "active"),
    recent: hydrated.filter((l) => l.status !== "active"),
  };
});

/**
 * The secret cards on your own shelf, added to what you hold.
 *
 * A card you sold is no longer in your holdings, so without this your own stall
 * would render the thing you just sold face-down as "Secret card" — which is the
 * opposite of what that list is for. Scoped to pull ids that are on YOUR listings,
 * so it can never de-conceal anything that was not already yours to see.
 */
async function withListedSecrets(
  held: ReadonlySet<string>,
  myPullIds: ReadonlySet<string>,
): Promise<ReadonlySet<string>> {
  if (myPullIds.size === 0) return held;
  const sb = await db();
  const { data } = await sb
    .from("secret_card_pulls")
    .select("secret_card_id")
    .in("id", [...myPullIds])
    .returns<Pick<SecretPullRow, "secret_card_id">[]>();
  return new Set([...held, ...(data ?? []).map((r) => r.secret_card_id)]);
}

/**
 * Put a spare on the shelf at a price you choose.
 *
 * Every rule about whether this is allowed lives in SQL under the participant row
 * lock — it has to, because "do you still hold a spare of this" is a question about
 * a count that two taps can race. This handler's whole job is to prove who is
 * asking.
 *
 * No request id: listing costs nothing, and the partial unique indexes mean a
 * repeat of the same tap comes back as `already_listed` carrying the listing that
 * is already up, rather than shelving it twice. The target id IS the key.
 */
export const listCardForDust = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("roster"), copyId: zuuid() }),
        z.object({ kind: z.literal("secret"), pullId: zuuid() }),
      ])
      .and(
        z.object({
          // Mirrored in market_listings_price_ck and re-checked in the RPC. Here
          // as well so a nonsense number never reaches Postgres at all.
          price: z.number().int().min(MARKET_PRICE_MIN).max(MARKET_PRICE_MAX),
        }),
      )
      .parse(d),
  )
  .handler(async ({ data }) => {
    const me = await requireMember();
    noStore();
    const sb = await db();
    const { data: raw, error } = await sb.rpc("list_card_for_dust", {
      _participant_id: me,
      _kind: data.kind,
      _card_copy_id: data.kind === "roster" ? data.copyId : null,
      _secret_pull_id: data.kind === "secret" ? data.pullId : null,
      _price: data.price,
    });
    if (error) throw new Error(error.message);
    const result = raw as ListCardResult | null;
    if (!result?.ok) {
      return {
        ok: false as const,
        reason: result?.reason ?? ("not_found" as const),
        listingId: result?.listingId,
      };
    }
    return { ok: true as const, listingId: result.listingId, price: result.price };
  });

/** Take one of your own listings back down. */
export const cancelMarketListing = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ listingId: zuuid() }).parse(d))
  .handler(async ({ data }) => {
    const me = await requireMember();
    noStore();
    const sb = await db();
    const { data: raw, error } = await sb.rpc("cancel_market_listing", {
      _participant_id: me,
      _listing_id: data.listingId,
    });
    if (error) throw new Error(error.message);
    const result = raw as CancelListingResult | null;
    if (!result?.ok) {
      return { ok: false as const, reason: result?.reason ?? ("not_found" as const) };
    }
    return { ok: true as const };
  });

/**
 * Buy somebody else's card.
 *
 * `requestId` is minted by the caller, once per tap, and reused if that tap is
 * retried — a lost response on a purchase is the worst bug this feature could
 * ship, and the listing's own status cannot serve as the key: a retry finds it
 * already sold, to this very caller. The RPC's replay check sits above its status
 * check for exactly that reason and answers a repeat with the sale it already made.
 *
 * The seller is poked only on success, with the id read off the RPC's answer
 * rather than off a payload — the `acceptTradeOffer` rule.
 */
export const buyMarketListing = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ listingId: zuuid(), requestId: zuuid() }).parse(d))
  .handler(async ({ data }) => {
    const me = await requireMember();
    noStore();
    const sb = await db();
    const { data: raw, error } = await sb.rpc("buy_market_listing", {
      _participant_id: me,
      _listing_id: data.listingId,
      _request_id: data.requestId,
    });
    if (error) throw new Error(error.message);
    const result = raw as BuyListingResult | null;
    if (!result?.ok) {
      return {
        ok: false as const,
        reason: result?.reason ?? ("not_found" as const),
        balance: result?.balance,
        price: result?.price,
      };
    }
    await nudge(result.sellerId);
    return {
      ok: true as const,
      price: result.price,
      kind: result.kind,
      eventParticipantId: result.eventParticipantId,
      edition: result.edition,
      duplicate: result.duplicate,
      completedCollection: result.completedCollection,
      balance: result.balance,
    };
  });
