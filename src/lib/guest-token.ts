// Anonymous session on this device, so somebody who has not claimed a player can
// still own a daily secret card. Mirrors member-token.ts, with its own key.
//
// The id inside is minted by the server, not here. `device-id.ts` already keeps a
// locally-generated uuid, but that one only ever decides which pack this device is
// dealt — a purely client-side determinism that nothing is at stake in. A secret
// card *is* at stake, so its identity has to be one the server issued and signed.
import { useEffect, useState } from "react";

const KEY = "wwbh:guest-token";

export type GuestSession = { guestId: string; expiresAt: number; token: string };

function parse(token: string | null): GuestSession | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [prefix, guestId, expStr] = parts;
  // A member token is also four parts. The prefix is what tells them apart, here
  // and in the signed payload server-side.
  if (prefix !== "g") return null;
  const expiresAt = Number(expStr);
  if (!guestId || !Number.isFinite(expiresAt)) return null;
  if (Date.now() > expiresAt) return null;
  return { guestId, expiresAt, token };
}

export function getGuestToken(): string | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(KEY);
  const parsed = parse(raw);
  if (!parsed) {
    if (raw) clearGuestToken();
    return null;
  }
  return parsed.token;
}

export function setGuestToken(token: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, token);
  window.dispatchEvent(new Event("wwbh:guest-token-changed"));
}

export function clearGuestToken() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("wwbh:guest-token-changed"));
}

function read(): GuestSession | null {
  if (typeof window === "undefined") return null;
  return parse(window.localStorage.getItem(KEY));
}

export function useGuestSession(): GuestSession | null {
  // Starts null so server and first client render agree, exactly as
  // useMemberSession does — a mismatched first paint is the bug both are written
  // around.
  const [session, setSession] = useState<GuestSession | null>(null);
  useEffect(() => {
    function refresh() {
      setSession(read());
    }
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("wwbh:guest-token-changed", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("wwbh:guest-token-changed", refresh);
    };
  }, []);
  return session;
}
