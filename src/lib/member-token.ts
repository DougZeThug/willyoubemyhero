// League-member session on this device. Mirrors src/lib/admin-token.ts, with a
// separate storage key so claiming a player and unlocking admin are independent.
import { useSyncExternalStore } from "react";

const KEY = "wwbh:member-token";
const NAME_KEY = "wwbh:member-name";
/** Breadcrumb that outlives the token. See setMemberToken. */
export const WAS_MEMBER_KEY = "wwbh:was-member";
/**
 * The token getMemberToken last evicted for EXPIRING, and the name beside it.
 *
 * Eviction and sign-out both leave the token key empty, and a renewal that lands
 * after its token lapsed has to tell them apart: the first is the same person
 * whose answer came late, the second is somebody who left. Written only by the
 * expiry eviction; every deliberate change of identity removes it.
 */
const LAPSED_KEY = "wwbh:member-lapsed";

export type MemberSession = {
  participantId: string;
  expiresAt: number;
  token: string;
  /** Cached for display so the nav can greet you without a round trip. */
  name: string | null;
};

function parse(token: string | null, name: string | null, now = Date.now()): MemberSession | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [prefix, participantId, expStr] = parts;
  if (prefix !== "m") return null;
  const expiresAt = Number(expStr);
  if (!participantId || !Number.isFinite(expiresAt)) return null;
  if (now > expiresAt) return null;
  return { participantId, expiresAt, token, name };
}

export function getMemberToken(): string | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(KEY);
  const parsed = parse(raw, null);
  if (!parsed) {
    if (raw) {
      // Well-formed but past its expiry is a lapse, not junk: a renewal already
      // in the air for this exact token may still arrive, and every server call
      // reads the token through here — so the first one after expiry lands in
      // exactly that window. Remembered rather than cleared outright.
      if (memberTokenParticipant(raw)) lapseMemberToken(raw);
      else clearMemberToken();
    }
    return null;
  }
  return parsed.token;
}

function lapseMemberToken(raw: string) {
  const name = window.localStorage.getItem(NAME_KEY);
  window.localStorage.setItem(LAPSED_KEY, JSON.stringify({ token: raw, name }));
  window.localStorage.removeItem(KEY);
  window.localStorage.removeItem(NAME_KEY);
  window.dispatchEvent(new Event("wwbh:member-token-changed"));
}

/** The lapsed token and name, if the last thing to empty the token key was its expiry. */
function readLapsed(): { token: string; name: string | null } | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LAPSED_KEY) ?? "null");
    if (parsed && typeof parsed.token === "string") {
      return { token: parsed.token, name: typeof parsed.name === "string" ? parsed.name : null };
    }
  } catch {
    /* a marker nobody can read is no marker */
  }
  return null;
}

export function setMemberToken(token: string, name: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, token);
  window.localStorage.setItem(NAME_KEY, name);
  // A new identity arriving ends any renewal still waiting on the old one.
  window.localStorage.removeItem(LAPSED_KEY);
  // Deliberately never cleared, including on sign-out. A member's secret cards
  // live on their name rather than on the phone, so somebody arriving on a new
  // handset to an empty vault needs to be told where their collection went — and
  // by then the token that would have proved they had one is gone.
  window.localStorage.setItem(WAS_MEMBER_KEY, "1");
  window.dispatchEvent(new Event("wwbh:member-token-changed"));
}

/**
 * The participant a member-shaped token names, or null if it is not one.
 *
 * Ignores expiry on purpose: this answers "whose token is that", and a token
 * written long ago still names the same person after it has lapsed.
 */
export function memberTokenParticipant(token: string | null): string | null {
  return parse(token, null, -Infinity)?.participantId ?? null;
}

/**
 * Swap in a renewed token for the member already on this device.
 *
 * Not setMemberToken, which is how an identity ARRIVES: claim and account sync
 * call it after carrying ceremonies and holding cards for adoption. A renewal is
 * the same person with a later expiry, so it writes only the token — the cached
 * name stays as it is — and only when the device still holds a live token for
 * that same participant. Anything else means the identity changed while the
 * request was out (a sign-out, a switch of player), and a late answer must not
 * put the old one back. Returns whether it wrote.
 *
 * `renewed` is the token the request was made with. Given it, the swap is
 * keyed on the raw stored string still being exactly that token — even if it
 * has expired while the request was in flight, which is the one moment a
 * renewal matters most. Read raw rather than through getMemberToken, which
 * would evict the expired token and then refuse its own replacement.
 *
 * And if something else DID evict it first — every server call reads the token
 * through getMemberToken, and one fired after expiry will — the swap still lands
 * when the key is empty only because of that lapse (see LAPSED_KEY): the same
 * token, hence the same person, with the name the eviction took restored. A
 * sign-out or a different identity removes the marker, so those still drop it.
 *
 * Still announced, so the session snapshot carries the new expiry; every effect
 * keyed on the member is keyed on `participantId`, which has not moved.
 */
export function refreshMemberToken(token: string, renewed?: string): boolean {
  if (typeof window === "undefined") return false;
  const next = memberTokenParticipant(token);
  if (!next) return false;
  if (renewed !== undefined) {
    const stored = window.localStorage.getItem(KEY);
    if (stored !== renewed) {
      const lapsed = stored === null ? readLapsed() : null;
      if (lapsed?.token !== renewed || memberTokenParticipant(renewed) !== next) return false;
      if (lapsed.name !== null) window.localStorage.setItem(NAME_KEY, lapsed.name);
    } else if (memberTokenParticipant(renewed) !== next) {
      return false;
    }
    window.localStorage.removeItem(LAPSED_KEY);
  } else if (next !== memberTokenParticipant(getMemberToken())) {
    return false;
  }
  window.localStorage.setItem(KEY, token);
  window.dispatchEvent(new Event("wwbh:member-token-changed"));
  return true;
}

export function clearMemberToken() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
  window.localStorage.removeItem(NAME_KEY);
  window.localStorage.removeItem(LAPSED_KEY);
  window.dispatchEvent(new Event("wwbh:member-token-changed"));
}

// useSyncExternalStore re-renders whenever getSnapshot returns a new reference,
// so an unchanged token must keep handing back the same object.
let cached: MemberSession | null = null;
let cachedKey: string | null = null;

function snapshot(): MemberSession | null {
  const raw = window.localStorage.getItem(KEY);
  const name = window.localStorage.getItem(NAME_KEY);
  // Parsed fresh every time rather than keyed on the raw strings alone: expiry
  // makes the result time-dependent, and the hourly tick below relies on the
  // same token starting to parse to null.
  const next = parse(raw, name);
  if (next === null) {
    cached = null;
    cachedKey = null;
    return null;
  }
  const key = `${raw}\u0000${name ?? ""}`;
  if (cached !== null && cachedKey === key) return cached;
  cached = next;
  cachedKey = key;
  return next;
}

/**
 * The three keys getSnapshot actually reads, so a `storage` event for anything
 * else is not a change to this store.
 *
 * Set membership rather than one comparison, because this store is unusual in
 * spanning more than one key -- the name rides beside the token and the
 * breadcrumb outlives it.
 */
const WATCHED = new Set<string>([KEY, NAME_KEY, WAS_MEMBER_KEY]);

function subscribe(onStoreChange: () => void) {
  // Filtered, unlike the custom event beside it. `storage` fires for every key
  // the other tab writes, and this is a useSyncExternalStore subscribe -- so an
  // unrelated wwbh: write re-read and re-notified every component holding a
  // member session. A null key is localStorage.clear(), which is a sign-out and
  // very much does concern us.
  const theirs = (e: StorageEvent) => {
    if (e.key !== null && !WATCHED.has(e.key)) return;
    onStoreChange();
  };
  window.addEventListener("storage", theirs);
  window.addEventListener("wwbh:member-token-changed", onStoreChange);
  // Tokens last 90 days, so an hourly expiry check is plenty.
  const iv = window.setInterval(onStoreChange, 60 * 60_000);
  return () => {
    window.removeEventListener("storage", theirs);
    window.removeEventListener("wwbh:member-token-changed", onStoreChange);
    window.clearInterval(iv);
  };
}

export function useMemberSession(): MemberSession | null {
  // A snapshot read at render time, not state hydrated in an effect. The old
  // effect left `me` null for one render after other async state had settled,
  // and the trading post's signed-out gate fired in exactly that window —
  // bouncing a claimed member to /auth. The server snapshot stays null so SSR
  // and the hydration render agree; every render after that reads the truth.
  return useSyncExternalStore(subscribe, snapshot, () => null);
}
