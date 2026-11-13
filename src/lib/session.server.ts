import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  ACCOUNT_ADMIN_PREFIX,
  GUEST_PREFIX,
  MEMBER_PREFIX,
  parseAdminToken,
  parsePrefixedToken,
} from "./token-format";

export function hashPin(salt: string, pin: string): string {
  return createHash("sha256").update(`${salt}::${pin}`).digest("hex");
}

export function timingSafeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12h

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * The one signing primitive in this app: HMAC-SHA256, base64url, unpadded.
 *
 * Exported so nudge.server.ts can derive its topics from the same secret and the
 * same construction rather than growing a second one. Everything below still goes
 * through it, so session.server.test.ts pins its output shape by pinning theirs.
 */
export function hmac(payload: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(payload).digest());
}

export function signAdminToken(eventId: string): { token: string; expiresAt: number } {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = `${eventId}.${expiresAt}`;
  const sig = hmac(payload, secret);
  return { token: `${payload}.${sig}`, expiresAt };
}

// An admin token issued from an account on the admin list, rather than the PIN.
// It names the account inside the signed payload — "a.<userId>.<eventId>.<exp>" —
// so requireAdmin can re-check admin_accounts on every write and a commissioner
// taken off the list loses the console at once, not twelve hours later. Five
// parts, so it can never parse as a PIN token (3) or a member/guest token (4).
// The shape lives in token-format.ts, which the device reads too.

export function signAccountAdminToken(
  userId: string,
  eventId: string,
): { token: string; expiresAt: number } {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = `${ACCOUNT_ADMIN_PREFIX}.${userId}.${eventId}.${expiresAt}`;
  return { token: `${payload}.${hmac(payload, secret)}`, expiresAt };
}

export function verifyAdminToken(
  token: string | null | undefined,
): { eventId: string; expiresAt: number; userId?: string } | null {
  if (!token) return null;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const parsed = parseAdminToken(token);
  if (!parsed) return null;
  if (!timingSafeEq(parsed.sig, hmac(parsed.payload, secret))) return null;
  if (Date.now() > parsed.expiresAt) return null;
  return parsed.userId
    ? { eventId: parsed.id, expiresAt: parsed.expiresAt, userId: parsed.userId }
    : { eventId: parsed.id, expiresAt: parsed.expiresAt };
}

// ---------- League member sessions ----------
//
// Same HMAC construction as the admin token, but a distinct 4-part shape with an
// "m" prefix that is also inside the signed payload. An admin token can never be
// parsed as a member token (3 parts vs 4) and a signature cannot be transplanted
// between the two, because the prefix is part of what gets signed.

// 90 days — this is a party app. Guest tokens use the same lifetime, and
// memberTokenIssuedAt below only works because every one of these tokens is
// signed with exactly this value.
export const MEMBER_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * When a member token was signed, recovered from its expiry.
 *
 * The token carries no issue time of its own, and adding one would change the
 * signed shape session.server.test.ts pins. Every member token is signed with
 * exactly this TTL, so the expiry already says when it was minted.
 */
export function memberTokenIssuedAt(expiresAt: number): number {
  return expiresAt - MEMBER_TOKEN_TTL_MS;
}

export function hashCode(salt: string, code: string): string {
  // Codes are handed out on paper; compare case-insensitively.
  return createHash("sha256").update(`${salt}::${code.trim().toUpperCase()}`).digest("hex");
}

export function signMemberToken(participantId: string): { token: string; expiresAt: number } {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  const expiresAt = Date.now() + MEMBER_TOKEN_TTL_MS;
  const payload = `${MEMBER_PREFIX}.${participantId}.${expiresAt}`;
  return { token: `${payload}.${hmac(payload, secret)}`, expiresAt };
}

export function verifyMemberToken(
  token: string | null | undefined,
): { participantId: string; expiresAt: number } | null {
  const parsed = parsePrefixed(MEMBER_PREFIX, token);
  return parsed && { participantId: parsed.id, expiresAt: parsed.expiresAt };
}

/** Parse, check the signature, check expiry. Null for anything that fails any of the three. */
function parsePrefixed(prefix: string, token: string | null | undefined) {
  if (!token) return null;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const parsed = parsePrefixedToken(prefix, token);
  if (!parsed) return null;
  if (!timingSafeEq(parsed.sig, hmac(parsed.payload, secret))) return null;
  if (Date.now() > parsed.expiresAt) return null;
  return parsed;
}

// ---------- Guest sessions ----------
//
// A third scheme, so somebody who has not claimed a player can still own a daily
// secret card. Same construction again, with a "g" prefix that is likewise inside
// the signed payload — this one matters more than the admin/member pair, because a
// guest token and a member token are BOTH four parts. The prefix is the only thing
// distinguishing them, and signing it is what stops a guest token being presented
// as a member token or the reverse.
//
// The id inside is minted by the server (see startGuestSession) and never taken
// from the client. That is the whole point: a handler that signed whatever id it
// was handed would let anyone mint a token for somebody else's guest id and spend
// their pull, which is exactly the attack the signature is here to prevent.

export function signGuestToken(guestId: string): { token: string; expiresAt: number } {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  const expiresAt = Date.now() + MEMBER_TOKEN_TTL_MS;
  const payload = `${GUEST_PREFIX}.${guestId}.${expiresAt}`;
  return { token: `${payload}.${hmac(payload, secret)}`, expiresAt };
}

export function verifyGuestToken(
  token: string | null | undefined,
): { guestId: string; expiresAt: number } | null {
  const parsed = parsePrefixed(GUEST_PREFIX, token);
  return parsed && { guestId: parsed.id, expiresAt: parsed.expiresAt };
}
