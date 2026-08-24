import { createHash, createHmac, timingSafeEqual } from "node:crypto";

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

export function verifyAdminToken(
  token: string | null | undefined,
): { eventId: string; expiresAt: number } | null {
  if (!token) return null;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [eventId, expStr, sig] = parts;
  const expiresAt = Number(expStr);
  if (!eventId || !Number.isFinite(expiresAt)) return null;
  const expected = hmac(`${eventId}.${expiresAt}`, secret);
  if (!timingSafeEq(sig, expected)) return null;
  if (Date.now() > expiresAt) return null;
  return { eventId, expiresAt };
}

// ---------- League member sessions ----------
//
// Same HMAC construction as the admin token, but a distinct 4-part shape with an
// "m" prefix that is also inside the signed payload. An admin token can never be
// parsed as a member token (3 parts vs 4) and a signature cannot be transplanted
// between the two, because the prefix is part of what gets signed.

const MEMBER_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days — this is a party app
const MEMBER_PREFIX = "m";

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
  if (!token) return null;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [prefix, participantId, expStr, sig] = parts;
  if (prefix !== MEMBER_PREFIX) return null;
  const expiresAt = Number(expStr);
  if (!participantId || !Number.isFinite(expiresAt)) return null;
  const expected = hmac(`${MEMBER_PREFIX}.${participantId}.${expiresAt}`, secret);
  if (!timingSafeEq(sig, expected)) return null;
  if (Date.now() > expiresAt) return null;
  return { participantId, expiresAt };
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

const GUEST_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days, same as a member
const GUEST_PREFIX = "g";

export function signGuestToken(guestId: string): { token: string; expiresAt: number } {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  const expiresAt = Date.now() + GUEST_TOKEN_TTL_MS;
  const payload = `${GUEST_PREFIX}.${guestId}.${expiresAt}`;
  return { token: `${payload}.${hmac(payload, secret)}`, expiresAt };
}

export function verifyGuestToken(
  token: string | null | undefined,
): { guestId: string; expiresAt: number } | null {
  if (!token) return null;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [prefix, guestId, expStr, sig] = parts;
  if (prefix !== GUEST_PREFIX) return null;
  const expiresAt = Number(expStr);
  if (!guestId || !Number.isFinite(expiresAt)) return null;
  const expected = hmac(`${GUEST_PREFIX}.${guestId}.${expiresAt}`, secret);
  if (!timingSafeEq(sig, expected)) return null;
  if (Date.now() > expiresAt) return null;
  return { guestId, expiresAt };
}
