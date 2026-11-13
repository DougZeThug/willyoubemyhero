// Every TanStack Query key the app shares, and the invalidations that name
// several of them at once.
//
// Keys live together because the same answer is cached under more than one of
// them and a card moving has to name every copy — a trade landing once named
// only the first spares list and a card traded away stayed on the sell counter.
// Add a key here and the helpers below, not at the call site.
import type { QueryClient } from "@tanstack/react-query";

// Keyed on whoever is asking, never on the event: these are permanent league
// records (a streak, the secret set, dust), so an event id in the key would evict
// somebody's answer every year. They are only cache keys — the server takes the
// identity from the verified token on the request and never from the client.

export const streakStatusKey = (actorId: string | null | undefined) =>
  ["pack-streak", actorId] as const;

export const streakHistoryKey = (actorId: string | null | undefined) =>
  ["streak-history", actorId] as const;

export const dustBalanceKey = (participantId: string | null | undefined) =>
  ["dust-balance", participantId ?? null] as const;

export const packStatusKey = (actorId: string | null | undefined) =>
  ["pack-status", actorId] as const;

/** The actor is `m:<participantId>` or `g:<guestId>` (lib/identity.ts), never a bare id. */
export const mySecretsKey = (actorId: string | null | undefined) =>
  ["my-secrets", actorId] as const;

export const cardPullCountsKey = (eventId: string | null | undefined) =>
  ["card-pull-counts", eventId] as const;

export const myCardStatsKey = (eventId: string | null | undefined, participantId?: string | null) =>
  ["my-card-stats", eventId, participantId ?? null] as const;

export const collectionTrophiesKey = () => ["collection-trophies"] as const;

/**
 * Keyed on the member as well as the window, so a handset that changes hands
 * cannot serve the previous person's arrivals out of cache.
 */
export const recentAcquisitionsKey = (
  eventId: string | null | undefined,
  participantId: string | null | undefined,
  since: string | null | undefined,
) => ["recent-acquisitions", eventId, participantId, since] as const;

/**
 * KEYED ON THE VIEWER, not on the event, and that is a correctness rule rather
 * than a preference. What the shelf says about a secret depends on who is reading
 * it — a card you hold shows its name and art, one you do not renders face-down —
 * so a key shared across members would serve one person another's de-concealed
 * view straight out of the cache. `src/components/market-panel.test.tsx` pins it.
 */
export const marketListingsKey = (participantId: string | null | undefined) =>
  ["market-listings", participantId ?? null] as const;

export const myStallKey = (participantId: string | null | undefined) =>
  ["market-stall", participantId ?? null] as const;

export const tradeOffersKey = (participantId: string | null | undefined) =>
  ["trade-offers", participantId] as const;

/**
 * Keyed on the VIEWER first, then whose spares. The response is shaped for the
 * viewer — a counterparty's unowned secrets arrive with no name and no art — so a
 * device that changes identity must not read the last person's answer out of the
 * cache. Called with the viewer alone it is a prefix, which is what every
 * invalidation wants: everything this viewer has cached, theirs and others'.
 */
export const tradeSparesKey = (
  viewerId: string | null | undefined,
  participantId?: string | null | undefined,
) =>
  participantId === undefined
    ? (["trade-spares", viewerId] as const)
    : (["trade-spares", viewerId, participantId] as const);

/**
 * The SAME getTradeSpares answer as tradeSparesKey, cached a second time for the
 * shop and the market — your own list only, so keyed on you alone.
 */
export const dustSparesKey = (participantId: string | null | undefined) =>
  ["dust-spares", participantId] as const;

export const tradeFeedKey = (eventId: string | null | undefined) =>
  ["trade-feed", eventId] as const;

export const activeEventKey = () => ["active-event"] as const;
export const eventBundleKey = (eventId: string | null | undefined) =>
  ["event-bundle", eventId] as const;
export const eventSocialKey = (eventId: string | null | undefined, identity?: string | null) =>
  identity === undefined
    ? (["event-social", eventId] as const)
    : (["event-social", eventId, identity] as const);
export const eventAwardsKey = (eventId: string | null | undefined) =>
  ["event-awards", eventId] as const;

/** Signed-URL maps, one per kind of art an event serves. */
export type PhotoUrlKind = "photo-urls" | "card-urls";
export const photoUrlsKey = (kind: PhotoUrlKind, eventId: string | null | undefined) =>
  [kind, eventId] as const;
export const eventCardBackKey = (eventId: string | null | undefined) =>
  ["event-card-back", eventId] as const;

/** The two spares caches of one member's list; either one stale shows a card already gone. */
export function invalidateSpares(qc: QueryClient, participantId: string | null | undefined) {
  void qc.invalidateQueries({ queryKey: tradeSparesKey(participantId) });
  void qc.invalidateQueries({ queryKey: dustSparesKey(participantId) });
}

/**
 * Everything a card leaving or arriving in a collection moves: both spares
 * lists, the stats the vault renders, the public pull counts and the secrets
 * cache (keyed on the actor, not the participant).
 */
export function invalidateCardsMoved(
  qc: QueryClient,
  who: {
    eventId: string | null | undefined;
    participantId: string | null | undefined;
    actor: string | null | undefined;
  },
): Promise<unknown> {
  const { eventId, participantId, actor } = who;
  return Promise.all([
    qc.invalidateQueries({ queryKey: tradeSparesKey(participantId) }),
    qc.invalidateQueries({ queryKey: dustSparesKey(participantId) }),
    qc.invalidateQueries({ queryKey: cardPullCountsKey(eventId) }),
    qc.invalidateQueries({ queryKey: myCardStatsKey(eventId, participantId) }),
    qc.invalidateQueries({ queryKey: mySecretsKey(actor) }),
  ]);
}
