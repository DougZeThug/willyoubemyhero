// Keeps a member's 90-day token from lapsing while they are still playing.
//
// A paper-code member is only re-signed by claimPlayer, so a phone in use all
// season used to drop to guest on day 91 without a word. Renewing inside the
// last month leaves plenty of visits to land it on, and nobody who has stopped
// opening the app gets a session extended for them.
import { getMemberToken, refreshMemberToken } from "./member-token";

/** Renew once fewer than this many milliseconds of the token are left. */
export const RENEW_WITHIN_MS = 30 * 24 * 60 * 60 * 1000;

type RenewResult = { ok: true; token: string; expiresAt: number } | { ok: false; reason: string };
export type Renew = () => Promise<RenewResult>;

function expiryOf(token: string): number {
  return Number(token.split(".")[2]);
}

let inFlight: Promise<boolean> | null = null;

/**
 * Renew the device's member token if it is inside its last month.
 *
 * Single-flight: every caller during a request shares it, so a mount and a tick
 * landing together ask once. A failure leaves the stored token exactly as it
 * was and is not retried here — the next tick is soon enough, and a phone on
 * garden wifi must not spin. An absent or already-expired token is never sent:
 * getMemberToken evicts it, and the server would refuse it anyway.
 *
 * Resolves true only when a renewed token was stored.
 */
export function renewMemberTokenIfDue(renew: Renew, now = Date.now()): Promise<boolean> {
  if (inFlight) return inFlight;
  const token = getMemberToken();
  if (!token || expiryOf(token) - now >= RENEW_WITHIN_MS) return Promise.resolve(false);
  inFlight = (async () => {
    try {
      const res = await renew();
      return res.ok ? refreshMemberToken(res.token) : false;
    } catch {
      return false;
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
