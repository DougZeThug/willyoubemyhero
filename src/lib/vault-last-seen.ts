// The last time this device actually looked at the vault.
//
// Stored the way every other device preference in this app is — see the header of
// vault-favourites.ts: a `wwbh:` key, every touch of storage in a try/catch so a
// locked private-mode browser degrades to "works for this page load", a
// module-level `current` because that is all there is left to trust when a write
// is refused, and a custom event because `storage` only fires in *other* tabs.
//
// A TIMESTAMP AND NOT A SEEN-SET, unlike trophy-seen.ts next door. Newness is a
// comparison against this one instant, so the device never has to hold a list of
// ids it would then have to prune — and thirteen roster cards plus a growing
// secret ledger is exactly the list that would need pruning. It is bumped when
// somebody ACTS on the strip, never merely by arriving on the page, which would
// clear the row before it had been read.
import { useEffect, useState } from "react";

const KEY = "wwbh:vault-last-seen";
const CHANGED = "wwbh:vault-last-seen-changed";

/**
 * How far back anything is ever willing to look.
 *
 * §12: "the strip disappears after 24 h". This IS that rule — nothing older than a
 * day is ever asked for — which beats a second stored flag saying the same thing,
 * because there is no way for the two to disagree.
 */
export const ACQUISITION_WINDOW_MS = 24 * 60 * 60 * 1000;

/** How coarsely the window is rounded, so two screens agree on one query key. */
export const WINDOW_BUCKET_MS = 5 * 60 * 1000;

let current: string | null = null;

function read(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    // Junk under our key reads as "never visited", which seeds silently below
    // rather than showing a strip built on a number nobody can parse.
    return raw && !Number.isNaN(Date.parse(raw)) ? raw : null;
  } catch {
    return null;
  }
}

export function readVaultLastSeen(): string | null {
  current = read();
  return current;
}

/** Mark everything up to now as looked at. */
export function markVaultSeen(at: string = new Date().toISOString()) {
  // Nothing changed, so nothing to announce. Same short-circuit setTrophySeen and
  // markTradeOffersSeen make, and here it is what stops a tap on the strip
  // re-rendering the whole vault for an identical value.
  if (current === at) return;
  current = at;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, at);
  } catch {
    /* private mode with storage blocked still clears the strip for this page load */
  }
  window.dispatchEvent(new Event(CHANGED));
}

/**
 * The window to ask the server for. A plain day, and DELIBERATELY not "since your
 * last visit".
 *
 * The two readers want different things out of the same rows, and asking for the
 * narrower of them broke both. The strip wants what is new since you looked; the
 * player page's reveal cue (§6) wants "was this card acquired recently at all",
 * and it is reached BY TAPPING THE STRIP — which moves the last-visit instant. A
 * window anchored on that instant is therefore always empty by the time the card
 * page reads it, and the cue it was supposed to fix goes back to firing off the
 * per-session guard on every reload.
 *
 * So the server is asked one stable question, the answer is shared between both
 * screens out of one query cache, and "new since last visit" is a filter over it —
 * see `isNewSince`. Dismissing the strip then costs no round trip at all, which is
 * also why the row can vanish under the thumb rather than a moment after it.
 */
export function acquisitionWindow(now: number, windowMs: number = ACQUISITION_WINDOW_MS): string {
  // QUANTISED, and that is what makes the shared cache real rather than a claim.
  // `since` is part of the query key, so a raw Date.now() would give the vault and
  // the card page you tap through to keys that differ by a few milliseconds —
  // a second identical round trip, and a reveal cue held behind it. Rounding down
  // to a five-minute bucket makes two mounts moments apart agree, and a window
  // that trails by up to five minutes inside a day is not a difference anybody
  // can see.
  const bucket = Math.floor(now / WINDOW_BUCKET_MS) * WINDOW_BUCKET_MS;
  return new Date(bucket - windowMs).toISOString();
}

/**
 * Whether one arrival is news to this device.
 *
 * Pure, so the rule is tested without a browser. FALSE on a device that has never
 * stored a visit: that is the `primed` flag from trophy-seen.ts restated — an
 * absent value must never read as "everything is new", or a member restoring on a
 * new handset gets a strip celebrating a collection they built months ago.
 */
export function isNewSince(acquiredAt: string, lastSeen: string | null): boolean {
  if (!lastSeen) return false;
  const seen = Date.parse(lastSeen);
  if (Number.isNaN(seen)) return false;
  const at = Date.parse(acquiredAt);
  return !Number.isNaN(at) && at > seen;
}

/**
 * The stored instant, reactive, seeding itself on a device that has none.
 *
 * The seed happens in the mount effect rather than during render for the reason
 * use-photo-urls.ts is written around: SSR has no localStorage, and a first paint
 * that disagrees with the second is the bug.
 */
export function useVaultLastSeen(): string | null {
  const [lastSeen, setLastSeen] = useState<string | null>(null);

  useEffect(() => {
    // Our own writes trust the module value; re-reading storage would hand a
    // private-mode browser back the value it just refused to save, and the strip
    // would reappear under the thumb that dismissed it.
    const mine = () => setLastSeen(current);
    // Another tab. That one did save, so storage is the truth.
    const theirs = () => {
      current = read();
      setLastSeen(current);
    };
    theirs();
    // First visit on this device: seed the instant so the NEXT visit has
    // something to measure from, while this one stays quiet. The listeners go on
    // AFTER, which is what keeps it quiet — our own seed has nothing to repaint
    // through, so the value this render hands back is still null and `isNewSince`
    // answers false for everything.
    if (current === null) markVaultSeen();
    window.addEventListener(CHANGED, mine);
    window.addEventListener("storage", theirs);
    return () => {
      window.removeEventListener(CHANGED, mine);
      window.removeEventListener("storage", theirs);
    };
  }, []);

  return lastSeen;
}
