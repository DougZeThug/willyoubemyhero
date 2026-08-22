// Attempt limiting for the two endpoints that take a secret typed on a phone:
// the event PIN and the six-character member code. Neither had a ceiling, and a
// four-digit PIN is ten thousand guesses — a couple of minutes of scripted
// requests against the whole admin surface.
//
// PER-ISOLATE, DELIBERATELY. The build targets Cloudflare Workers, where this
// Map belongs to one instance and requests fan out across many, so an attacker
// who reconnects often enough eventually lands on a fresh budget. That makes it
// a brake rather than a guarantee. The alternative — a Durable Object, or a
// table written on every failed keystroke — is real infrastructure to slow down
// an attack nobody is mounting on a thirteen-person garden party, and the
// realistic version of the attack (unlimited guesses down one connection) is
// exactly what this does stop.
//
// ONLY FAILURES COUNT, and a success clears the key, so somebody who fumbles
// their code twice and then gets it right never carries a penalty forward.
import { getRequestHeader } from "@tanstack/react-start/server";

const WINDOW_MS = 5 * 60_000;
const MAX_ATTEMPTS = 10;
/** Bounded so a long-lived isolate cannot accumulate a key per address forever. */
const MAX_KEYS = 500;

type Attempts = { count: number; expiresAt: number };

const attempts = new Map<string, Attempts>();

/** The live window for a key, dropping it once it has expired. */
function current(key: string, now: number): Attempts | null {
  const hit = attempts.get(key);
  if (!hit) return null;
  if (now >= hit.expiresAt) {
    attempts.delete(key);
    return null;
  }
  return hit;
}

/** True once this key has spent its budget for the current window. */
export function tooManyAttempts(key: string, now = Date.now()): boolean {
  return (current(key, now)?.count ?? 0) >= MAX_ATTEMPTS;
}

export function recordFailedAttempt(key: string, now = Date.now()): void {
  const hit = current(key, now);
  if (hit) {
    hit.count += 1;
    return;
  }
  if (attempts.size >= MAX_KEYS) {
    // Insertion order is close enough to window order: an entry is only ever
    // created fresh, never re-inserted, so the first key is the oldest window.
    const oldest = attempts.keys().next().value;
    if (oldest) attempts.delete(oldest);
  }
  attempts.set(key, { count: 1, expiresAt: now + WINDOW_MS });
}

/** Forget a key's failures. Called on success, so a fumble costs nothing later. */
export function clearAttempts(key: string): void {
  attempts.delete(key);
}

/** Test seam — the Map deliberately outlives any single handler call. */
export function resetRateLimits(): void {
  attempts.clear();
}

/**
 * Best-effort caller address.
 *
 * Cloudflare sets `cf-connecting-ip` itself and strips any client-supplied copy,
 * so it is trustworthy where it appears. The other two are for dev and other
 * proxies and are spoofable — which costs nothing here, because a caller who
 * forges an address gets their own bucket rather than somebody else's. Callers
 * that resolve to `unknown` share one, which is why both keys below also carry
 * the thing being guessed at.
 */
export function clientIp(): string {
  const cf = getRequestHeader("cf-connecting-ip");
  if (cf) return cf;
  const real = getRequestHeader("x-real-ip");
  if (real) return real;
  return getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
