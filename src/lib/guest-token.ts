// Anonymous session on this device, so somebody who has not claimed a player can
// still own a daily secret card. Mirrors member-token.ts, with its own key.
//
// The id inside is minted by the server, not here. `device-id.ts` already keeps a
// locally-generated uuid, but that one only ever decides which pack this device is
// dealt — a purely client-side determinism that nothing is at stake in. A secret
// card *is* at stake, so its identity has to be one the server issued and signed.
import { useEffect, useState } from "react";
import { GUEST_PREFIX, parsePrefixedToken } from "./token-format";
import {
  emitLocal,
  onLocal,
  onOtherTab,
  readStored,
  removeStored,
  writeStored,
} from "./device-store";
import { STORAGE_EVENTS, STORAGE_KEYS } from "./storage-keys";

const KEY = STORAGE_KEYS.guestToken;
const CHANGED = STORAGE_EVENTS.guestToken;

export type GuestSession = { guestId: string; expiresAt: number; token: string };

function parse(token: string | null): GuestSession | null {
  if (!token) return null;
  const parsed = parsePrefixedToken(GUEST_PREFIX, token);
  if (!parsed || Date.now() > parsed.expiresAt) return null;
  return { guestId: parsed.id, expiresAt: parsed.expiresAt, token };
}

export function getGuestToken(): string | null {
  if (typeof window === "undefined") return null;
  const raw = readStored(KEY);
  const parsed = parse(raw);
  if (!parsed) {
    if (raw) clearGuestToken();
    return null;
  }
  return parsed.token;
}

export function setGuestToken(token: string) {
  if (typeof window === "undefined") return;
  writeStored(KEY, token);
  emitLocal(CHANGED);
}

export function clearGuestToken() {
  if (typeof window === "undefined") return;
  removeStored(KEY);
  emitLocal(CHANGED);
}

function read(): GuestSession | null {
  if (typeof window === "undefined") return null;
  return parse(readStored(KEY));
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
    const offTheirs = onOtherTab([KEY], refresh);
    const offHere = onLocal(CHANGED, refresh);
    return () => {
      offTheirs();
      offHere();
    };
  }, []);
  return session;
}
