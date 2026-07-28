// League-member session on this device. Mirrors src/lib/admin-token.ts, with a
// separate storage key so claiming a player and unlocking admin are independent.
import { useEffect, useState } from "react";

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

function read(): MemberSession | null {
  if (typeof window === "undefined") return null;
  return parse(window.localStorage.getItem(KEY), window.localStorage.getItem(NAME_KEY));
}

export function useMemberSession(): MemberSession | null {
  // Start null so server and first client render agree; hydrate in the effect.
  const [session, setSession] = useState<MemberSession | null>(null);
  useEffect(() => {
    function refresh() {
      setSession(read());
    }
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("wwbh:member-token-changed", refresh);
    // Tokens last 90 days, so an hourly expiry check is plenty.
    const iv = window.setInterval(refresh, 60 * 60_000);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("wwbh:member-token-changed", refresh);
      window.clearInterval(iv);
    };
  }, []);
  return session;
}
