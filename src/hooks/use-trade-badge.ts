// The unread dot on offers waiting for you.
//
// Stored on the phone like every device preference here; see device-store.ts.
//
// Deliberately not a table. Unread is per-device, so somebody who reads an offer on
// their phone still has the dot on the iPad they left indoors — which for thirteen
// people at a party is not worth a migration, a write path and a cross-device merge
// rule. If it ever is, this module is the whole job.
import { useMemo } from "react";
import { createDeviceStore, parseIdList } from "@/lib/device-store";
import { STORAGE_KEYS } from "@/lib/storage-keys";
import type { TradeOfferView } from "@/lib/trades";
import { useMemberSession } from "@/lib/member-token";
import { useTradeOffers } from "./use-trades";
import { useTradeNudge } from "./use-trade-nudge";

const seenOffers = createDeviceStore<readonly string[]>({
  key: STORAGE_KEYS.tradeSeen,
  empty: [],
  parse: parseIdList,
  serialize: (ids) => JSON.stringify({ ids }),
  // Nothing changed — skip the write and the re-render it would fan out.
  equals: (a, b) => a.length === b.length && b.every((id) => a.includes(id)),
});

/**
 * Offers waiting on you that you have not looked at yet.
 *
 * `inbox` is already only the pending ones — getMyTradeOffers splits them out — so
 * this is a set difference and nothing more. Pure, so the interesting cases can be
 * tested without a browser.
 */
export function unreadOfferIds(
  inbox: readonly TradeOfferView[],
  seen: readonly string[],
): string[] {
  const already = new Set(seen);
  return inbox.map((o) => o.id).filter((id) => !already.has(id));
}

/**
 * Mark everything currently in the inbox as read.
 *
 * Stores the intersection rather than the union, which is what stops the set
 * growing for the rest of the app's life: an id that has left the inbox has been
 * accepted, declined, cancelled or voided, and `trade_offers.status` never moves
 * back to pending, so it can never come round again and need remembering.
 */
export function markTradeOffersSeen(inboxIds: readonly string[]) {
  seenOffers.set([...new Set(inboxIds)]);
}

/**
 * How many offers are waiting that you have not seen.
 *
 * Safe to call from as many places as want a dot: every caller shares one
 * useTradeOffers query key, so the second one is a cache read.
 */
export function useTradeBadge(): number {
  const me = useMemberSession();
  const participantId = me?.participantId ?? null;
  const offers = useTradeOffers(participantId).data;
  // Mounted here rather than beside it, so every dot on the screen is fed by one
  // subscription. Calling this hook twice costs nothing: the query dedupes on its
  // key and nudge-channel.ts ref-counts the topic.
  useTradeNudge(offers?.nudgeTopic ?? null, participantId);
  const seen = seenOffers.useValue();
  const inbox = offers?.inbox;
  return useMemo(() => unreadOfferIds(inbox ?? [], seen).length, [inbox, seen]);
}
