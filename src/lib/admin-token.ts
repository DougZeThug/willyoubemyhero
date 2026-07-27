import { useEffect, useState } from "react";

const KEY = "wwbh:admin-token";

type Parsed = { eventId: string; expiresAt: number; token: string };

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
    if (raw) window.localStorage.removeItem(KEY);
    return null;
  }
  return parsed.token;
}

export function setAdminToken(token: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, token);
  window.dispatchEvent(new Event("wwbh:admin-token-changed"));
}

export function clearAdminToken() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("wwbh:admin-token-changed"));
}

export function useAdminSession(): Parsed | null {
  const [session, setSession] = useState<Parsed | null>(() =>
    typeof window === "undefined" ? null : parse(window.localStorage.getItem(KEY)),
  );
  useEffect(() => {
    function refresh() {
      setSession(parse(window.localStorage.getItem(KEY)));
    }
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("wwbh:admin-token-changed", refresh);
    // Also expire naturally.
    const iv = window.setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("wwbh:admin-token-changed", refresh);
      window.clearInterval(iv);
    };
  }, []);
  return session;
}
