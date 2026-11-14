// League-member session on this device. Mirrors src/lib/admin-token.ts, with a
// separate storage key so claiming a player and unlocking admin are independent.
import { useSyncExternalStore } from "react";
import { MEMBER_PREFIX, parsePrefixedToken } from "./token-format";
import {
  emitLocal,
  onLocal,
  onOtherTab,
  readStored,
  removeStored,
  writeStrict,
} from "./device-store";
import { STORAGE_EVENTS, STORAGE_KEYS } from "./storage-keys";

const KEY = STORAGE_KEYS.memberToken;
const CHANGED = STORAGE_EVENTS.memberToken;
const NAME_KEY = STORAGE_KEYS.memberName;
/** Breadcrumb that outlives the token. See setMemberToken. */
export const WAS_MEMBER_KEY = STORAGE_KEYS.wasMember;

export type MemberSession = {
  participantId: string;
  expiresAt: number;
  token: string;
  /** Cached for display so the nav can greet you without a round trip. */
  name: string | null;
};

function parse(token: string | null, name: string | null, now = Date.now()): MemberSession | null {
  if (!token) return null;
  const parsed = parsePrefixedToken(MEMBER_PREFIX, token);
  if (!parsed || now > parsed.expiresAt) return null;
  return { participantId: parsed.id, expiresAt: parsed.expiresAt, token, name };
}

export function getMemberToken(): string | null {
  if (typeof window === "undefined") return null;
  const raw = readStored(KEY);
  const parsed = parse(raw, null);
  if (!parsed) {
    if (raw) clearMemberToken();
    return null;
  }
  return parsed.token;
}

export function setMemberToken(token: string, name: string) {
  if (typeof window === "undefined") return;
  writeStrict(KEY, token);
  writeStrict(NAME_KEY, name);
  // Deliberately never cleared, including on sign-out. A member's secret cards
  // live on their name rather than on the phone, so somebody arriving on a new
  // handset to an empty vault needs to be told where their collection went — and
  // by then the token that would have proved they had one is gone.
  writeStrict(WAS_MEMBER_KEY, "1");
  emitLocal(CHANGED);
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
 * Still announced, so the session snapshot carries the new expiry; every effect
 * keyed on the member is keyed on `participantId`, which has not moved.
 */
export function refreshMemberToken(token: string, renewed?: string): boolean {
  if (typeof window === "undefined") return false;
  const next = memberTokenParticipant(token);
  if (!next) return false;
  if (renewed !== undefined) {
    if (readStored(KEY) !== renewed) return false;
    if (memberTokenParticipant(renewed) !== next) return false;
  } else if (next !== memberTokenParticipant(getMemberToken())) {
    return false;
  }
  writeStrict(KEY, token);
  emitLocal(CHANGED);
  return true;
}

export function clearMemberToken() {
  if (typeof window === "undefined") return;
  removeStored(KEY);
  removeStored(NAME_KEY);
  emitLocal(CHANGED);
}

// useSyncExternalStore re-renders whenever getSnapshot returns a new reference,
// so an unchanged token must keep handing back the same object.
let cached: MemberSession | null = null;
let cachedKey: string | null = null;

function snapshot(): MemberSession | null {
  const raw = readStored(KEY);
  const name = readStored(NAME_KEY);
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
const WATCHED = [KEY, NAME_KEY, WAS_MEMBER_KEY];

function subscribe(onStoreChange: () => void) {
  // Filtered, unlike a bare `storage` listener: this is a useSyncExternalStore
  // subscribe, so an unrelated wwbh: write would re-notify every component
  // holding a member session.
  const offTheirs = onOtherTab(WATCHED, onStoreChange);
  const offHere = onLocal(CHANGED, onStoreChange);
  // Tokens last 90 days, so an hourly expiry check is plenty.
  const iv = window.setInterval(onStoreChange, 60 * 60_000);
  return () => {
    offTheirs();
    offHere();
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
