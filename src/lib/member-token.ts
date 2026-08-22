// League-member session on this device. Mirrors src/lib/admin-token.ts, with a
// separate storage key so claiming a player and unlocking admin are independent.
import { useSyncExternalStore } from "react";

const KEY = "wwbh:member-token";
const NAME_KEY = "wwbh:member-name";
/** Breadcrumb that outlives the token. See setMemberToken. */
export const WAS_MEMBER_KEY = "wwbh:was-member";

export type MemberSession = {
  participantId: string;
  expiresAt: number;
  token: string;
  /** Cached for display so the nav can greet you without a round trip. */
  name: string | null;
};

function parse(token: string | null, name: string | null): MemberSession | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [prefix, participantId, expStr] = parts;
  if (prefix !== "m") return null;
  const expiresAt = Number(expStr);
  if (!participantId || !Number.isFinite(expiresAt)) return null;
  if (Date.now() > expiresAt) return null;
  return { participantId, expiresAt, token, name };
}

export function getMemberToken(): string | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(KEY);
  const parsed = parse(raw, null);
  if (!parsed) {
    if (raw) clearMemberToken();
    return null;
  }
  return parsed.token;
}

export function setMemberToken(token: string, name: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, token);
  window.localStorage.setItem(NAME_KEY, name);
  // Deliberately never cleared, including on sign-out. A member's secret cards
  // live on their name rather than on the phone, so somebody arriving on a new
  // handset to an empty vault needs to be told where their collection went — and
  // by then the token that would have proved they had one is gone.
  window.localStorage.setItem(WAS_MEMBER_KEY, "1");
  window.dispatchEvent(new Event("wwbh:member-token-changed"));
}

export function clearMemberToken() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
  window.localStorage.removeItem(NAME_KEY);
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

function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener("wwbh:member-token-changed", onStoreChange);
  // Tokens last 90 days, so an hourly expiry check is plenty.
  const iv = window.setInterval(onStoreChange, 60 * 60_000);
  return () => {
    window.removeEventListener("storage", onStoreChange);
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
