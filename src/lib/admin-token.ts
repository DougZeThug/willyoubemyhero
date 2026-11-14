import { useEffect, useState } from "react";
import { parseAdminToken } from "./token-format";
import {
  emitLocal,
  onLocal,
  onOtherTab,
  readStored,
  removeStored,
  writeStrict,
} from "./device-store";
import { STORAGE_EVENTS, STORAGE_KEYS } from "./storage-keys";

const KEY = STORAGE_KEYS.adminToken;
const CHANGED = STORAGE_EVENTS.adminToken;
// The account that was signed in when the token above was issued, or absent for
// a PIN unlock nobody was signed in for. The token itself names no user —
// requireAdmin checks the event and nothing else — and since ADM-16 it outlives
// a sign-out, so this is the only thing on the device that says whose it is.
const OWNER_KEY = STORAGE_KEYS.adminTokenOwner;

type Parsed = { eventId: string; expiresAt: number; token: string };
export type AdminSession = Parsed & { owner: string | null };

function parse(token: string | null): Parsed | null {
  if (!token) return null;
  const parsed = parseAdminToken(token);
  if (!parsed || Date.now() > parsed.expiresAt) return null;
  return { eventId: parsed.id, expiresAt: parsed.expiresAt, token };
}

export function getAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  const raw = readStored(KEY);
  const parsed = parse(raw);
  if (!parsed) {
    if (raw) {
      removeStored(KEY);
      removeStored(OWNER_KEY);
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
  writeStrict(KEY, token);
  if (owner) writeStrict(OWNER_KEY, owner);
  else removeStored(OWNER_KEY);
  emitLocal(CHANGED);
}

export function clearAdminToken() {
  if (typeof window === "undefined") return;
  removeStored(KEY);
  removeStored(OWNER_KEY);
  emitLocal(CHANGED);
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
  const owner = readStored(OWNER_KEY);
  if (!owner) writeStrict(OWNER_KEY, userId);
  else if (owner !== userId) clearAdminToken();
}

export function useAdminSession(): AdminSession | null {
  // Start null so server and first client render agree; hydrate in the effect.
  const [session, setSession] = useState<AdminSession | null>(null);
  useEffect(() => {
    function refresh() {
      const parsed = parse(readStored(KEY));
      setSession(parsed && { ...parsed, owner: readStored(OWNER_KEY) });
    }
    refresh();
    const offTheirs = onOtherTab([KEY, OWNER_KEY], refresh);
    const offHere = onLocal(CHANGED, refresh);
    // Also expire naturally.
    const iv = window.setInterval(refresh, 60_000);
    return () => {
      offTheirs();
      offHere();
      window.clearInterval(iv);
    };
  }, []);
  return session;
}
