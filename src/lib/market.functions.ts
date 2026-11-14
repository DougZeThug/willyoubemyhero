import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMember } from "./require-auth.server";
import { toSecretTier } from "./secret-rarity";
import { toEdition } from "./card-edition";
import { MARKET_PRICE_MAX, MARKET_PRICE_MIN } from "./market";
import type { MarketBrowse, MarketListing, MarketListingItem, MyMarketListing, MyStall } from "./market"; // prettier-ignore
import type { BuyListingResult, CancelListingResult, ListCardResult, MarketListingRow } from "./market-rows"; // prettier-ignore
import type { CardCopyRow } from "./trades-rows";
import type { SecretPullRow } from "./secret-cards-rows";
import { uuid as zuuid } from "./zod-uuid";
import { activeEventId } from "./active-event.server";
import { nudge } from "./send-nudge";
import { secretFaces, viewerSecretCardIds } from "./secret-visibility.server";
import { sqlNull } from "./rpc-null";
import { adminDb } from "./admin-db.server";
import { noStore } from "./no-store.server";

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

/**
 * How many settled listings the stall carries. The same number, for the same
 * reason, as `RECENT_LIMIT` in trades.functions.ts: capped rather than paged,
 * because this is a strip under a live list and the whole league is thirteen
 * people.
 */
const RECENT_LIMIT = 10;

const LISTING_COLS =
  "id, event_id, seller_id, kind, card_copy_id, secret_pull_id, price, status, buyer_id, created_at, resolved_at, " +
  "listed_event_participant_id, listed_edition, listed_edition_asserted_by, listed_secret_card_id, listed_tier";

/**
 * Turn listing rows into something renderable, withholding what the viewer is not
 * entitled to see.
 *
 * `viewerSecretIds` is the set of secret card ids the person holding the phone
 * already owns — built from their OWN rows, so this adds no exposure of anybody
 * else's collection. A card in that set shows its name and art; one outside it
 * shows neither, and `concealed` says so on the tile.
 *
 * WHAT A LISTING IS OF comes off the listing's own `listed_*` columns, which were
 * copied from the card when it went on the shelf. They are what sold, even after a
 * buyer re-rolls the copy, and they are all there is once a buyer has milled it or
 * sold it to the house: the settled row survives that now, with its reference
 * nulled, as the seller's only receipt. The card_copies / secret_card_pulls reads
 * are for a row with no snapshot, and there should be none left.
 */
async function hydrate(
  rows: MarketListingRow[],
  viewerSecretIds: ReadonlySet<string>,
): Promise<Map<string, MarketListingItem>> {
  const out = new Map<string, MarketListingItem>();
  if (rows.length === 0) return out;
  const sb = await adminDb();

  const copyIds = rows.flatMap((r) =>
    r.card_copy_id && !r.listed_event_participant_id ? [r.card_copy_id] : [],
  );
  const pullIds = rows.flatMap((r) =>
    r.secret_pull_id && !r.listed_secret_card_id ? [r.secret_pull_id] : [],
  );

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

  const rosterOf = (row: MarketListingRow) =>
    row.listed_event_participant_id
      ? {
          event_participant_id: row.listed_event_participant_id,
          edition: row.listed_edition,
          edition_asserted_by: row.listed_edition_asserted_by,
        }
      : row.card_copy_id
        ? copyById.get(row.card_copy_id)
        : undefined;
  const secretOf = (row: MarketListingRow) =>
    row.listed_secret_card_id
      ? { secret_card_id: row.listed_secret_card_id, tier: row.listed_tier }
      : row.secret_pull_id
        ? pullById.get(row.secret_pull_id)
        : undefined;

  const secretCardIds = rows.flatMap((r) => {
    const id = r.kind === "secret" ? secretOf(r)?.secret_card_id : undefined;
    return id ? [id] : [];
  });
  // Only cards the viewer holds get a name or art; the rest are not even fetched.
  const faces = await secretFaces(secretCardIds, {
    shown: (id) => viewerSecretIds.has(id),
    nameUnshown: false,
  });

  for (const row of rows) {
    if (row.kind === "roster") {
      const copy = rosterOf(row);
      // A listing with neither a snapshot nor a copy is dropped rather than
      // rendered as a blank tile — the same thing getTradeFeed does with a
      // deleted card.
      if (!copy) continue;
      out.set(row.id, {
        kind: "roster",
        eventParticipantId: copy.event_participant_id,
        edition: toEdition(copy.edition),
        // Anything but Postgres's own word is the phone's, and pays the floor.
        assertedBy: copy.edition_asserted_by === "server" ? "server" : "client",
      });
      continue;
    }
    const pull = secretOf(row);
    if (!pull) continue;
    const face = faces.get(pull.secret_card_id)!;
    out.set(row.id, {
      kind: "secret",
      name: face.name,
      artUrl: face.artUrl,
      tier: toSecretTier(pull.tier),
      concealed: !viewerSecretIds.has(pull.secret_card_id),
    });
  }
  return out;
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
    const sb = await adminDb();

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
    const items = await hydrate(rows, await viewerSecretCardIds(me));
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
  const sb = await adminDb();

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
  //
  // DE-DUPLICATED BY ID, SETTLED WINNING. The two reads above are dispatched
  // together, so they are two snapshots: a listing that sells between them
  // satisfies `status = 'active'` against the first and `status != 'active'`
  // against the second, and comes back twice — once carrying the stale "active"
  // it held when the live read ran. Splitting by status below cannot tell that
  // copy from a genuinely live row, so the same card appeared in `active`, under
  // a Take down button its own RPC would refuse, AND in `recent` as sold.
  //
  // Settled wins because it is the later snapshot of the two answers, and
  // because the failure it avoids is the worse one: a listing shown as live when
  // it is gone invites a tap, where one shown as settled a beat early is only
  // early.
  //
  // Dropped from the live half rather than overwritten in place, so the row
  // keeps the SETTLED half's position too. Each block below is still in the
  // order its own ORDER BY produced it, which is what `recent` is read in — and
  // a row overwritten at its live-read position would have carried `created_at`
  // ordering into a list sorted by `resolved_at`. One such row lands first
  // either way and looks right; two invert whenever the older-created one
  // settles last.
  const settledIds = new Set((settled ?? []).map((r) => r.id));
  const rows = [...(live ?? []).filter((r) => !settledIds.has(r.id)), ...(settled ?? [])];
  // Everything on this list is the caller's own, so nothing is concealed from
  // them — but a secret they LISTED and no longer own (it sold) is no longer in
  // their holdings, and the tile would go face-down on the one screen that has to
  // tell them what left. Their own listings name their own cards.
  const mine = await viewerSecretCardIds(me);
  const items = await hydrate(rows, await withListedSecrets(mine, rows));

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

  // Split by status, which is now an honest question to ask: the de-duplication
  // above is what makes each id appear once, so a listing that settled between
  // the two reads lands in `recent` on its settled snapshot rather than showing
  // as live with a dead Take down button on it.
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
 * opposite of what that list is for. Scoped to YOUR listings, so it can never
 * de-conceal anything that was not already yours to see.
 *
 * Read off each listing's own snapshot, because the pull may be gone: a buyer who
 * sold it to the house deleted it, and a lookup by pull id would then find
 * nothing and put your own sale face-down. Only a listing with no snapshot falls
 * back to the pull.
 */
async function withListedSecrets(
  held: ReadonlySet<string>,
  mine: readonly MarketListingRow[],
): Promise<ReadonlySet<string>> {
  const secrets = mine.filter((r) => r.kind === "secret");
  const listed = secrets.flatMap((r) => (r.listed_secret_card_id ? [r.listed_secret_card_id] : []));
  const pullIds = secrets.flatMap((r) =>
    !r.listed_secret_card_id && r.secret_pull_id ? [r.secret_pull_id] : [],
  );
  if (pullIds.length === 0) return listed.length ? new Set([...held, ...listed]) : held;
  const sb = await adminDb();
  const { data } = await sb
    .from("secret_card_pulls")
    .select("secret_card_id")
    .in("id", pullIds)
    .returns<Pick<SecretPullRow, "secret_card_id">[]>();
  return new Set([...held, ...listed, ...(data ?? []).map((r) => r.secret_card_id)]);
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
  .validator((d: unknown) =>
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
    const sb = await adminDb();
    const { data: raw, error } = await sb.rpc("list_card_for_dust", {
      _participant_id: me,
      _kind: data.kind,
      _card_copy_id: sqlNull(data.kind === "roster" ? data.copyId : null),
      _secret_pull_id: sqlNull(data.kind === "secret" ? data.pullId : null),
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
  .validator((d: unknown) => z.object({ listingId: zuuid() }).parse(d))
  .handler(async ({ data }) => {
    const me = await requireMember();
    noStore();
    const sb = await adminDb();
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
  .validator((d: unknown) => z.object({ listingId: zuuid(), requestId: zuuid() }).parse(d))
  .handler(async ({ data }) => {
    const me = await requireMember();
    noStore();
    const sb = await adminDb();
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
