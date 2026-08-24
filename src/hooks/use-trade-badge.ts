// The unread dot on offers waiting for you.
//
// Stored on the phone, exactly like vault-favourites.ts: a `wwbh:` key, every touch
// of storage in a try/catch so a locked private-mode browser degrades to "works for
// this page load", and a custom event because `storage` only fires in *other* tabs.
//
// Deliberately not a table. Unread is per-device, so somebody who reads an offer on
// their phone still has the dot on the iPad they left indoors — which for thirteen
// people at a party is not worth a migration, a write path and a cross-device merge
// rule. If it ever is, this module is the whole job.
import { useEffect, useMemo, useState } from "react";
import type { TradeOfferView } from "@/lib/trades";
import { useMemberSession } from "@/lib/member-token";
import { useTradeOffers } from "./use-trades";

const KEY = "wwbh:trade-seen";
const CHANGED = "wwbh:trade-seen-changed";

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

// Mirrors vault-favourites.ts's `current`: the last value we set, which is all that
// is left to trust when the write below is refused.
let current: readonly string[] = [];

function read(): readonly string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    const ids = (parsed as { ids?: unknown } | null)?.ids;
    if (!Array.isArray(ids)) return [];
    return ids.filter((v): v is string => typeof v === "string");
  } catch {
    // Blocked storage, or something else wrote junk under our key. Everything
    // unread is a working page.
    return [];
  }
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
  const next = [...new Set(inboxIds)];
  // Nothing changed — skip the write and the re-render it would fan out.
  if (next.length === current.length && next.every((id) => current.includes(id))) return;
  current = next;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ids: next }));
  } catch {
    /* private mode with storage blocked still clears the dot for this page load */
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** The seen ids, reactive. Same hydration dance as useVaultFavourites. */
function useSeenOffers(): readonly string[] {
  const [ids, setIds] = useState<readonly string[]>([]);

  useEffect(() => {
    // Our own writes trust the module value; re-reading storage would hand a
    // private-mode browser back the list it just refused to save, and the dot would
    // come straight back on the screen that just cleared it.
    const mine = () => setIds(current);
    // Another tab. That one did save, so storage is the truth.
    const theirs = () => {
      current = read();
      setIds(current);
    };
    theirs();
    window.addEventListener(CHANGED, mine);
    window.addEventListener("storage", theirs);
    return () => {
      window.removeEventListener(CHANGED, mine);
      window.removeEventListener("storage", theirs);
    };
  }, []);

  return ids;
}

/**
 * How many offers are waiting that you have not seen.
 *
 * Safe to call from as many places as want a dot: every caller shares one
 * useTradeOffers query key, so the second one is a cache read.
 *
 * The count is only as fresh as `useTradeOffers`, which today means the focus
 * refetch — so on a phone, "the next time you unlock it".
 */
export function useTradeBadge(): number {
  const me = useMemberSession();
  const participantId = me?.participantId ?? null;
  const offers = useTradeOffers(participantId).data;
  const seen = useSeenOffers();
  const inbox = offers?.inbox;
  return useMemo(() => unreadOfferIds(inbox ?? [], seen).length, [inbox, seen]);
}
