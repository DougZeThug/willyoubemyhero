import { useEffect, useState } from "react";

const KEY = "wwbh:admin-token";
// The account that was signed in when the token above was issued, or absent for
// a PIN unlock nobody was signed in for. The token itself names no user —
// requireAdmin checks the event and nothing else — and since ADM-16 it outlives
// a sign-out, so this is the only thing on the device that says whose it is.
const OWNER_KEY = "wwbh:admin-token-owner";

type Parsed = { eventId: string; expiresAt: number; token: string };
export type AdminSession = Parsed & { owner: string | null };

function parse(token: string | null): Parsed | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [eventId, expStr] = parts;
  const expiresAt = Number(expStr);
  if (!eventId || !Number.isFinite(expiresAt)) return null;
  if (Date.now() > expiresAt) return null;
  return { eventId, expiresAt, token };
}

export function getAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(KEY);
  const parsed = parse(raw);
  if (!parsed) {
    if (raw) {
      window.localStorage.removeItem(KEY);
      window.localStorage.removeItem(OWNER_KEY);
    }
    return null;
  }
  return parsed.token;
}

/**
 * Store the admin token, and who it belongs to.
 *
 * `owner` is required rather than optional so that every place that unlocks the
 * console has to say which account was signed in when it did — the one piece of
 * information that stops the next account on this handset inheriting it.
 */
export function setAdminToken(token: string, owner: string | null) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, token);
  if (owner) window.localStorage.setItem(OWNER_KEY, owner);
  else window.localStorage.removeItem(OWNER_KEY);
  window.dispatchEvent(new Event("wwbh:admin-token-changed"));
}

export function clearAdminToken() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
  window.localStorage.removeItem(OWNER_KEY);
  window.dispatchEvent(new Event("wwbh:admin-token-changed"));
}

/**
 * An account is signed in on this device: the admin token is theirs or it goes.
 *
 * A token another account earned comes off. One nobody owned — a PIN unlock
 * from before anybody signed in — becomes this account's, which is the admin
 * twin of the paper-code-then-sign-in path: left unowned, the commissioner's
 * next sign-out would hand the console to whoever signed in after them.
 *
 * Read from storage rather than remembered in memory, because the sign-in that
 * matters most here is Google's, and that one can leave the page and come back
 * through a redirect.
 */
export function bindAdminTokenTo(userId: string) {
  if (typeof window === "undefined") return;
  // Also evicts an expired token, and the owner with it.
  if (!getAdminToken()) return;
  const owner = window.localStorage.getItem(OWNER_KEY);
  if (!owner) window.localStorage.setItem(OWNER_KEY, userId);
  else if (owner !== userId) clearAdminToken();
}

export function useAdminSession(): AdminSession | null {
  // Start null so server and first client render agree; hydrate in the effect.
  const [session, setSession] = useState<AdminSession | null>(null);
  useEffect(() => {
    function refresh() {
      const parsed = parse(window.localStorage.getItem(KEY));
      setSession(parsed && { ...parsed, owner: window.localStorage.getItem(OWNER_KEY) });
    }
    // `storage` fires for every key the other tab writes, so the listener needs
    // its own; the custom event beside it is this tab's write. A null key is
    // localStorage.clear(), which does concern us -- that is a sign-out.
    function theirs(e: StorageEvent) {
      if (e.key !== null && e.key !== KEY && e.key !== OWNER_KEY) return;
      refresh();
    }
    refresh();
    window.addEventListener("storage", theirs);
    window.addEventListener("wwbh:admin-token-changed", refresh);
    // Also expire naturally.
    const iv = window.setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener("storage", theirs);
      window.removeEventListener("wwbh:admin-token-changed", refresh);
      window.clearInterval(iv);
    };
  }, []);
  return session;
}
